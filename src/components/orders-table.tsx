import Link from "next/link";
import { formatARS } from "@/lib/money";
import type { OrderStatus } from "@/lib/orders/state-machine";
import { formatDate, shortId, StatusBadge } from "./ui";

export interface OrderListRow {
  id: string;
  status: OrderStatus;
  price_cents: number;
  seller_net_cents: number;
  commission_cents?: number;
  quantity: number;
  created_at: string;
  listing_snapshot: { title?: string; server?: string | null; unit_plural?: string; category?: string };
  counterpart?: string | null;
}

export function OrdersTable({ rows, amount = "price" }: { rows: OrderListRow[]; amount?: "price" | "net" }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface/80">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3">Orden</th>
            <th className="px-4 py-3">Publicación</th>
            <th className="px-4 py-3">Estado</th>
            <th className="px-4 py-3 text-right">{amount === "net" ? "Tu neto" : "Total"}</th>
            <th className="px-4 py-3">Fecha</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-t border-line hover:bg-gold/[0.04]">
              <td className="px-4 py-3 font-mono text-xs">
                <Link href={`/ordenes/${o.id}`} className="text-gold hover:underline">{shortId(o.id)}</Link>
              </td>
              <td className="px-4 py-3">
                <Link href={`/ordenes/${o.id}`} className="font-medium hover:text-gold-2">{o.listing_snapshot.title}</Link>
                <p className="text-xs text-muted">
                  {o.listing_snapshot.server ?? "Todos"} · {new Intl.NumberFormat("es-AR").format(o.quantity)} {o.listing_snapshot.unit_plural ?? "u."}
                  {o.counterpart ? ` · ${o.counterpart}` : ""}
                </p>
              </td>
              <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
              <td className="px-4 py-3 text-right font-semibold">
                {formatARS(Number(amount === "net" ? o.seller_net_cents : o.price_cents))}
              </td>
              <td className="px-4 py-3 text-muted">{formatDate(o.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
