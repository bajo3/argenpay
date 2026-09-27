import "server-only";
import { getPaymentsConfig } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

/**
 * El saldo (billetera) solo existe en el entorno simulado: guardar dinero de terceros requiere
 * habilitación del procesador y asesoría legal. Ver docs/decision-pagos.md.
 */
export function walletEnabled(): boolean {
  return getPaymentsConfig().mode === "simulado";
}

export interface WalletSummary {
  available: number;
  pendingSales: number;
  pendingWithdrawals: number;
}

export async function getMyWallet(): Promise<WalletSummary | null> {
  if (!walletEnabled()) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_wallet");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    available: Number(row.available_cents ?? 0),
    pendingSales: Number(row.pending_sales_cents ?? 0),
    pendingWithdrawals: Number(row.pending_withdrawals_cents ?? 0),
  };
}

export const WALLET_KIND_LABEL: Record<string, string> = {
  carga: "Carga de saldo",
  compra: "Compra",
  venta: "Venta liberada",
  reembolso: "Reembolso",
  retiro: "Retiro solicitado",
  retiro_rechazado: "Retiro rechazado (devuelto)",
  ajuste: "Ajuste",
};
