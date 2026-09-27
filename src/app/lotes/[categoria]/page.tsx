import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoForm } from "@/components/auto-form";
import { LotList } from "@/components/lot-list";
import { EmptyState } from "@/components/ui";
import { getCatalog, getRatings, LOT_SELECT, type LotRow } from "@/lib/catalog";
import { EQUIPMENT, onlineCutoffISO, RACES } from "@/lib/lu4";
import { parseARSToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 30;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const PUBLISH_SLUG: Record<string, string> = { adena: "adena", cuentas: "cuenta", items: "item", servicios: "servicio", coins: "coins", otros: "otro" };

export async function generateMetadata(props: PageProps<"/lotes/[categoria]">): Promise<Metadata> {
  const { categoria } = await props.params;
  const names: Record<string, string> = { adena: "Adena", cuentas: "Cuentas", items: "Ítems", servicios: "Boosting y servicios", coins: "Coins", otros: "Otros", todos: "Todas las ofertas" };
  return { title: `${names[categoria] ?? "Ofertas"} LU4` };
}

export default async function LotsPage(props: PageProps<"/lotes/[categoria]">) {
  const { categoria } = await props.params;
  const sp = await props.searchParams;
  const { game, servers, categories } = await getCatalog();
  const category = categories.find((c) => c.slug === categoria);
  if (!category && categoria !== "todos") notFound();

  const q = one(sp.q).trim().slice(0, 80);
  const servidor = one(sp.servidor);
  const online = one(sp.online) === "1";
  const auto = one(sp.auto) === "1";
  const raza = one(sp.raza);
  const equipo = one(sp.equipo);
  const nivelMin = Number(one(sp.nivel)) || null;
  const nivelMax = Number(one(sp.nivel_max)) || null;
  const max = parseARSToCents(one(sp.max));
  const orden = one(sp.orden) || "destacadas";
  const page = Math.max(1, Number(one(sp.pagina)) || 1);
  const isAccounts = category?.slug === "cuentas";

  const supabase = await createClient();
  let lots: LotRow[] = [];
  let count = 0;
  const counts: Record<string, number> = {};
  if (game) {
    // Cantidad de ofertas por categoría (burbujas), respetando el servidor elegido.
    let countQ = supabase.from("listings").select("category_id").eq("status", "activa").eq("game_id", game.id).gt("stock", 0).limit(10000);
    if (servidor) countQ = countQ.eq("server_id", servidor);
    let query = supabase
      .from("listings")
      .select(LOT_SELECT, { count: "exact" })
      .eq("status", "activa")
      .eq("game_id", game.id)
      .gt("stock", 0);
    if (category) query = query.eq("category_id", category.id);
    if (servidor && servers.some((s) => s.id === servidor)) query = query.eq("server_id", servidor);
    if (q) query = query.ilike("title", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    if (online) query = query.gte("seller.last_seen_at", onlineCutoffISO());
    if (auto) query = query.eq("auto_delivery", true);
    if (isAccounts && RACES.some((r) => r.value === raza)) query = query.eq("char_race", raza);
    if (isAccounts && EQUIPMENT.some((e) => e.value === equipo)) query = query.eq("char_equipment", equipo);
    if (isAccounts && nivelMin) query = query.gte("char_level", nivelMin);
    if (isAccounts && nivelMax) query = query.lte("char_level", nivelMax);
    if (max !== null) query = query.lte("price_cents", max);
    query =
      orden === "precio_asc" ? query.order("price_cents", { ascending: true })
      : orden === "precio_desc" ? query.order("price_cents", { ascending: false })
      : orden === "recientes" ? query.order("created_at", { ascending: false })
      : orden === "entrega" ? query.order("auto_delivery", { ascending: false }).order("delivery_time_hours").order("price_cents")
      : orden === "stock" ? query.order("stock", { ascending: false })
      : query.order("bumped_at", { ascending: false }).order("price_cents");
    const from = (page - 1) * PAGE_SIZE;
    const [res, countRes] = await Promise.all([query.range(from, from + PAGE_SIZE - 1), countQ]);
    lots = (res.data ?? []) as unknown as LotRow[];
    count = res.count ?? 0;
    for (const r of countRes.data ?? []) counts[r.category_id] = (counts[r.category_id] ?? 0) + 1;
  }
  const ratings = await getRatings(lots.map((l) => l.seller_id));
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const href = (patch: Record<string, string | null>, base = `/lotes/${categoria}`) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) params.set(k, v);
    params.delete("pagina");
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const s = params.toString();
    return s ? `${base}?${s}` : base;
  };
  const priceDir = orden === "precio_asc" ? "asc" : orden === "precio_desc" ? "desc" : null;
  const hasFilters = q || online || auto || raza || equipo || nivelMin || nivelMax || max !== null || servidor;

  return (
    <div className="space-y-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">Lineage 2 LU4</p>
          <h1 className="h1 mt-1">{category?.name ?? "Todas las ofertas"}</h1>
          {category?.description && <p className="mt-1 max-w-2xl text-sm text-muted">{category.description}</p>}
        </div>
        {category && (
          <Link href={`/publicar/${PUBLISH_SLUG[category.slug] ?? ""}`} className="btn-ghost">
            + Vender {category.name.toLowerCase()}
          </Link>
        )}
      </div>

      {/* Burbujas de categorías con cantidad de ofertas */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pt-1 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
        {[{ id: "todos", slug: "todos", name: "Todas" }, ...categories].map((c, i) => {
          const active = categoria === c.slug;
          const n = c.slug === "todos" ? total : counts[c.id] ?? 0;
          return (
            <Link
              key={c.slug}
              href={href({}, `/lotes/${c.slug}`)}
              className={`group grid h-24 w-24 shrink-0 animate-fade-up place-items-center rounded-full border text-center transition duration-300 sm:h-28 sm:w-28 ${
                active
                  ? "border-gold bg-gradient-to-br from-gold-2 to-gold text-gold-ink shadow-[0_0_30px_-6px_rgb(217_171_82/0.8)]"
                  : "border-line bg-surface-2/70 hover:-translate-y-1 hover:border-gold/50"
              }`}
              style={{ "--i": i } as React.CSSProperties}
            >
              <span>
                <span className={`block px-2 text-sm font-bold leading-tight ${active ? "" : "text-gold-2"}`}>{c.name}</span>
                <span className={`block text-xs ${active ? "text-gold-ink/70" : "text-muted"}`}>{n}</span>
              </span>
            </Link>
          );
        })}
      </div>

      {/* Filtros */}
      <AutoForm className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <div className="lg:col-span-2">
          <label className="label text-xs text-muted" htmlFor="servidor">Servidor</label>
          <select id="servidor" name="servidor" defaultValue={servidor} className="input">
            <option value="">Todos los servidores</option>
            {servers.map((s) => <option key={s.id} value={s.id}>Lu4.org {s.name}</option>)}
          </select>
        </div>
        {isAccounts && (
          <>
            <div>
              <label className="label text-xs text-muted" htmlFor="nivel">Nivel</label>
              <div className="flex gap-2">
                <input id="nivel" name="nivel" type="number" min={1} max={99} defaultValue={nivelMin ?? ""} placeholder="mín" className="input" />
                <input name="nivel_max" type="number" min={1} max={99} defaultValue={nivelMax ?? ""} placeholder="máx" className="input" aria-label="Nivel máximo" />
              </div>
            </div>
            <div>
              <label className="label text-xs text-muted" htmlFor="raza">Raza</label>
              <select id="raza" name="raza" defaultValue={raza} className="input">
                <option value="">Todas</option>
                {RACES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs text-muted" htmlFor="equipo">Equipo</label>
              <select id="equipo" name="equipo" defaultValue={equipo} className="input">
                <option value="">Todos</option>
                {EQUIPMENT.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </div>
          </>
        )}
        <div>
          <label className="label text-xs text-muted" htmlFor="max">Precio máx.</label>
          <input id="max" name="max" inputMode="decimal" defaultValue={one(sp.max)} className="input" placeholder="$" />
        </div>
        <div className={isAccounts ? "" : "lg:col-span-2"}>
          <label className="label text-xs text-muted" htmlFor="q">Buscar en la descripción</label>
          <input id="q" name="q" type="search" defaultValue={q} className="input" placeholder={isAccounts ? "Ej: Archmage" : "Ej: entrega rápida"} />
        </div>
        <div>
          <label className="label text-xs text-muted" htmlFor="orden">Ordenar</label>
          <select id="orden" name="orden" defaultValue={orden} className="input">
            <option value="destacadas">Destacadas</option>
            <option value="precio_asc">Menor precio</option>
            <option value="precio_desc">Mayor precio</option>
            <option value="recientes">Más recientes</option>
            <option value="entrega">Entrega más rápida</option>
            <option value="stock">Mayor disponibilidad</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-6">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-bg-2 px-3 py-2 text-sm select-none has-checked:border-ok/60 has-checked:text-ok">
            <input type="checkbox" name="online" value="1" defaultChecked={online} className="accent-[var(--ok)]" />
            <span className="online-dot" /> Solo vendedores en línea
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-bg-2 px-3 py-2 text-sm select-none has-checked:border-gold/60 has-checked:text-gold-2">
            <input type="checkbox" name="auto" value="1" defaultChecked={auto} className="accent-[var(--gold)]" />
            ⚡ Entrega automática
          </label>
          <noscript><button className="btn-primary">Aplicar</button></noscript>
        </div>
      </AutoForm>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>{count} oferta{count === 1 ? "" : "s"}</span>
        {hasFilters && <Link href={`/lotes/${categoria}`} className="text-gold hover:text-gold-2">Limpiar filtros</Link>}
      </div>

      {lots.length ? (
        <LotList
          lots={lots}
          ratings={ratings}
          priceSort={{ href: href({ orden: priceDir === "asc" ? "precio_desc" : "precio_asc" }), dir: priceDir }}
        />
      ) : (
        <EmptyState title="No hay ofertas con estos filtros" href={category ? `/publicar/${PUBLISH_SLUG[category.slug] ?? ""}` : "/publicar"} cta="Publicar una oferta">
          Probá con otro servidor o quitá filtros. ¿Tenés algo para vender? Publicalo en un minuto.
        </EmptyState>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2 text-sm">
          {page > 1 && <Link className="btn-ghost" href={href({ pagina: String(page - 1) })}>← Anterior</Link>}
          <span className="text-muted">Página {page} de {totalPages}</span>
          {page < totalPages && <Link className="btn-ghost" href={href({ pagina: String(page + 1) })}>Siguiente →</Link>}
        </nav>
      )}
    </div>
  );
}
