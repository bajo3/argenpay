import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoForm } from "@/components/auto-form";
import { LotList } from "@/components/lot-list";
import { EmptyState } from "@/components/ui";
import { getCatalog, getRatings, LOT_SELECT, type LotRow } from "@/lib/catalog";
import { onlineCutoffISO, RACES } from "@/lib/lu4";
import { parseARSToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 30;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function generateMetadata(props: PageProps<"/lotes/[categoria]">): Promise<Metadata> {
  const { categoria } = await props.params;
  const names: Record<string, string> = { adena: "Adena", cuentas: "Cuentas", items: "Ítems", servicios: "Servicios", todos: "Todos los lotes" };
  return { title: `${names[categoria] ?? "Lotes"} LU4` };
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
  const raza = one(sp.raza);
  const nivel = Number(one(sp.nivel)) || null;
  const max = parseARSToCents(one(sp.max));
  const orden = one(sp.orden) || "precio_asc";
  const page = Math.max(1, Number(one(sp.pagina)) || 1);
  const isAccounts = category?.slug === "cuentas";

  const supabase = await createClient();
  let lots: LotRow[] = [];
  let count = 0;
  if (game) {
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
    if (isAccounts && RACES.some((r) => r.value === raza)) query = query.eq("char_race", raza);
    if (isAccounts && nivel) query = query.gte("char_level", nivel);
    if (max !== null) query = query.lte("price_cents", max);
    query =
      orden === "precio_desc" ? query.order("price_cents", { ascending: false })
      : orden === "recientes" ? query.order("created_at", { ascending: false })
      : orden === "entrega" ? query.order("delivery_time_hours", { ascending: true }).order("price_cents")
      : orden === "stock" ? query.order("stock", { ascending: false })
      : query.order("price_cents", { ascending: true });
    const from = (page - 1) * PAGE_SIZE;
    const res = await query.range(from, from + PAGE_SIZE - 1);
    lots = (res.data ?? []) as unknown as LotRow[];
    count = res.count ?? 0;
  }
  const ratings = await getRatings(lots.map((l) => l.seller_id));
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

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

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">Lineage 2 LU4</p>
        <h1 className="h1 mt-1">{category?.name ?? "Todos los lotes"}</h1>
        {category?.description && <p className="mt-1 text-sm text-muted">{category.description}</p>}
      </div>

      {/* Categorías */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {[{ slug: "todos", name: "Todos" }, ...categories].map((c) => (
          <Link key={c.slug} href={href({}, `/lotes/${c.slug}`)} className={`chip shrink-0 ${categoria === c.slug ? "chip-active" : ""}`}>
            {c.name}
          </Link>
        ))}
      </div>

      {/* Servidores */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <Link href={href({ servidor: null })} className={`chip shrink-0 ${!servidor ? "chip-active" : ""}`}>Todos los servidores</Link>
        {servers.map((s) => (
          <Link key={s.id} href={href({ servidor: s.id })} className={`chip shrink-0 ${servidor === s.id ? "chip-active" : ""}`}>
            {s.name}
          </Link>
        ))}
      </div>

      {/* Filtros */}
      <AutoForm className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_repeat(4,auto)] lg:items-end">
        {servidor && <input type="hidden" name="servidor" value={servidor} />}
        <div>
          <label className="label text-xs text-muted" htmlFor="q">Buscar en títulos</label>
          <input id="q" name="q" type="search" defaultValue={q} className="input" placeholder={isAccounts ? "Ej: Archmage full A" : "Ej: entrega rápida"} />
        </div>
        {isAccounts && (
          <>
            <div>
              <label className="label text-xs text-muted" htmlFor="raza">Raza</label>
              <select id="raza" name="raza" defaultValue={raza} className="input">
                <option value="">Todas</option>
                {RACES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs text-muted" htmlFor="nivel">Nivel mínimo</label>
              <input id="nivel" name="nivel" type="number" min={1} max={99} defaultValue={nivel ?? ""} className="input w-full lg:w-28" />
            </div>
          </>
        )}
        <div>
          <label className="label text-xs text-muted" htmlFor="max">Precio máx. {category ? `por ${category.unit_label}` : ""}</label>
          <input id="max" name="max" inputMode="decimal" defaultValue={one(sp.max)} className="input w-full lg:w-32" placeholder="$" />
        </div>
        <div>
          <label className="label text-xs text-muted" htmlFor="orden">Ordenar</label>
          <select id="orden" name="orden" defaultValue={orden} className="input">
            <option value="precio_asc">Menor precio</option>
            <option value="precio_desc">Mayor precio</option>
            <option value="recientes">Más recientes</option>
            <option value="entrega">Entrega más rápida</option>
            <option value="stock">Mayor disponibilidad</option>
          </select>
        </div>
        <label className="flex h-[42px] cursor-pointer items-center gap-2 rounded-xl border border-line bg-bg-2 px-3 text-sm whitespace-nowrap select-none has-checked:border-ok/60 has-checked:text-ok">
          <input type="checkbox" name="online" value="1" defaultChecked={online} className="accent-[var(--ok)]" />
          <span className="online-dot" /> Solo en línea
        </label>
        <noscript><button className="btn-primary">Aplicar</button></noscript>
      </AutoForm>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>{count} lote{count === 1 ? "" : "s"}</span>
        {(q || online || raza || nivel || max !== null || servidor) && (
          <Link href={`/lotes/${categoria}`} className="text-gold hover:text-gold-2">Limpiar filtros</Link>
        )}
      </div>

      {lots.length ? (
        <LotList lots={lots} ratings={ratings} />
      ) : (
        <EmptyState title="No hay lotes con estos filtros" href="/panel/vendedor/publicaciones/nueva" cta="Publicar un lote">
          Probá con otro servidor o quitá filtros. Si tenés {category?.name.toLowerCase() ?? "algo para vender"}, publicalo.
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
