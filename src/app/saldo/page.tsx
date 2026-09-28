import type { Metadata } from "next";
import Link from "next/link";
import { requestWithdrawal, startDeposit } from "@/app/actions/wallet";
import { MoneyInput } from "@/components/money-input";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState, Flash, formatDate, shortId } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatARS } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { getMyWallet, WALLET_KIND_LABEL, walletEnabled } from "@/lib/wallet";
import { Money } from "@/components/money";
import { PaymentData, usableMethods } from "@/components/manual-payment-panel";
import { TopupForm } from "@/components/topup-form";
import { getPaymentsConfig } from "@/lib/config";
import { getManualPaymentSettings, METHOD_LABEL } from "@/lib/manual-payments";

export const metadata: Metadata = { title: "Saldo" };

const TOPUP_STATUS: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "En verificación", cls: "border-gold/40 bg-gold/10 text-gold-2" },
  aprobado: { label: "Acreditada", cls: "border-ok/30 bg-ok/10 text-ok" },
  rechazado: { label: "Rechazada", cls: "border-bad/30 bg-bad/10 text-bad" },
};

const W_STATUS: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "border-gold/40 bg-gold/10 text-gold-2" },
  pagado: { label: "Pagado", cls: "border-ok/30 bg-ok/10 text-ok" },
  rechazado: { label: "Rechazado", cls: "border-bad/30 bg-bad/10 text-bad" },
};

