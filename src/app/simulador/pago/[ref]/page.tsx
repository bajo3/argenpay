import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { decideSimPayment } from "@/app/actions/simulator";
import { SubmitButton } from "@/components/submit-button";
import { Flash, shortId } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getPaymentsConfig } from "@/lib/config";
import { formatARS } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Checkout simulado" };

/** Página del "procesador" simulado (pago de órdenes y cargas de saldo). Solo en modo simulado. */
export default async function SimCheckout(props: PageProps<"/simulador/pago/[ref]">) {
  const { ref } = await props.params;
  const sp = await props.searchParams;
  if (getPaymentsConfig().mode !== "simulado" || !/^[0-9a-f-]{36}$/i.test(ref)) notFound();
  const s = await requireUser(`/simulador/pago/${ref}`);

  const db = createAdminClient();
  const { data: p } = await db.from("sim_payments").select("id, order_id, user_id, purpose, amount_cents, status").eq("id", ref).maybeSingle();
  if (!p) notFound();

  let title = "Carga de saldo en Argenpay";
  let subtitle: string | null = null;
  if (p.purpose === "carga") {
    if (p.user_id !== s.userId) notFound();
  } else {
    const { data: order } = await db.from("orders").select("buyer_id, listing_snapshot").eq("id", p.order_id).single();
    if (order?.buyer_id !== s.userId) notFound();
    title = (order.listing_snapshot as { title?: string }).title ?? "Orden";
    subtitle = `Orden ${shortId(p.order_id)}`;
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="rounded-2xl border-2 border-dashed border-gold/50 bg-warn-bg p-4 text-sm text-warn-ink">
        <strong>Procesador de pagos SIMULADO.</strong> Esta pantalla reemplaza al checkout de un proveedor real. No se
        solicita ni se procesa ningún medio de pago.
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="card animate-fade-up space-y-4">
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        <p className="font-semibold">{title}</p>
        <p className="font-display text-4xl font-bold text-gold-2">{formatARS(Number(p.amount_cents))}</p>
        {p.status === "pendiente" ? (
          <div className="flex gap-2">
            <form action={decideSimPayment} className="flex-1">
              <input type="hidden" name="ref" value={p.id} />
              <input type="hidden" name="decision" value="aprobar" />
              <SubmitButton className="btn-primary shine w-full">Aprobar pago simulado</SubmitButton>
            </form>
            <form action={decideSimPayment}>
              <input type="hidden" name="ref" value={p.id} />
              <input type="hidden" name="decision" value="rechazar" />
              <SubmitButton className="btn-danger">Rechazar</SubmitButton>
            </form>
          </div>
        ) : (
          <form action={decideSimPayment}>
            <input type="hidden" name="ref" value={p.id} />
            <input type="hidden" name="decision" value="aprobar" />
            <p className="mb-3 text-sm">Estado del pago simulado: <strong>{p.status}</strong></p>
            <SubmitButton className="btn-ghost">Volver a notificar y conciliar</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
