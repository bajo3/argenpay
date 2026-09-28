import type { Metadata } from "next";
import Link from "next/link";
import { maintenance, settle, settleAllConfirmed } from "@/app/actions/admin";
import { orderAction, requestRefund } from "@/app/actions/orders";
import { reviewManualPayment, saveManualPaymentSettings } from "@/app/actions/manual-payments";
import { processWithdrawal } from "@/app/actions/wallet";
import { AlarmToggle } from "@/components/alarm-toggle";
import { CheckDepositsButton } from "@/components/check-deposits-button";
import { QrUploader } from "@/components/qr-uploader";
import { OrdersTable, type OrderListRow } from "@/components/orders-table";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState, Flash, formatDate, shortId } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getPaymentsConfig } from "@/lib/config";
import { centsToInput, formatARS } from "@/lib/money";
import { binanceConfigured } from "@/lib/binance";
import { configuredChannels } from "@/lib/notify";
import { getManualPaymentSettings, METHOD_LABEL } from "@/lib/manual-payments";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const manualOn = getPaymentsConfig().mode === "manual";
  const [orders, allTotals, disputes, toSettle, txs, settings, withdrawals, manualPending, manualSettings] = await Promise.all([
    ordersQ,
    supabase.from("orders").select("status, price_cents, commission_cents, platform_net_cents"),
    supabase
      .from("disputes")
      .select("order_id, reason, created_at, order:orders(price_cents, listing_snapshot, buyer:profiles!orders_buyer_id_fkey(display_name), seller:profiles!orders_seller_id_fkey(display_name))")
      .eq("status", "abierto")
      .order("created_at"),
    supabase
      .from("orders")
      .select("id, seller_id, payment_mode, seller_net_cents, commission_cents, confirmed_at, listing_snapshot, seller:profiles!orders_seller_id_fkey(display_name)")
      .eq("status", "confirmado")
      .order("confirmed_at"),
    supabase.from("payment_transactions").select("id, order_id, provider, kind, provider_ref, amount_cents, created_at").order("id", { ascending: false }).limit(15),
    getPlatformSettings(),
    supabase
      .from("withdrawals")
      .select("id, amount_cents, destination, created_at, user:profiles!withdrawals_user_id_fkey(display_name)")
      .eq("status", "pendiente")
      .order("created_at"),
    supabase
      .from("manual_payments")
      .select("id, order_id, purpose, method, reference, payer_name, note, proof_path, declared_amount, declared_currency, amount_cents, created_at, order:orders(price_cents, listing_snapshot), buyer:profiles!manual_payments_buyer_id_fkey(display_name)")
      .eq("status", "pendiente")
      .order("created_at"),
    getManualPaymentSettings(),
  ]);
  const [deposits, watch] = await Promise.all([
    supabase.from("incoming_deposits").select("id, source, asset, amount, network, tx_id, payer, occurred_at, matched_payment_id").order("occurred_at", { ascending: false }).limit(15),
    supabase.from("deposit_watch_state").select("last_run_at, last_ok_at, last_error").maybeSingle(),
  ]);
  const matchedByPayment = new Map((deposits.data ?? []).filter((d) => d.matched_payment_id).map((d) => [Number(d.matched_payment_id), d]));
  const binanceOn = binanceConfigured();

  // Comprobantes subidos por los compradores (bucket privado): enlaces firmados de 10 minutos.
  const proofUrls = new Map<number, string>();
  await Promise.all(
    (manualPending.data ?? []).map(async (m) => {
      if (!m.proof_path) return;
      const { data } = await supabase.storage.from("comprobantes").createSignedUrl(m.proof_path, 600);
      if (data?.signedUrl) proofUrls.set(m.id, data.signedUrl);
    }),
  );
  // Cuentas de cobro de los vendedores con órdenes de pago manual pendientes de liquidar.
  const sellerIds = [...new Set((toSettle.data ?? []).filter((o) => o.payment_mode === "manual").map((o) => o.seller_id))];
  const payoutAccounts = new Map<string, { holder_name: string; tax_id: string; cbu_or_alias: string }>();
  if (sellerIds.length) {
    const { data } = await createAdminClient().from("seller_payout_accounts").select("seller_id, holder_name, tax_id, cbu_or_alias").in("seller_id", sellerIds);
    for (const a of data ?? []) payoutAccounts.set(a.seller_id, a);
  }
  const notifyChannels = configuredChannels();

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
        {cfg.mode === "manual" && (
          <p className="text-muted">
            Pago manual: los compradores transfieren a tus datos de cobro y vos confirmás cada pago. Avisos externos:{" "}
            <strong className={notifyChannels.length ? "text-ok" : "text-warn-ink"}>{notifyChannels.length ? notifyChannels.join(" + ") : "ninguno configurado (Telegram o ntfy en las variables de entorno)"}</strong>.
          </p>
        )}
        {provider && (
          <ul className="flex flex-wrap gap-2">
            {(Object.entries(provider.capabilities) as [string, keyof typeof CAP_LABEL][]).map(([k, v]) => (
              <li key={k} className="rounded-lg bg-bg px-2 py-1">{k}: <strong>{CAP_LABEL[v]}</strong></li>
            ))}
          </ul>
        )}
      </section>

      <section id="pagos-manuales" className="space-y-3 scroll-mt-24">
        <h2 className="h2">
          Pagos por verificar{" "}
          {!!manualPending.data?.length && <span className="ml-1 rounded-full bg-crimson px-2 py-0.5 align-middle text-xs font-bold text-white">{manualPending.data.length}</span>}
        </h2>
        {!manualOn && <p className="text-sm text-muted">El modo de pago manual no está activo (PAYMENTS_PROVIDER=manual).</p>}
        {manualPending.data?.length ? (
          manualPending.data.map((m) => {
            const ord = m.order as unknown as { price_cents: number; listing_snapshot: { title: string } } | null;
            const buyer = m.buyer as unknown as { display_name: string } | null;
            const arrived = matchedByPayment.get(m.id);
            if (m.purpose === "carga" || !ord) {
              const declared = m.declared_currency === "ARS" ? formatARS(Math.round(Number(m.declared_amount) * 100)) : `${Number(m.declared_amount)} ${m.declared_currency}`;
              return (
                <div key={m.id} className="card space-y-3 border-gold/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">Carga de saldo · {buyer?.display_name}</p>
                    <span className="font-display text-xl font-bold text-gold-2">{declared}</span>
                  </div>
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <div><dt className="inline text-muted">Medio: </dt><dd className="inline">{METHOD_LABEL[m.method] ?? m.method}</dd></div>
                    <div><dt className="inline text-muted">Avisado: </dt><dd className="inline">{formatDate(m.created_at)}</dd></div>
                    <div className="sm:col-span-2"><dt className="inline text-muted">Referencia / TXID: </dt><dd className="inline font-mono break-all select-all">{m.reference}</dd></div>
                    {m.payer_name && <div><dt className="inline text-muted">Pagador: </dt><dd className="inline">{m.payer_name}</dd></div>}
                    {m.note && <div className="sm:col-span-2"><dt className="inline text-muted">Comentario: </dt><dd className="inline">{m.note}</dd></div>}
                    {proofUrls.get(m.id) && <div><a href={proofUrls.get(m.id)} target="_blank" rel="noopener noreferrer" className="text-gold underline">Ver comprobante</a></div>}
                  </dl>
                  {arrived ? (
                    <p className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">✓ Llegó a Binance: {depositAmount(arrived)} el {formatDate(arrived.occurred_at)}.</p>
                  ) : (
                    <p className="hint">Todavía no detectamos este ingreso en Binance. Verificá a mano antes de acreditar.</p>
                  )}
                  <div className="grid gap-3 md:grid-cols-2">
                    <form action={reviewManualPayment} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="payment_id" value={m.id} />
                      <input type="hidden" name="decision" value="aprobar" />
                      <input type="hidden" name="purpose" value="carga" />
                      <div className="min-w-40 flex-1">
                        <label className="label" htmlFor={`credit-${m.id}`}>Pesos a acreditar</label>
                        <input id={`credit-${m.id}`} name="credit" required inputMode="decimal" className="input font-semibold tabular-nums" defaultValue={m.amount_cents ? centsToInput(Number(m.amount_cents)) : ""} placeholder="15.000,00" />
                      </div>
                      <SubmitButton className="btn-primary shine" confirmTitle="¿Acreditar la carga?" confirmLabel="Sí, acreditar" confirm="El importe entra al saldo del usuario y lo puede usar al instante. Verificá que el dinero haya llegado.">
                        Acreditar
                      </SubmitButton>
                    </form>
                    <form action={reviewManualPayment} className="flex gap-2 self-end">
                      <input type="hidden" name="payment_id" value={m.id} />
                      <input type="hidden" name="decision" value="rechazar" />
                      <input name="note" required placeholder="Motivo (lo ve el usuario)" className="input" />
                      <SubmitButton className="btn-danger shrink-0" danger confirmTitle="¿Rechazar la carga?" confirmLabel="Sí, rechazar" confirm="El usuario ve el motivo en su página de saldo.">Rechazar</SubmitButton>
                    </form>
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="card space-y-3 border-gold/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/ordenes/${m.order_id}`} className="font-semibold text-brand hover:underline">
                    {shortId(m.order_id)} · {ord.listing_snapshot.title}
                  </Link>
                  <span className="font-display text-xl font-bold text-gold-2">{formatARS(Number(ord.price_cents))}</span>
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div><dt className="inline text-muted">Comprador: </dt><dd className="inline">{buyer?.display_name}</dd></div>
                  <div><dt className="inline text-muted">Medio: </dt><dd className="inline">{METHOD_LABEL[m.method] ?? m.method}</dd></div>
                  <div className="sm:col-span-2"><dt className="inline text-muted">Referencia / TXID: </dt><dd className="inline font-mono break-all select-all">{m.reference}</dd></div>
                  {m.payer_name && <div><dt className="inline text-muted">Pagador: </dt><dd className="inline">{m.payer_name}</dd></div>}
                  {m.note && <div className="sm:col-span-2"><dt className="inline text-muted">Comentario: </dt><dd className="inline">{m.note}</dd></div>}
                  <div><dt className="inline text-muted">Avisado: </dt><dd className="inline">{formatDate(m.created_at)}</dd></div>
                  {proofUrls.get(m.id) && (
                    <div><a href={proofUrls.get(m.id)} target="_blank" rel="noopener noreferrer" className="text-gold underline">Ver comprobante</a></div>
                  )}
                </dl>
                {matchedByPayment.get(m.id) ? (
                  <p className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
                    ✓ Llegó a Binance: {depositAmount(matchedByPayment.get(m.id)!)} el {formatDate(matchedByPayment.get(m.id)!.occurred_at)}. Revisá que el importe alcance y confirmá.
                  </p>
                ) : (
                  <p className="hint">Todavía no detectamos este ingreso en Binance. Verificá a mano que llegó el importe completo antes de confirmar.</p>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  <form action={reviewManualPayment} className="flex items-end gap-2">
                    <input type="hidden" name="payment_id" value={m.id} />
                    <input type="hidden" name="decision" value="aprobar" />
                    <SubmitButton
                      className="btn-primary shine"
                      confirmTitle="¿Ya te llegó el pago?"
                      confirmLabel="Sí, confirmar pago"
                      confirm={`Confirmás que recibiste ${formatARS(Number(ord.price_cents))} (o su equivalente). La orden pasa a "pago confirmado" y el vendedor puede entregar.`}
                    >
                      Confirmar pago
                    </SubmitButton>
                  </form>
                  <form action={reviewManualPayment} className="flex gap-2">
                    <input type="hidden" name="payment_id" value={m.id} />
                    <input type="hidden" name="decision" value="rechazar" />
                    <input name="note" required placeholder="Motivo (lo ve el comprador)" className="input" />
                    <SubmitButton className="btn-danger shrink-0" danger confirmTitle="¿Rechazar el aviso?" confirmLabel="Sí, rechazar" confirm="El comprador recibe el motivo y puede volver a avisar.">Rechazar</SubmitButton>
                  </form>
                </div>
              </div>
            );
          })
        ) : (
          <EmptyState title="No hay pagos por verificar" />
        )}
      </section>

      <section id="ingresos" className="space-y-3 scroll-mt-24">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2">Ingresos detectados en Binance</h2>
          {binanceOn && <CheckDepositsButton />}
        </div>
        <AlarmToggle />
        {!binanceOn ? (
          <p className="card text-sm text-muted">
            Falta conectar Binance: creá una API key de <strong>solo lectura</strong> y cargala en Vercel como BINANCE_API_KEY y BINANCE_API_SECRET.
          </p>
        ) : (
          <p className="text-xs text-muted">
            Última revisión: {formatDate(watch.data?.last_run_at ?? null)} · última correcta: {formatDate(watch.data?.last_ok_at ?? null)}
            {watch.data?.last_error && <span className="block text-bad">Error: {watch.data.last_error}</span>}
          </p>
        )}
        {deposits.data?.length ? (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Origen</th><th className="px-4 py-3">Referencia</th><th className="px-4 py-3">Aviso</th><th className="px-4 py-3 text-right">Importe</th></tr>
              </thead>
              <tbody>
                {deposits.data.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className="px-4 py-3 text-muted">{formatDate(d.occurred_at)}</td>
                    <td className="px-4 py-3">{d.source === "pesos" ? "CVU (pesos)" : d.source === "binance_pay" ? "Binance Pay" : `Cripto${d.network ? ` · ${d.network}` : ""}`}{d.payer && <span className="block text-xs text-muted">{d.payer}</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs break-all">{d.tx_id ? String(d.tx_id).slice(0, 22) : "—"}</td>
                    <td className="px-4 py-3">{d.matched_payment_id ? <span className="text-ok">Coincide</span> : <span className="text-muted">Sin aviso</span>}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ok">+{depositAmount(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          binanceOn && <EmptyState title="Todavía no se detectaron ingresos" />
        )}
      </section>

      <section id="datos-de-cobro" className="card space-y-4 scroll-mt-24">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2">Datos de cobro (pago manual)</h2>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${manualSettings.configured ? "border-ok/30 bg-ok/10 text-ok" : "border-bad/40 bg-bad/10 text-bad"}`}>
            {manualSettings.configured ? "Datos definitivos" : "Datos de ejemplo · no se debe transferir"}
          </span>
        </div>
        <p className="text-sm text-muted">Esto es lo que ven los compradores. Reemplazá los genéricos por los tuyos y marcá &quot;definitivos&quot; para sacar el aviso de ejemplo. Nada de esto cambia importes ni estados de órdenes.</p>
        <form action={saveManualPaymentSettings} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="holder_name">Titular</label><input id="holder_name" name="holder_name" className="input" defaultValue={manualSettings.holderName} maxLength={120} /></div>
            <div><label className="label" htmlFor="bank_name">Banco / billetera</label><input id="bank_name" name="bank_name" className="input" defaultValue={manualSettings.bankName} maxLength={80} /></div>
            <div><label className="label" htmlFor="cvu">CVU / CBU (22 dígitos)</label><input id="cvu" name="cvu" className="input font-mono" defaultValue={manualSettings.cvu} inputMode="numeric" maxLength={22} /></div>
            <div><label className="label" htmlFor="alias">Alias</label><input id="alias" name="alias" className="input" defaultValue={manualSettings.alias} maxLength={40} /></div>
            <div><label className="label" htmlFor="cuit">CUIT/CUIL del titular</label><input id="cuit" name="cuit" className="input font-mono" defaultValue={manualSettings.cuit} maxLength={20} /></div>
          </div>
          <div>
            <p className="label">QR de cobro</p>
            <QrUploader currentUrl={manualSettings.qrUrl} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="binance_pay_id">Binance Pay ID</label><input id="binance_pay_id" name="binance_pay_id" className="input font-mono" defaultValue={manualSettings.binancePayId} maxLength={40} /></div>
            <div><label className="label" htmlFor="binance_email">Email de la cuenta Binance (opcional)</label><input id="binance_email" name="binance_email" className="input" defaultValue={manualSettings.binanceEmail} maxLength={120} /></div>
          </div>
          <div className="space-y-2">
            <p className="label">Direcciones de depósito cripto</p>
            {(["USDT", "USDC", "BTC"] as const).map((asset) => {
              const w = manualSettings.wallets.find((x) => x.asset === asset);
              return (
                <div key={asset} className="grid gap-2 sm:grid-cols-[80px_140px_1fr]">
                  <span className="self-center text-sm font-semibold">{asset}</span>
                  <input name={`network_${asset}`} className="input" placeholder="Red (TRC20, BEP20…)" defaultValue={w?.network ?? ""} maxLength={30} />
                  <input name={`address_${asset}`} className="input font-mono" placeholder="Dirección (vacío = no aceptar)" defaultValue={w?.address ?? ""} maxLength={120} />
                </div>
              );
            })}
            <p className="hint">Verificá dos veces cada dirección y la red: un error significa fondos perdidos.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="usd_rate_auto" defaultChecked={manualSettings.usdRateAuto} /> Actualizar sola con el dólar cripto (cada 5 min)
              </label>
              <label className="label mt-2" htmlFor="usd_rate">Cotización del dólar (ARS por 1 USD)</label>
              <input id="usd_rate" name="usd_rate" className="input" inputMode="decimal" placeholder="1.200,00" defaultValue={manualSettings.usdRateCents ? centsToInput(manualSettings.usdRateCents) : ""} />
              <p className="hint">Se usa para mostrar precios en USD y convertir las cargas en USDT/USDC. Si la actualización automática está activa, este valor se ignora.</p>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="instructions">Instrucciones extra para el comprador (opcional)</label>
            <textarea id="instructions" name="instructions" rows={3} maxLength={1500} className="input" defaultValue={manualSettings.instructions} placeholder="Ej: horario de verificación, qué hacer si pasan más de 2 horas…" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="configured" defaultChecked={manualSettings.configured} className="mt-1" />
            <span>Estos datos son <strong>definitivos</strong>: verifiqué cada cuenta y dirección. (Sin esto los compradores ven el aviso de &quot;datos de ejemplo&quot;.)</span>
          </label>
          <SubmitButton className="btn-primary shine" pendingText="Guardando…">Guardar datos de cobro</SubmitButton>
        </form>
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
                    <SubmitButton className="btn-danger" danger confirmLabel="Sí, reembolsar" confirm="Se devuelve el total al comprador.">Reembolsar al comprador</SubmitButton>
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
        <h2 className="h2">Retiros pendientes</h2>
        {withdrawals.data?.length ? (
          <div className="space-y-3">
            {withdrawals.data.map((w) => {
              const dest = w.destination as { holder_name?: string; tax_id?: string; cbu_or_alias?: string };
              return (
                <div key={w.id} className="card flex flex-wrap items-center gap-4">
                  <div className="min-w-48 flex-1 text-sm">
                    <p className="font-semibold">{(w.user as unknown as { display_name: string } | null)?.display_name}</p>
                    <p className="text-muted">{dest.holder_name} · CUIT {dest.tax_id} · {dest.cbu_or_alias}</p>
                    <p className="text-xs text-muted">{formatDate(w.created_at)}</p>
                  </div>
                  <p className="font-display text-xl font-bold text-gold-2">{formatARS(Number(w.amount_cents))}</p>
                  <form action={processWithdrawal} className="flex gap-2">
                    <input type="hidden" name="withdrawal_id" value={w.id} />
                    <input type="hidden" name="decision" value="aprobar" />
                    {manualOn && <input name="reference" required minLength={4} placeholder="Nº de comprobante" className="input w-40" />}
                    <SubmitButton
                      confirmTitle={manualOn ? "¿Ya transferiste este retiro?" : "¿Pagar el retiro?"}
                      confirmLabel={manualOn ? "Sí, ya transferí" : "Sí, pagar"}
                      confirm={manualOn ? "Confirmá que ya le transferiste el importe al CBU/CVU del usuario. Queda registrado como pagado." : "¿Transferir este retiro? (simulado)"}
                    >
                      {manualOn ? "Marcar pagado" : "Pagar"}
                    </SubmitButton>
                  </form>
                  <form action={processWithdrawal} className="flex gap-2">
                    <input type="hidden" name="withdrawal_id" value={w.id} />
                    <input type="hidden" name="decision" value="rechazar" />
                    <input name="note" required placeholder="Motivo" className="input w-36" />
                    <SubmitButton className="btn-danger">Rechazar</SubmitButton>
                  </form>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No hay retiros pendientes" />
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
                      <form action={settle} className="flex flex-wrap items-center justify-end gap-2">
                        <input type="hidden" name="order_id" value={o.id} />
                        {o.payment_mode === "manual" && (
                          <>
                            <span className="basis-full text-left text-xs text-muted">
                              {payoutAccounts.get(o.seller_id)
                                ? `Transferir a ${payoutAccounts.get(o.seller_id)!.holder_name} · CUIT ${payoutAccounts.get(o.seller_id)!.tax_id} · ${payoutAccounts.get(o.seller_id)!.cbu_or_alias}`
                                : "El vendedor todavía no cargó su cuenta de cobro"}
                            </span>
                            <input name="reference" required minLength={4} placeholder="Nº de comprobante de tu transferencia" className="input w-56" />
                          </>
                        )}
                        <SubmitButton
                          className="btn-ghost px-3 py-1.5"
                          confirm={o.payment_mode === "manual" ? "Confirmá que ya transferiste el neto al vendedor. Esto deja la orden como liquidada." : undefined}
                          confirmTitle="¿Ya le transferiste al vendedor?"
                          confirmLabel="Sí, marcar liquidada"
                        >
                          {o.payment_mode === "manual" ? "Marcar liquidada" : "Liquidar"}
                        </SubmitButton>
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

function depositAmount(d: { asset: string; amount: number | string }) {
  const n = Number(d.amount);
  return d.asset === "ARS" ? formatARS(Math.round(n * 100)) : `${n.toLocaleString("es-AR", { maximumFractionDigits: 8 })} ${d.asset}`;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