export default async function WalletPage(props: PageProps<"/saldo">) {
  const sp = await props.searchParams;
  const s = await requireUser("/saldo");
  if (!walletEnabled()) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState title="El saldo no está disponible">Por ahora los pagos se hacen directamente con el procesador en cada orden.</EmptyState>
      </div>
    );
  }
  const supabase = await createClient();
  const manual = getPaymentsConfig().mode === "manual";
  const [wallet, entriesRes, withdrawalsRes, payoutRes, manualSettings, topups] = await Promise.all([
    getMyWallet(),
    supabase.from("wallet_entries").select("id, amount_cents, kind, order_id, note, created_at").eq("user_id", s.userId).order("id", { ascending: false }).limit(100),
    supabase.from("withdrawals").select("id, amount_cents, status, destination, admin_note, created_at, processed_at").eq("user_id", s.userId).order("created_at", { ascending: false }).limit(20),
    supabase.from("seller_payout_accounts").select("cbu_or_alias, holder_name").eq("seller_id", s.userId).maybeSingle(),
    manual ? getManualPaymentSettings() : Promise.resolve(null),
    manual
      ? supabase.from("manual_payments").select("id, method, reference, declared_amount, declared_currency, amount_cents, credited_cents, status, admin_note, created_at").eq("buyer_id", s.userId).eq("purpose", "carga").order("id", { ascending: false }).limit(10)
      : Promise.resolve(null),
  ]);
  const w = wallet ?? { available: 0, pendingSales: 0, pendingWithdrawals: 0 };
  const entries = entriesRes.data ?? [];
  const withdrawals = withdrawalsRes.data ?? [];

  return (
    <div className="space-y-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Saldo</h1>
          <p className="mt-1 text-sm text-muted">Tus compras, ventas liberadas, cargas y retiros en un solo lugar.</p>
        </div>
        {!manual && <span className="rounded-full border border-gold/30 bg-warn-bg px-3 py-1 text-xs font-semibold text-warn-ink">Entorno simulado · no es dinero real</span>}
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card animate-fade-up relative overflow-hidden border-gold/30">
          <span className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gold/20 blur-2xl animate-glow" />
          <p className="relative text-sm text-muted">Disponible</p>
          <p className="relative font-display text-3xl font-bold text-gold-2"><Money cents={w.available} /></p>
        </div>
        <div className="card animate-fade-up" style={{ "--i": 1 } as React.CSSProperties}>
          <p className="text-sm text-muted">Ventas en curso</p>
          <p className="font-display text-2xl font-bold"><Money cents={w.pendingSales} /></p>
          <p className="hint">Se liberan cuando el comprador confirma la recepción.</p>
        </div>
        <div className="card animate-fade-up" style={{ "--i": 2 } as React.CSSProperties}>
          <p className="text-sm text-muted">Retiros en proceso</p>
          <p className="font-display text-2xl font-bold"><Money cents={w.pendingWithdrawals} /></p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {manual && manualSettings ? (
          <section className="card animate-fade-up space-y-4 md:col-span-2">
            <div>
              <h2 className="h2">Cargar saldo</h2>
              <p className="text-sm text-muted">
                Enviá pesos o USDT a los datos de abajo y avisá la carga con el comprobante. Cuando la verificamos se acredita en tu saldo y
                podés pagar cualquier orden al instante.
              </p>
            </div>
            <div className="space-y-3">
              <PaymentData settings={manualSettings} />
            </div>
            <TopupForm userId={s.userId} methods={usableMethods(manualSettings)} rate={manualSettings.usdRateCents} />
            {!!topups?.data?.length && (
              <ul className="space-y-2 border-t border-line pt-3">
                <li className="text-xs tracking-wide text-muted uppercase">Tus últimas cargas</li>
                {topups.data.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg-2/60 p-3 text-sm">
                    <span>
                      {t.declared_currency === "ARS" ? formatARS(Math.round(Number(t.declared_amount) * 100)) : `${Number(t.declared_amount)} ${t.declared_currency}`} ·{" "}
                      {METHOD_LABEL[t.method] ?? t.method} · <span className="font-mono text-xs">{String(t.reference).slice(0, 20)}</span>
                      <span className="block text-xs text-muted">{formatDate(t.created_at)}{t.status === "rechazado" && t.admin_note ? ` · Motivo: ${t.admin_note}` : ""}</span>
                    </span>
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TOPUP_STATUS[t.status].cls}`}>
                      {t.status === "aprobado" && t.credited_cents ? <>+<Money cents={Number(t.credited_cents)} /></> : TOPUP_STATUS[t.status].label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <form action={startDeposit} className="card animate-fade-up space-y-3">
            <h2 className="h2">Cargar saldo</h2>
            <p className="text-sm text-muted">Cargá saldo para pagar tus compras al instante.</p>
            <MoneyInput name="amount" label="Importe a cargar" required placeholder="10.000,00" presets={[500_000, 1_000_000, 2_500_000, 5_000_000]} />
            <SubmitButton className="btn-primary shine w-full" pendingText="Abriendo checkout…">Cargar saldo</SubmitButton>
            <p className="hint">Vas al checkout del procesador (simulado) para aprobar la carga.</p>
          </form>
        )}

        <form action={requestWithdrawal} className={`card animate-fade-up space-y-3 ${manual ? "md:col-span-2" : ""}`} style={{ "--i": 1 } as React.CSSProperties}>
          <h2 className="h2">Retirar</h2>
          {payoutRes.data ? (
            <p className="text-sm text-muted">
              A <strong className="text-ink">{payoutRes.data.cbu_or_alias}</strong> · {payoutRes.data.holder_name}{" "}
              <Link href="/cuenta" className="text-gold hover:text-gold-2">cambiar</Link>
            </p>
          ) : (
            <p className="text-sm text-muted">
              Primero cargá tu CBU/CVU o alias en <Link href="/cuenta" className="text-gold hover:text-gold-2">Mi cuenta</Link>.
            </p>
          )}
          <div className="flex items-start gap-2">
            <MoneyInput name="amount" label="Importe a retirar" required max={w.available} placeholder={`Hasta ${formatARS(w.available).replace("$", "").trim()}`} className="flex-1" />
            <SubmitButton className="btn-ghost shrink-0" pendingText="…" confirmTitle="¿Solicitar el retiro?" confirmLabel="Sí, retirar" confirm="El importe se reserva de tu saldo hasta que un administrador procese la transferencia.">
              Retirar
            </SubmitButton>
          </div>
          <p className="hint">{manual ? "Te transferimos en pesos a tu CBU/CVU (a tu nombre). Si se rechaza, el dinero vuelve a tu saldo." : "Un administrador procesa el retiro. Si se rechaza, el dinero vuelve a tu saldo."}</p>
        </form>
      </div>

      {withdrawals.length > 0 && (
        <section className="space-y-3">
          <h2 className="h2">Retiros</h2>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface/80">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-surface-2/60 text-left text-xs tracking-wide text-muted uppercase">
                <tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Destino</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3 text-right">Importe</th></tr>
              </thead>
              <tbody>
                {withdrawals.map((x) => (
                  <tr key={x.id} className="border-t border-line">
                    <td className="px-4 py-3 text-muted">{formatDate(x.created_at)}</td>
                    <td className="px-4 py-3">{(x.destination as { cbu_or_alias?: string }).cbu_or_alias}{x.admin_note && <p className="text-xs text-muted">{x.admin_note}</p>}</td>
                    <td className="px-4 py-3"><span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${W_STATUS[x.status].cls}`}>{W_STATUS[x.status].label}</span></td>
                    <td className="px-4 py-3 text-right font-semibold"><Money cents={Number(x.amount_cents)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="h2">Movimientos</h2>
        {entries.length ? (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface/80">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-surface-2/60 text-left text-xs tracking-wide text-muted uppercase">
                <tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Concepto</th><th className="px-4 py-3">Orden</th><th className="px-4 py-3 text-right">Importe</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const amount = Number(e.amount_cents);
                  return (
                    <tr key={e.id} className="border-t border-line hover:bg-gold/[0.04]">
                      <td className="px-4 py-3 text-muted">{formatDate(e.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{WALLET_KIND_LABEL[e.kind] ?? e.kind}</span>
                        {e.note && <p className="text-xs text-muted">{e.note}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {e.order_id ? <Link href={`/ordenes/${e.order_id}`} className="text-gold hover:underline">{shortId(e.order_id)}</Link> : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${amount > 0 ? "text-ok" : "text-ink"}`}>
                        {amount > 0 ? "+" : "−"}<Money cents={Math.abs(amount)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Todavía no tenés movimientos">Cargá saldo o concretá tu primera venta.</EmptyState>
        )}
      </section>
    </div>
  );
}
