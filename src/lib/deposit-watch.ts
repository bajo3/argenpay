import "server-only";
import { binanceConfigured, fetchIncoming } from "@/lib/binance";
import { notifyAdmin } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
/** Evita consultas superpuestas cuando varias fuentes disparan la revisión (cron + panel abierto). */
const MIN_INTERVAL_MS = 20_000;

export interface WatchResult {
  ran: boolean;
  nuevos: number;
  coincidencias: number;
  errores: string[];
}

function fmtAmount(asset: string, amount: string) {
  const n = Number(amount);
  if (asset === "ARS") return `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${n.toLocaleString("es-AR", { maximumFractionDigits: 8 })} ${asset}`;
}

const SOURCE_LABEL = { cripto: "depósito cripto", pesos: "transferencia al CVU", binance_pay: "Binance Pay" } as const;

/** Lee los ingresos de Binance, registra los nuevos, los cruza con avisos de pago y avisa al titular. */
export async function checkIncomingDeposits({ force = false } = {}): Promise<WatchResult> {
  if (!binanceConfigured()) return { ran: false, nuevos: 0, coincidencias: 0, errores: ["Binance no está configurado (BINANCE_API_KEY / BINANCE_API_SECRET)"] };
  const db = createAdminClient();

  if (!force) {
    const { data: state } = await db.from("deposit_watch_state").select("last_run_at").single();
    if (state?.last_run_at && Date.now() - new Date(state.last_run_at).getTime() < MIN_INTERVAL_MS) {
      return { ran: false, nuevos: 0, coincidencias: 0, errores: [] };
    }
  }
  await db.rpc("sys_deposit_watch_status", { p_ok: null, p_error: null });

  const { deposits, errors } = await fetchIncoming(Date.now() - LOOKBACK_MS);
  let nuevos = 0;
  let coincidencias = 0;
  const notices: { title: string; body: string; link: string }[] = [];

  for (const d of deposits.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const { data, error } = await db.rpc("sys_record_deposit", {
      p_source_key: d.key,
      p_source: d.source,
      p_asset: d.asset,
      p_amount: Number(d.amount),
      p_network: d.network ?? undefined,
      p_tx_id: d.txId ?? undefined,
      p_payer: d.payer ?? undefined,
      p_occurred_at: d.occurredAt,
      p_raw: d.raw as never,
    });
    if (error) {
      errors.push(`registrar ${d.key}: ${error.message}`);
      continue;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { is_new: boolean; matched_order_id: string | null } | null;
    if (!row?.is_new) continue;
    nuevos++;
    if (row.matched_order_id) coincidencias++;
    notices.push({
      title: `💰 Ingresó ${fmtAmount(d.asset, d.amount)}`,
      body: [
        `${SOURCE_LABEL[d.source]}${d.network ? ` · ${d.network}` : ""}${d.payer ? ` · de ${d.payer}` : ""}`,
        row.matched_order_id
          ? `Coincide con el aviso de la orden #${row.matched_order_id.slice(0, 8).toUpperCase()}: entrá a confirmarlo.`
          : "Sin aviso de pago que coincida todavía.",
      ].join("\n"),
      link: "/admin#pagos-manuales",
    });
  }

  // Una notificación por ingreso (hasta 10); si entran más, un resumen.
  for (const n of notices.slice(0, 10)) await notifyAdmin(n);
  if (notices.length > 10) await notifyAdmin({ title: `💰 ${notices.length - 10} ingresos más`, body: "Revisá la lista en Administración.", link: "/admin#ingresos" });

  const ok = errors.length === 0;
  await db.rpc("sys_deposit_watch_status", { p_ok: ok, p_error: ok ? undefined : errors.join(" | ") });
  return { ran: true, nuevos, coincidencias, errores: errors };
}
