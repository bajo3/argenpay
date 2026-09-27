import type { Metadata } from "next";
import Link from "next/link";
import { maintenance, settle, settleAllConfirmed } from "@/app/actions/admin";
import { orderAction, requestRefund } from "@/app/actions/orders";
import { OrdersTable, type OrderListRow } from "@/components/orders-table";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState, Flash, formatDate, shortId } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getPaymentsConfig } from "@/lib/config";
import { formatARS } from "@/lib/money";
import { getPaymentProvider } from "@/lib/payments";
import { ORDER_STATUSES, STATUS_LABELS, type OrderStatus } from "@/lib/orders/state-machine";
import { getPlatformSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Administración" };

const CAP_LABEL = { verificada: "Verificada", no_verificada: "Sin verificar", no_soportada: "No soportada" } as const;

export default async function AdminPage(props: PageProps<"/admin">) {
  const sp = await props.searchParams;
  await requireAdmin();
  const estado = typeof sp.estado === "string" && (ORDER_STATUSES as readonly string[]).includes(sp.estado) ? (sp.estado as OrderStatus) : null;

  const supabase = await createClient(); // RLS: el admin ve todo por is_admin()
  let ordersQ = supabase
    .from("orders")
    .select("id, status, price_cents, seller_net_cents, commission_cents, quantity, created_at, listing_snapshot")
    .order("created_at", { ascending: false })
    .limit(100);
  if (estado) ordersQ = ordersQ.eq("status", estado);

  const [orders, allTotals, disputes, toSettle, txs, settings] = await Promise.all([
    ordersQ,
    supabase.from("orders").select("status, price_cents, commission_cents, platform_net_cents"),
    supabase
      .from("disputes")
      .select("order_id, reason, created_at, order:orders(price_cents, listing_snapshot, buyer:profiles!orders_buyer_id_fkey(display_name), seller:profiles!orders_seller_id_fkey(display_name))")
      .eq("status", "abierto")
      .order("created_at"),
    supabase
      .from("orders")
      .select("id, seller_net_cents, commission_cents, confirmed_at, listing_snapshot, seller:profiles!orders_seller_id_fkey(display_name)")
      .eq("status", "confirmado")
      .order("confirmed_at"),
    supabase.from("payment_transactions").select("id, order_id, provider, kind, provider_ref, amount_cents, created_at").order("id", { ascending: false }).limit(15),
    getPlatformSettings(),
  ]);

  const totals = (allTotals.data ?? []).reduce(
    (acc, o) => {
      const paid = !["pendiente_pago", "cancelado"].includes(o.status);
      if (paid) acc.gmv += Number(o.price_cents);
      if (["confirmado", "liquidado"].includes(o.status)) acc.commission += Number(o.commission_cents);
      if (o.status === "liquidado") acc.net += Number(o.platform_net_cents);
      return acc;
    },
    { gmv: 0, commission: 0, net: 0 },
  );
  const cfg = getPaymentsConfig();
  const provider = getPaymentProvider();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">Administración</h1>
        <form action={maintenance}>
          <SubmitButton className="btn-ghost">Ejecutar mantenimiento (auto-confirmar / vencer)</SubmitButton>
        </form>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Volumen pagado" value={formatARS(totals.gmv)} />
        <Kpi label="Comisiones (confirmadas)" value={formatARS(totals.commission)} />
        <Kpi label="Neto plataforma (liquidado)" value={formatARS(totals.net)} />
        <Kpi label="Reclamos abiertos" value={String(disputes.data?.length ?? 0)} />
      </div>

      <section className="card space-y-2 text-sm">
        <h2 className="h2">Pagos</h2>
        <p>
          Modo: <strong>{cfg.mode}</strong> · Proveedor: <strong>{provider?.label ?? cfg.provider}</strong> · Comisión{" "}
          {settings.commissionBps / 100}% · Cargo procesador {settings.processorFeeBps / 100}% ({settings.processorFeePolicy.replace("_", " ")}) ·
          Confirmación automática a las {settings.autoConfirmHours} h
        </p>
        {cfg.blockedReason && <p className="text-bad">Bloqueado: {cfg.blockedReason}</p>}
        {provider && (
          <ul className="flex flex-wrap gap-2">
            {(Object.entries(provider.capabilities) as [string, keyof typeof CAP_LABEL][]).map(([k, v]) => (
              <li key={k} className="rounded-lg bg-bg px-2 py-1">{k}: <strong>{CAP_LABEL[v]}</strong></li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="h2">Reclamos abiertos</h2>
        {disputes.data?.length ? (
          disputes.data.map((d) => {
            const ord = d.order as unknown as { price_cents: number; listing_snapshot: { title: string }; buyer: { display_name: string }; seller: { display_name: string } };
            return (
              <div key={d.order_id} className="card space-y-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <Link href={`/ordenes/${d.order_id}`} className="font-semibold text-brand hover:underline">
                    {shortId(d.order_id)} · {ord.listing_snapshot.title}
                  </Link>
                  <span className="text-sm text-muted">{formatDate(d.created_at)} · {formatARS(Number(ord.price_cents))}</span>
                </div>
                <p className="text-sm text-muted">Comprador: {ord.buyer.display_name} · Vendedor: {ord.seller.display_name}</p>
                <p className="whitespace-pre-line text-sm">{d.reason}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <form action={orderAction} className="space-y-2">
                    <input type="hidden" name="order_id" value={d.order_id} />
                    <input type="hidden" name="action" value="resolver_vendedor" />
                    <textarea name="note" required rows={2} className="input" placeholder="Motivo de la resolución" />
                    <SubmitButton className="btn-ghost">A favor del vendedor</SubmitButton>
                  </form>
                  <form action={requestRefund} className="space-y-2">
                    <input type="hidden" name="order_id" value={d.order_id} />
                    <input type="hidden" name="back" value="admin" />
                    <textarea name="note" required rows={2} className="input" placeholder="Motivo del reembolso" />
                    <SubmitButton className="btn-danger" confirm="¿Reembolsar el total al comprador?">Reembolsar al comprador</SubmitButton>
                  </form>
                </div>
              </div>
            );
          })
        ) : (
          <EmptyState title="No hay reclamos abiertos" />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2">Pendientes de liquidación</h2>
          {!!toSettle.data?.length && (
            <form action={settleAllConfirmed}>
              <SubmitButton confirm="¿Liquidar todas las órdenes confirmadas?">Liquidar todas</SubmitButton>
            </form>
          )}
        </div>
        {toSettle.data?.length ? (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="px-4 py-3">Orden</th><th className="px-4 py-3">Vendedor</th><th className="px-4 py-3 text-right">Neto vendedor</th><th className="px-4 py-3 text-right">Comisión</th><th className="px-4 py-3" /></tr>
              </thead>
              <tbody>
                {toSettle.data.map((o) => (
                  <tr key={o.id} className="border-t border-line">
                    <td className="px-4 py-3"><Link href={`/ordenes/${o.id}`} className="text-brand">{shortId(o.id)}</Link> <span className="text-muted">{(o.listing_snapshot as { title: string }).title}</span></td>
                    <td className="px-4 py-3">{(o.seller as unknown as { display_name: string }).display_name}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatARS(Number(o.seller_net_cents))}</td>
                    <td className="px-4 py-3 text-right">{formatARS(Number(o.commission_cents))}</td>
                    <td className="px-4 py-3 text-right">
                      <form action={settle}>
                        <input type="hidden" name="order_id" value={o.id} />
                        <SubmitButton className="btn-ghost px-3 py-1.5">Liquidar</SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Nada para liquidar" />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="h2">Órdenes</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/admin" className={!estado ? "btn-primary px-3 py-1.5" : "btn-ghost px-3 py-1.5"}>Todas</Link>
          {ORDER_STATUSES.map((st) => (
            <Link key={st} href={`/admin?estado=${st}`} className={estado === st ? "btn-primary px-3 py-1.5" : "btn-ghost px-3 py-1.5"}>
              {STATUS_LABELS[st]}
            </Link>
          ))}
        </div>
        {orders.data?.length ? <OrdersTable rows={orders.data as unknown as OrderListRow[]} /> : <EmptyState title="Sin órdenes" />}
      </section>

      <section className="space-y-3">
        <h2 className="h2">Últimas transacciones con el procesador</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Proveedor / ref</th><th className="px-4 py-3">Orden</th><th className="px-4 py-3 text-right">Importe</th></tr>
            </thead>
            <tbody>
              {(txs.data ?? []).map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-4 py-3 text-muted">{formatDate(t.created_at)}</td>
                  <td className="px-4 py-3 capitalize">{t.kind}</td>
                  <td className="px-4 py-3 font-mono text-xs">{t.provider} / {String(t.provider_ref).slice(0, 18)}</td>
                  <td className="px-4 py-3"><Link href={`/ordenes/${t.order_id}`} className="text-brand">{shortId(t.order_id)}</Link></td>
                  <td className="px-4 py-3 text-right">{formatARS(Number(t.amount_cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
