import { formatARS } from "@/lib/money";
import { METHOD_LABEL, realMethods, type ManualPaymentSettings } from "@/lib/manual-payments";
import { CopyButton } from "./copy-button";
import { ManualPayForm } from "./manual-pay-form";
import { formatDate } from "./ui";

export interface ManualReport {
  id: number;
  method: string;
  reference: string;
  status: "pendiente" | "aprobado" | "rechazado";
  admin_note: string | null;
  created_at: string;
}

const REPORT_STATUS = {
  pendiente: { label: "En verificación", cls: "border-gold/40 bg-gold/10 text-gold-2" },
  aprobado: { label: "Confirmado", cls: "border-ok/30 bg-ok/10 text-ok" },
  rechazado: { label: "Rechazado", cls: "border-bad/30 bg-bad/10 text-bad" },
} as const;

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/60 py-2 first:border-t-0">
      <div className="min-w-0">
        <p className="text-[11px] tracking-wide text-muted uppercase">{label}</p>
        <p className={`text-sm break-all select-all ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

/**
 * Instrucciones para pagar por transferencia manual. Mientras los datos de cobro sean los genéricos
 * (`configured` = false) se muestra un aviso grande para NO transferir. Nunca marca la orden como pagada.
 */
export function ManualPaymentPanel({
  orderId,
  userId,
  priceCents,
  settings,
  reports,
}: {
  orderId: string;
  userId: string;
  priceCents: number;
  settings: ManualPaymentSettings;
  reports: ManualReport[];
}) {
  const demo = !settings.configured;
  const real = realMethods(settings);
  // Con datos definitivos solo se muestran los medios que tienen datos reales.
  const showCvu = demo || real.cvu || real.alias;
  const showBinance = demo || real.binance;
  const wallets = settings.wallets.filter((w) => demo || (w.address.length >= 20 && !/ejemplo|reemplazar/i.test(w.address)));
  const usd = settings.usdRateCents ? priceCents / settings.usdRateCents : null;
  const pending = reports.some((r) => r.status === "pendiente");

  const methods = [
    ...(showCvu ? [{ id: "cvu", label: METHOD_LABEL.cvu }] : []),
    ...(showBinance ? [{ id: "binance_pay", label: METHOD_LABEL.binance_pay }] : []),
    ...(["USDT", "USDC", "BTC"] as const).filter((a) => wallets.some((w) => w.asset === a)).map((a) => ({ id: a.toLowerCase(), label: METHOD_LABEL[a.toLowerCase()] })),
  ];

  return (
    <div className="space-y-4">
      {demo && (
        <div className="rounded-xl border-2 border-bad/60 bg-bad/10 p-4 text-sm" role="alert">
          <p className="font-display text-base font-bold text-bad">DATOS DE EJEMPLO · NO TRANSFIERAS DINERO</p>
          <p className="mt-1 text-muted">Todavía no se cargaron los datos de cobro reales. Los de abajo son genéricos: cualquier envío se perdería.</p>
        </div>
      )}

      <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
        <p className="text-sm text-muted">Importe a pagar</p>
        <p className="font-display text-3xl font-bold text-gold-2">{formatARS(priceCents)}</p>
        <p className="hint mt-1">Transferí el importe exacto. Si pagás en cripto, enviá el equivalente al valor del dólar del momento.</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {showCvu && (
          <section className="rounded-xl border border-line bg-bg-2/60 p-4">
            <p className="mb-2 text-sm font-semibold">{METHOD_LABEL.cvu}</p>
            <div className="flex flex-wrap items-start gap-4">
              <div className="grid h-32 w-32 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-line bg-white">
                {settings.qrUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- QR público de Storage
                  <img src={settings.qrUrl} alt="QR de cobro" className="h-full w-full object-contain" />
                ) : (
                  <span className="px-2 text-center text-[11px] text-neutral-500">QR de ejemplo<br />(se sube desde Administración)</span>
                )}
              </div>
              <div className="min-w-[200px] flex-1">
                <Field label="Titular" value={settings.holderName} mono={false} />
                <Field label="Banco / billetera" value={settings.bankName} mono={false} />
                <Field label="CVU" value={settings.cvu} />
                <Field label="Alias" value={settings.alias} />
                <Field label="CUIT/CUIL" value={settings.cuit} />
              </div>
            </div>
          </section>
        )}

        {showBinance && (
          <section className="rounded-xl border border-line bg-bg-2/60 p-4">
            <p className="mb-2 text-sm font-semibold">{METHOD_LABEL.binance_pay}</p>
            <Field label="Binance Pay ID" value={settings.binancePayId} />
            <Field label="Email de la cuenta" value={settings.binanceEmail} mono={false} />
            <p className="hint mt-2">Enviá desde Binance Pay o con una transferencia interna. Guardá el ID de la operación.</p>
          </section>
        )}

        {wallets.map((w) => (
          <section key={w.asset} className="rounded-xl border border-line bg-bg-2/60 p-4">
            <p className="mb-2 text-sm font-semibold">
              {w.asset} <span className="font-normal text-muted">· red {w.network || "—"}</span>
            </p>
            <Field label="Dirección de depósito" value={w.address} />
            {usd && (w.asset === "USDT" || w.asset === "USDC") && (
              <p className="mt-1 text-xs text-muted">
                ≈ <strong className="text-ink">{usd.toFixed(2)} {w.asset}</strong> (referencia: dólar a {formatARS(settings.usdRateCents ?? 0)})
              </p>
            )}
            <p className="hint mt-2">Usá exactamente esta red: si enviás por otra, los fondos se pierden. Guardá el TXID.</p>
          </section>
        ))}
      </div>

      {settings.instructions && <p className="rounded-xl border border-line bg-bg-2/60 p-3 text-sm whitespace-pre-line">{settings.instructions}</p>}

      {reports.length > 0 && (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-bg-2/60 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {METHOD_LABEL[r.method] ?? r.method} · <span className="font-mono text-xs">{r.reference.slice(0, 24)}</span>
                </span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${REPORT_STATUS[r.status].cls}`}>{REPORT_STATUS[r.status].label}</span>
              </div>
              <p className="text-xs text-muted">Avisado el {formatDate(r.created_at)}</p>
              {r.admin_note && r.status === "rechazado" && <p className="mt-1 text-xs text-bad">Motivo: {r.admin_note}</p>}
            </li>
          ))}
        </ul>
      )}

      {pending ? (
        <p className="rounded-xl border border-gold/30 bg-gold/5 p-4 text-sm">
          <strong>Estamos verificando tu pago.</strong> Cuando lo confirmemos te avisamos por acá y por el chat. La verificación es manual y puede demorar.
        </p>
      ) : (
        <ManualPayForm orderId={orderId} userId={userId} methods={methods} />
      )}
    </div>
  );
}
