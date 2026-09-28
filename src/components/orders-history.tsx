import Link from "next/link";
import { formatQty } from "@/lib/lu4";
import { relativeTime, type OrderListItem, type OrdersRole } from "@/lib/orders/list";
import { ORDER_STATUSES, STATUS_LABELS, STATUS_TONE } from "@/lib/orders/state-machine";
import { UserCell } from "./seller-badge";
import { EmptyState, formatDate } from "./ui";
import { Money } from "@/components/money";

const toneText = { neutral: "text-muted", info: "text-info", warn: "text-gold-2", ok: "text-ok", bad: "text-bad" } as const;

export function OrdersFilters({ base, role, values }: { base: string; role: OrdersRole; values: { code: string; user: string; status: string } }) {
  return (
    <form action={base} className="flex flex-wrap items-end gap-2">
      <input name="orden" defaultValue={values.code} placeholder="N.º de orden" className="input w-36" aria-label="Número de orden" />
      <input name="usuario" defaultValue={values.user} placeholder={role === "comprador" ? "Vendedor" : "Comprador"} className="input w-40" aria-label="Usuario" />
      <select name="estado" defaultValue={values.status} className="input w-44" aria-label="Estado">
        <option value="">Todos los estados</option>
        {ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
      </select>
      <button className="btn-primary">Mostrar</button>
      {(values.code || values.user || values.status) && <Link href={base} className="btn-ghost">Limpiar</Link>}
    </form>
  );
}

/** Historial de compras o ventas: fecha, orden, descripción, contraparte, estado y total. */
export function OrdersHistory({ rows, role }: { rows: OrderListItem[]; role: OrdersRole }) {
  if (!rows.length) {
    return role === "comprador" ? (
      <EmptyState title="No hay compras para mostrar" href="/lotes/todos" cta="Explorar ofertas" />
    ) : (
      <EmptyState title="No hay ventas para mostrar" href="/publicar" cta="Publicar una oferta" />
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface/80">
      <div className="hidden grid-cols-[150px_110px_1fr_200px_130px_120px] gap-4 border-b border-line bg-surface-2/60 px-5 py-3 text-xs font-semibold tracking-wider text-muted uppercase lg:grid">
        <span>Fecha</span><span>Orden</span><span>Descripción</span><span>{role === "comprador" ? "Vendedor" : "Comprador"}</span><span>Estado</span><span className="text-right">{role === "comprador" ? "Total" : "Tu neto"}</span>
      </div>
      <ul>
        {rows.map((o, i) => {
          const snap = o.listing_snapshot;
          return (
            <li key={o.id} className="group relative animate-fade-up border-b border-line/70 last:border-0" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
              <Link href={`/ordenes/${o.id}`} className="absolute inset-0" aria-label={`Orden ${o.code}`} />
              <div className="pointer-events-none grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 px-4 py-4 transition group-hover:bg-gold/[0.04] lg:grid-cols-[150px_110px_1fr_200px_130px_120px] lg:items-center lg:gap-4 lg:px-5">
                <span className="text-sm lg:order-none">
                  <span className="block">{formatDate(o.created_at)}</span>
                  <span className="text-xs text-muted">{relativeTime(o.created_at)}</span>
                </span>
                <span className="text-right font-mono text-sm text-gold lg:text-left">#{o.code}</span>
                <span className="col-span-2 min-w-0 lg:col-span-1">
                  <span className="line-clamp-2 text-sm group-hover:text-gold-2">
                    {snap.server ?? "Todos"}, {snap.title}, {formatQty(o.quantity, snap.unit_plural === "kk" ? "kk" : "u.", snap.unit_plural ?? "u.")}
                  </span>
                  <span className="text-xs text-muted">Lineage 2 LU4 · {snap.category}</span>
                </span>
                <span className="pointer-events-auto relative z-10"><UserCell user={o.counterpart} /></span>
                <span className={`self-center text-right text-sm font-semibold lg:text-left ${toneText[STATUS_TONE[o.status]]}`}>{STATUS_LABELS[o.status]}</span>
                <span className="col-span-2 text-right font-display text-lg font-bold lg:col-span-1">
                  <Money cents={Number(role === "comprador" ? o.price_cents : o.seller_net_cents)} />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
