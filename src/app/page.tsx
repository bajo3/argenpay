import { existsSync } from "node:fs";
import { join } from "node:path";
import Image from "next/image";
import Link from "next/link";
import { Embers } from "@/components/embers";
import { HeroVideo } from "@/components/hero-video";
import { LotList } from "@/components/lot-list";
import { EmptyState } from "@/components/ui";
import { categoryIcon, HERO, serverEmblem } from "@/lib/assets";
import { getCatalog, getRatings, LOT_SELECT, type LotRow } from "@/lib/catalog";
import { onlineCutoffISO } from "@/lib/lu4";

import { createClient } from "@/lib/supabase/server";
import { Money } from "@/components/money";

const HAS_VIDEO = existsSync(join(process.cwd(), "public", HERO.video));

function SectionTitle({ children, href, cta }: { children: React.ReactNode; href?: string; cta?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <h2 className="flex items-center gap-3 font-display text-2xl font-bold tracking-wide">
        <span className="hidden h-px w-10 bg-gradient-to-r from-transparent to-gold sm:block" />
        {children}
      </h2>
      {href && <Link href={href} className="text-sm text-gold hover:text-gold-2">{cta} →</Link>}
    </div>
  );
}

export default async function Home() {
  const { game, servers, categories } = await getCatalog();
  const supabase = await createClient();

  const [latestRes, statsRes, onlineRes] = await Promise.all([
    game
      ? supabase.from("listings").select(LOT_SELECT).eq("status", "activa").eq("game_id", game.id).gt("stock", 0).order("bumped_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] }),
    game
      ? supabase.from("listings").select("category_id, server_id, price_cents, seller_id").eq("status", "activa").eq("game_id", game.id).gt("stock", 0).limit(5000)
      : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).gte("last_seen_at", onlineCutoffISO()),
  ]);

  const lots = (latestRes.data ?? []) as unknown as LotRow[];
  const ratings = await getRatings(lots.map((l) => l.seller_id));
  const stats = (statsRes.data ?? []) as { category_id: string; server_id: string | null; price_cents: number; seller_id: string }[];
  const byCategory = (id: string) => stats.filter((s) => s.category_id === id);
  const byServer = (id: string) => stats.filter((s) => s.server_id === id).length;
  const sellers = new Set(stats.map((s) => s.seller_id)).size;
  const online = onlineRes.count ?? 0;

  return (
    <div className="space-y-16">
      {/* Portada */}
      <section className="relative left-1/2 -mt-6 w-screen -translate-x-1/2 overflow-hidden border-b border-gold/20 sm:-mt-8">
        <div className="absolute inset-0">
          <Image src={HERO.image} alt="" fill priority sizes="100vw" className="object-cover object-[70%_center]" />
          {HAS_VIDEO && (
            <HeroVideo src={HERO.video} poster={HERO.image} className="hero-video absolute inset-0 h-full w-full object-cover object-[70%_center]" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(10_9_16/0.95)_0%,rgb(10_9_16/0.75)_38%,rgb(10_9_16/0.15)_70%,transparent_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(10_9_16/0.5)_0%,transparent_25%,transparent_70%,var(--bg)_100%)]" />
        </div>
        <Embers count={28} />
        <div className="relative mx-auto flex min-h-[560px] max-w-6xl flex-col justify-center px-4 py-20 sm:min-h-[640px]">
          <div className="max-w-2xl">
            <p className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-gold/40 bg-black/40 px-3 py-1 text-xs font-semibold tracking-wider text-gold-2 uppercase backdrop-blur">
              <span className="online-dot" /> Lu4.org · Carmine · Gamma · Black · White
            </p>
            <h1 className="animate-fade-up mt-5 font-display text-4xl leading-[1.05] font-extrabold tracking-wide drop-shadow-[0_4px_24px_rgb(0_0_0/0.8)] sm:text-6xl lg:text-7xl" style={{ "--i": 1 } as React.CSSProperties}>
              Comprá y vendé en <span className="text-gold-gradient">Lineage 2 LU4</span>
            </h1>
            <p className="animate-fade-up mt-5 max-w-xl text-base text-ink/85 sm:text-lg" style={{ "--i": 2 } as React.CSSProperties}>
              Adena por kk, cuentas, ítems, coins y boosting entre jugadores. Pagás en pesos, chateás con el vendedor y el
              pago se libera recién cuando confirmás que recibiste todo.
            </p>
            <div className="animate-fade-up mt-8 flex flex-wrap gap-3" style={{ "--i": 3 } as React.CSSProperties}>
              <Link href="/lotes/adena" className="btn-primary shine px-7 py-3.5 text-base">Comprar adena</Link>
              <Link href="/lotes/cuentas" className="btn border border-gold/40 bg-black/40 px-7 py-3.5 text-base text-ink backdrop-blur hover:border-gold hover:text-gold-2">
                Ver cuentas
              </Link>
              <Link href="/publicar" className="btn px-4 py-3.5 text-base text-muted hover:text-gold-2">+ Vender</Link>
            </div>
            <dl className="animate-fade-up mt-10 grid max-w-lg grid-cols-3 gap-3" style={{ "--i": 4 } as React.CSSProperties}>
              {[
                [String(stats.length), "ofertas activas"],
                [String(sellers), "vendedores"],
                [String(online), "en línea ahora"],
              ].map(([n, label]) => (
                <div key={label} className="rounded-xl border border-gold/20 bg-black/45 px-3 py-2.5 backdrop-blur">
                  <dt className="font-display text-2xl font-bold text-gold-2">{n}</dt>
                  <dd className="text-xs text-muted">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Servidores */}
      <section>
        <SectionTitle href="/lotes/todos" cta="Ver todas las ofertas">Servidores</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {servers.map((s, i) => {
            const emblem = serverEmblem(s.name);
            return (
              <Link
                key={s.id}
                href={`/lotes/adena?servidor=${s.id}`}
                className="card card-hover animate-fade-up group relative flex flex-col items-center overflow-hidden text-center"
                style={{ "--i": i } as React.CSSProperties}
              >
                <span className="absolute inset-x-0 -top-16 mx-auto h-40 w-40 rounded-full bg-gold/10 blur-3xl transition group-hover:bg-gold/30" />
                {emblem && (
                  <Image src={emblem} alt="" width={96} height={96} className="relative drop-shadow-[0_8px_20px_rgb(0_0_0/0.6)] transition duration-500 group-hover:scale-110 group-hover:-rotate-3" />
                )}
                <p className="relative mt-3 font-display text-xl font-bold group-hover:text-gold-2">{s.name}</p>
                <p className="relative mt-0.5 text-xs text-muted">{s.description || "Interlude x1"}</p>
                <p className="relative mt-3 text-sm"><span className="font-semibold text-gold-2">{byServer(s.id)}</span> <span className="text-muted">{byServer(s.id) === 1 ? "oferta" : "ofertas"}</span></p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Categorías */}
      <section>
        <SectionTitle>¿Qué buscás?</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {categories.map((c, i) => {
            const rows = byCategory(c.id);
            const min = rows.length ? Math.min(...rows.map((r) => Number(r.price_cents))) : null;
            const icon = categoryIcon(c.slug);
            return (
              <Link
                key={c.id}
                href={`/lotes/${c.slug}`}
                className="card card-hover animate-fade-up group relative flex items-center gap-4 overflow-hidden"
                style={{ "--i": i + 4 } as React.CSSProperties}
              >
                <span className="absolute -right-8 -bottom-8 h-32 w-32 rounded-full bg-gold/5 blur-2xl transition group-hover:bg-gold/20" />
                {icon && (
                  <Image src={icon} alt="" width={80} height={80} className="icon-float relative h-16 w-16 shrink-0 drop-shadow-[0_6px_16px_rgb(0_0_0/0.6)] sm:h-20 sm:w-20" style={{ animationDelay: `${i * 0.4}s` }} />
                )}
                <span className="relative min-w-0">
                  <span className="block font-display text-lg font-bold group-hover:text-gold-2">{c.name}</span>
                  <span className="mt-0.5 hidden text-sm text-muted sm:block">{c.description}</span>
                  <span className="mt-2 block text-sm text-muted">
                    {rows.length} {rows.length === 1 ? "oferta" : "ofertas"}{min !== null && <> · desde <span className="font-semibold text-gold-2"><Money cents={min} /></span></>}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Últimas ofertas */}
      <section>
        <SectionTitle href="/lotes/todos" cta="Ver todas">Ofertas destacadas</SectionTitle>
        {lots.length ? (
          <LotList lots={lots} ratings={ratings} />
        ) : (
          <EmptyState title="Todavía no hay ofertas publicadas" href="/publicar" cta="Publicar la primera">
            Sé la primera persona en vender en Argenpay LU4.
          </EmptyState>
        )}
      </section>

      {/* Banner asedio + cómo funciona */}
      <section className="relative overflow-hidden rounded-3xl border border-gold/20">
        <Image src={HERO.siege} alt="" fill sizes="(max-width: 1200px) 100vw, 1200px" className="object-cover object-right" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(10_9_16/0.97)_0%,rgb(10_9_16/0.85)_45%,rgb(10_9_16/0.35)_100%)]" />
        <div className="relative grid gap-6 p-6 sm:p-10 lg:grid-cols-[1fr_1.4fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold tracking-[0.25em] text-gold uppercase">Cómo funciona</p>
            <h2 className="mt-2 font-display text-3xl font-bold">Comprá seguro, como en el juego</h2>
            <p className="mt-3 text-sm text-muted">Cada compra tiene su orden, su chat y su registro. Si algo sale mal, un administrador lo resuelve.</p>
            <Link href="/como-funciona" className="btn-ghost mt-5">Ver la guía completa</Link>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {[
              ["Elegí", "Filtrá por servidor, precio por kk, nivel o raza. Mirá reseñas y si el vendedor está en línea."],
              ["Pagá", "Con tu saldo o con el procesador. El total se calcula en el servidor."],
              ["Recibí", "Por trade, correo o ⚡ entrega automática, con evidencia en la orden."],
              ["Confirmá", "Recién ahí se libera el pago al vendedor. Si no, abrís un reclamo."],
            ].map(([t, d], i) => (
              <li key={t} className="animate-fade-up rounded-2xl border border-gold/20 bg-black/50 p-4 backdrop-blur" style={{ "--i": i } as React.CSSProperties}>
                <span className="font-display text-3xl font-extrabold text-gold/50">{i + 1}</span>
                <p className="mt-1 font-semibold">{t}</p>
                <p className="mt-1 text-sm text-muted">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
