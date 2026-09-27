import Link from "next/link";
import { Embers } from "@/components/embers";
import { LotList } from "@/components/lot-list";
import { EmptyState } from "@/components/ui";
import { getCatalog, getRatings, LOT_SELECT, type LotRow } from "@/lib/catalog";
import { formatARS } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const CATEGORY_ICON: Record<string, string> = { adena: "◈", cuentas: "♜", items: "⚔", servicios: "✦", coins: "◉", otros: "✚" };

export default async function Home() {
  const { game, servers, categories } = await getCatalog();
  const supabase = await createClient();

  const [latestRes, statsRes] = await Promise.all([
    game
      ? supabase
          .from("listings")
          .select(LOT_SELECT)
          .eq("status", "activa")
          .eq("game_id", game.id)
          .gt("stock", 0)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
    game
      ? supabase.from("listings").select("category_id, server_id, price_cents").eq("status", "activa").eq("game_id", game.id).gt("stock", 0).limit(5000)
      : Promise.resolve({ data: [] }),
  ]);

  const lots = (latestRes.data ?? []) as unknown as LotRow[];
  const ratings = await getRatings(lots.map((l) => l.seller_id));
  const stats = (statsRes.data ?? []) as { category_id: string; server_id: string | null; price_cents: number }[];
  const byCategory = (id: string) => stats.filter((s) => s.category_id === id);
  const byServer = (id: string) => stats.filter((s) => s.server_id === id).length;
  const adena = categories.find((c) => c.slug === "adena");

  return (
    <div className="space-y-14">
      {/* Hero */}
      <section className="relative -mx-4 overflow-hidden rounded-none border-y border-gold/15 px-4 py-14 sm:mx-0 sm:rounded-3xl sm:border sm:px-10 sm:py-20">
        <div className="absolute inset-0 bg-[radial-gradient(700px_320px_at_20%_0%,rgb(217_171_82/0.22),transparent_70%),radial-gradient(600px_300px_at_90%_100%,rgb(194_58_75/0.18),transparent_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgb(10_9_16/0.6))]" />
        <Embers />
        <div className="relative max-w-2xl">
          <p className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-semibold tracking-wider text-gold-2 uppercase">
            <span className="online-dot" /> Carmine · Gamma · Black · White
          </p>
          <h1 className="animate-fade-up mt-5 font-display text-4xl leading-[1.1] font-extrabold tracking-wide sm:text-6xl" style={{ "--i": 1 } as React.CSSProperties}>
            El mercado de <span className="text-gold-gradient">Lineage 2 LU4</span> entre jugadores
          </h1>
          <p className="animate-fade-up mt-4 max-w-xl text-base text-muted sm:text-lg" style={{ "--i": 2 } as React.CSSProperties}>
            Adena por kk, cuentas, ítems y servicios. Chateá con el vendedor, pagá en pesos y seguí cada orden con
            registro de entrega y reclamos resueltos por nuestro equipo.
          </p>
          <div className="animate-fade-up mt-8 flex flex-wrap gap-3" style={{ "--i": 3 } as React.CSSProperties}>
            <Link href="/lotes/adena" className="btn-primary shine px-6 py-3 text-base">Comprar adena</Link>
            <Link href="/publicar" className="btn-ghost px-6 py-3 text-base">Vender en LU4</Link>
          </div>
        </div>
      </section>

      {/* Servidores */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="h2 text-xl">Servidores</h2>
          <Link href="/lotes/todos" className="text-sm text-gold hover:text-gold-2">Ver todas las ofertas →</Link>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {servers.map((s, i) => (
            <Link
              key={s.id}
              href={`/lotes/adena?servidor=${s.id}`}
              className="card card-hover animate-fade-up group relative overflow-hidden"
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="absolute -top-10 -right-10 h-28 w-28 rounded-full bg-gold/10 blur-2xl transition group-hover:bg-gold/25" />
              <p className="font-display text-xl font-bold group-hover:text-gold-2">{s.name}</p>
              <p className="mt-1 text-xs text-muted">{s.description || "Interlude x1"}</p>
              <p className="mt-4 text-sm"><span className="font-semibold text-gold-2">{byServer(s.id)}</span> <span className="text-muted">ofertas activas</span></p>
            </Link>
          ))}
        </div>
      </section>

      {/* Categorías */}
      <section>
        <h2 className="h2 mb-4 text-xl">¿Qué buscás?</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c, i) => {
            const rows = byCategory(c.id);
            const min = rows.length ? Math.min(...rows.map((r) => Number(r.price_cents))) : null;
            return (
              <Link
                key={c.id}
                href={`/lotes/${c.slug}`}
                className="card card-hover animate-fade-up group"
                style={{ "--i": i + 4 } as React.CSSProperties}
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-gold/30 bg-gold/10 text-xl text-gold-2 transition group-hover:scale-110 group-hover:rotate-6">
                  {CATEGORY_ICON[c.slug] ?? "◆"}
                </span>
                <p className="mt-4 font-display text-lg font-bold group-hover:text-gold-2">{c.name}</p>
                <p className="mt-1 text-sm text-muted">{c.description}</p>
                <p className="mt-4 text-sm text-muted">
                  {rows.length} ofertas{min !== null && <> · desde <span className="font-semibold text-gold-2">{formatARS(min)}</span>/{c.unit_label}</>}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Últimos lotes */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="h2 text-xl">Últimas ofertas publicadas</h2>
          <Link href="/lotes/todos" className="text-sm text-gold hover:text-gold-2">Ver todos →</Link>
        </div>
        {lots.length ? (
          <LotList lots={lots} ratings={ratings} />
        ) : (
          <EmptyState title="Todavía no hay ofertas publicadas" href="/publicar" cta="Publicar el primero">
            Sé la primera persona en vender {adena ? "adena" : "en LU4"} en Argenpay.
          </EmptyState>
        )}
      </section>

      {/* Cómo funciona */}
      <section className="grid gap-3 md:grid-cols-4">
        {[
          ["1", "Elegí una oferta", "Filtrá por servidor, precio por kk, raza o nivel. Mirá si el vendedor está en línea y sus reseñas."],
          ["2", "Chateá y pagá", "Consultá lo que necesites por chat antes de comprar. El total se calcula en el servidor."],
          ["3", "Recibí en el juego", "El vendedor entrega por trade o correo y deja evidencia en la orden."],
          ["4", "Confirmá o reclamá", "Confirmás la recepción o abrís un reclamo que resuelve un administrador."],
        ].map(([n, t, d], i) => (
          <div key={n} className="card animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
            <span className="font-display text-3xl font-extrabold text-gold/40">{n}</span>
            <p className="mt-2 font-semibold">{t}</p>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
