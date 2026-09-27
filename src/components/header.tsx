import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "./seller-badge";

const CATEGORIES = [
  { href: "/lotes/adena", label: "Adena" },
  { href: "/lotes/cuentas", label: "Cuentas" },
  { href: "/lotes/items", label: "Ítems" },
  { href: "/lotes/servicios", label: "Servicios" },
];

export function Logo() {
  return (
    <Link href="/" className="group flex shrink-0 items-center gap-2.5">
      <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-gold-2 to-[#8a5a1c] font-display text-sm font-extrabold text-gold-ink shadow-[0_0_24px_-4px_rgb(217_171_82/0.8)] transition group-hover:rotate-[-6deg]">
        AP
      </span>
      <span className="leading-none">
        <span className="block font-display text-lg font-bold tracking-wider">Argenpay</span>
        <span className="block text-[10px] font-semibold tracking-[0.25em] text-gold uppercase">Lineage 2 · LU4</span>
      </span>
    </Link>
  );
}

export async function Header() {
  const session = await getSessionProfile();
  const p = session?.profile;
  let unread = 0;
  if (p) {
    const supabase = await createClient();
    const [, res] = await Promise.all([supabase.rpc("touch_presence"), supabase.rpc("unread_conversations")]);
    unread = Number(res.data ?? 0);
  }

  const userLinks = p
    ? [
        { href: "/panel/comprador", label: "Mis compras" },
        { href: "/panel/vendedor", label: p.is_seller ? "Mis ventas" : "Vender" },
        { href: "/cuenta", label: "Mi cuenta" },
        ...(p.is_admin ? [{ href: "/admin", label: "Administración" }] : []),
      ]
    : [];

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Logo />

        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {CATEGORIES.map((c) => (
            <Link key={c.href} href={c.href} className="rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-gold-2">
              {c.label}
            </Link>
          ))}
        </nav>

        <form action="/lotes/todos" className="ml-auto hidden flex-1 md:block md:max-w-xs">
          <input name="q" placeholder="Buscar lotes…" aria-label="Buscar lotes" className="input py-2" />
        </form>

        <div className="ml-auto flex items-center gap-1 md:ml-2">
          {p ? (
            <>
              <Link href="/mensajes" className="relative rounded-lg p-2 text-muted transition hover:bg-white/5 hover:text-gold-2" aria-label="Mensajes">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 5h16v11H8l-4 4V5z" strokeLinejoin="round" />
                </svg>
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-crimson px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <details className="group relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-1.5 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
                  <Avatar name={p.display_name} size={30} />
                  <span className="hidden max-w-28 truncate text-sm sm:block">{p.display_name}</span>
                  <svg viewBox="0 0 20 20" className="h-4 w-4 text-muted transition group-open:rotate-180" fill="currentColor"><path d="M5 7l5 6 5-6H5z" /></svg>
                </summary>
                <div className="absolute right-0 mt-2 w-56 animate-fade-up rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
                  <div className="lg:hidden">
                    {CATEGORIES.map((c) => (
                      <Link key={c.href} href={c.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-gold-2">{c.label}</Link>
                    ))}
                    <div className="my-1 border-t border-line" />
                  </div>
                  {userLinks.map((l) => (
                    <Link key={l.href} href={l.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-gold-2">{l.label}</Link>
                  ))}
                  <div className="my-1 border-t border-line" />
                  <form action={signOut}>
                    <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-white/5 hover:text-bad">Salir</button>
                  </form>
                </div>
              </details>
            </>
          ) : (
            <>
              <details className="group relative lg:hidden">
                <summary className="cursor-pointer list-none rounded-lg p-2 text-muted hover:bg-white/5 [&::-webkit-details-marker]:hidden" aria-label="Menú">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
                </summary>
                <div className="absolute right-0 mt-2 w-48 animate-fade-up rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
                  {CATEGORIES.map((c) => (
                    <Link key={c.href} href={c.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-gold-2">{c.label}</Link>
                  ))}
                  <div className="my-1 border-t border-line sm:hidden" />
                  <Link href="/ingresar" className="block rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-gold-2 sm:hidden">Ingresar</Link>
                </div>
              </details>
              <Link href="/ingresar" className="hidden rounded-lg px-3 py-2 text-sm hover:text-gold-2 sm:inline">Ingresar</Link>
              <Link href="/registrarse" className="btn-primary shine px-3 py-2 whitespace-nowrap">Crear cuenta</Link>
            </>
          )}
        </div>
      </div>
      <form action="/lotes/todos" className="px-4 pb-3 md:hidden">
        <input name="q" placeholder="Buscar lotes…" aria-label="Buscar lotes" className="input py-2" />
      </form>
    </header>
  );
}
