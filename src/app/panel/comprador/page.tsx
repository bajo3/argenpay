import type { Metadata } from "next";
import { OrdersTable, type OrderListRow } from "@/components/orders-table";
import { EmptyState, Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Mis compras" };

export default async function BuyerPanel(props: PageProps<"/panel/comprador">) {
  const sp = await props.searchParams;
  const s = await requireUser("/panel/comprador");
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, status, price_cents, seller_net_cents, quantity, created_at, listing_snapshot, seller:profiles!orders_seller_id_fkey(display_name)")
    .eq("buyer_id", s.userId)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []).map((o) => ({
    ...o,
    counterpart: (o.seller as unknown as { display_name: string } | null)?.display_name ?? null,
  })) as unknown as OrderListRow[];
  const active = rows.filter((o) => !["cancelado", "reembolsado", "liquidado", "confirmado"].includes(o.status));

  return (
    <div className="space-y-6">
      <h1 className="h1">Mis compras</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card"><p className="text-sm text-muted">Órdenes activas</p><p className="text-2xl font-bold">{active.length}</p></div>
        <div className="card"><p className="text-sm text-muted">Esperan tu confirmación</p><p className="text-2xl font-bold">{rows.filter((o) => o.status === "entregado").length}</p></div>
        <div className="card"><p className="text-sm text-muted">En reclamo</p><p className="text-2xl font-bold">{rows.filter((o) => o.status === "en_reclamo").length}</p></div>
      </div>
      {rows.length ? (
        <OrdersTable rows={rows} />
      ) : (
        <EmptyState title="Todavía no compraste nada" href="/buscar" cta="Explorar ofertas" />
      )}
    </div>
  );
}
