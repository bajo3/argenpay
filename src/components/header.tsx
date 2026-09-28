import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyWallet } from "@/lib/wallet";
import { HeaderLive } from "./header-live";
import { Avatar } from "./seller-badge";

const CATEGORIES = [
  { href: "/lotes/adena", label: "Adena" },
  { href: "/lotes/cuentas", label: "Cuentas" },
  { href: "/lotes/coins", label: "Coins" },
  { href: "/lotes/items", label: "Ítems" },
  { href: "/lotes/servicios", label: "Boosting" },
  { href: "/lotes/otros", label: "Otros" },
];

export const PUBLISH_OPTIONS = [
  { href: "/publicar/cuenta", label: "Publicar cuenta", icon: "♜", img: "/lu4/icono-cuentas.webp" },
  { href: "/publicar/adena", label: "Publicar adena", icon: "◈", img: "/lu4/icono-adena.webp" },
  { href: "/publicar/item", label: "Publicar ítem", icon: "⚔", img: "/lu4/icono-items.webp" },
  { href: "/publicar/coins", label: "Publicar coins", icon: "◉", img: "/lu4/icono-coins.webp" },
  { href: "/publicar/servicio", label: "Publicar servicio", icon: "✦", img: "/lu4/icono-servicios.webp" },
  { href: "/publicar/otro", label: "Publicar otro", icon: "✚", img: "/lu4/icono-otros.webp" },
];

export function Logo() {
  return (
    <Link href="/" className="group flex shrink-0 items-center gap-2.5">
      <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-gold-2 to-[#8a5a1c] font-display text-sm font-extrabold text-gold-ink shadow-[0_0_24px_-4px_rgb(217_171_82/0.8)] transition group-hover:rotate-[-6deg]">
        AP
      </span>
      <span className="hidden leading-none min-[400px]:block">
        <span className="block font-display text-lg font-bold tracking-wider">Argenpay</span>
        <span className="block text-[10px] font-semibold tracking-[0.25em] text-gold uppercase">Lineage 2 · LU4</span>
      </span>
    </Link>
  );
}

const menuItem = "block rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-gold-2";
const navLink = "rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-gold-2";

export async function Header() {
  const session = await getSessionProfile();
  const p = session?.profile;
  let unread = 0;
  let wallet = null;
  if (p) {
    const supabase = await createClient();
    const [res, w] = await Promise.all([supabase.rpc("unread_conversations"), getMyWallet()]);
    unread = Number(res.data ?? 0);
    wallet = w;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
        <Logo />

        <nav className="ml-3 hidden items-center gap-0.5 xl:flex">
          {CATEGORIES.map((c) => (
            <Link key={c.href} href={c.href} className={navLink}>{c.label}</Link>
          ))}
        </nav>

        <form action="/lotes/todos" className="ml-auto hidden flex-1 lg:block lg:max-w-[220px]">
          <input name="q" placeholder="Buscar ofertas…" aria-label="Buscar ofertas" className="input py-2" />
        </form>

        <div className="ml-auto flex items-center gap-0.5 lg:ml-2">
          {/* Publicar */}
          <details className="group relative">
            <summary className="btn-primary shine cursor-pointer list-none px-3 py-2 [&::-webkit-details-marker]:hidden">
              <span className="text-base leading-none">+</span>
              <span className="hidden sm:inline">Publicar</span>
            </summary>
            <div className="absolute right-0 mt-2 w-56 animate-fade-up rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
              {PUBLISH_OPTIONS.map((o) => (
                <Link key={o.href} href={o.href} className={`${menuItem} flex items-center gap-3`}>
                  <Image src={o.img} alt="" width={32} height={32} className="h-8 w-8" />
                  {o.label}
                </Link>
              ))}
            </div>
          </details>

          {p ? (
            <>
              <nav className="hidden items-center md:flex">
                <Link href="/panel/comprador" className={navLink}>Compras</Link>
                <Link href="/panel/vendedor" className={navLink}>Ventas</Link>
              </nav>
              <HeaderLive userId={p.id} initialUnread={unread} initialBalance={wallet ? wallet.available : null} />
              <details className="group relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-1.5 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
                  <Avatar name={p.display_name} url={p.avatar_url} size={30} />
                  <svg viewBox="0 0 20 20" className="h-4 w-4 text-muted transition group-open:rotate-180" fill="currentColor"><path d="M5 7l5 6 5-6H5z" /></svg>
                </summary>
                <div className="absolute right-0 mt-2 w-60 animate-fade-up rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <Avatar name={p.display_name} url={p.avatar_url} size={36} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{p.display_name}</p>
                    </div>
                  </div>
                  <div className="my-1 border-t border-line" />
                  <Link href="/panel/comprador" className={menuItem}>Mis compras</Link>
                  <Link href="/panel/vendedor" className={menuItem}>Mis ventas y ofertas</Link>
                  <Link href="/mensajes" className={menuItem}>Mensajes</Link>
                  {wallet && <Link href="/saldo" className={menuItem}>Saldo</Link>}
                  <Link href={`/vendedores/${p.id}`} className={menuItem}>Mi perfil público</Link>
                  <Link href="/cuenta" className={menuItem}>Configuración</Link>
                  <Link href="/soporte" className={menuItem}>Soporte</Link>
                  {p.is_admin && <Link href="/admin" className={`${menuItem} text-gold`}>Administración</Link>}
                  <div className="my-1 border-t border-line xl:hidden" />
                  <div className="xl:hidden">
                    {CATEGORIES.map((c) => (
                      <Link key={c.href} href={c.href} className={menuItem}>{c.label}</Link>
                    ))}
                  </div>
                  <div className="my-1 border-t border-line" />
                  <form action={signOut}>
                    <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-white/5 hover:text-bad">Salir</button>
                  </form>
                </div>
              </details>
            </>
          ) : (
            <>
              <details className="group relative xl:hidden">
                <summary className="cursor-pointer list-none rounded-lg p-2 text-muted hover:bg-white/5 [&::-webkit-details-marker]:hidden" aria-label="Menú">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
                </summary>
                <div className="absolute right-0 mt-2 w-48 animate-fade-up rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
                  {CATEGORIES.map((c) => (
                    <Link key={c.href} href={c.href} className={menuItem}>{c.label}</Link>
                  ))}
                  <div className="my-1 border-t border-line sm:hidden" />
                  <Link href="/ingresar" className={`${menuItem} sm:hidden`}>Ingresar</Link>
                  <Link href="/registrarse" className={`${menuItem} sm:hidden`}>Crear cuenta</Link>
                </div>
              </details>
              <Link href="/ingresar" className="hidden rounded-lg px-3 py-2 text-sm hover:text-gold-2 sm:inline">Ingresar</Link>
              <Link href="/registrarse" className="btn-ghost hidden px-3 py-2 whitespace-nowrap sm:inline-flex">Crear cuenta</Link>
            </>
          )}
        </div>
      </div>
      <form action="/lotes/todos" className="px-4 pb-3 lg:hidden">
        <input name="q" placeholder="Buscar ofertas…" aria-label="Buscar ofertas" className="input py-2" />
      </form>
    </header>
  );
}
