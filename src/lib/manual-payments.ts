import "server-only";
import { createClient } from "@/lib/supabase/server";

import { type CryptoWallet } from "./manual-methods";
export { IS_PLACEHOLDER, MANUAL_METHODS, METHOD_LABEL, realMethods, type CryptoWallet, type ManualMethod } from "./manual-methods";

export interface ManualPaymentSettings {
  configured: boolean;
  holderName: string;
  bankName: string;
  cvu: string;
  alias: string;
  cuit: string;
  qrUrl: string | null;
  binancePayId: string;
  binanceEmail: string;
  wallets: CryptoWallet[];
  /** ARS (centavos) por 1 USD, solo como referencia para mostrar el equivalente en USDT/USDC. */
  usdRateCents: number | null;
  usdRateAuto: boolean;
  instructions: string;
}

/** Datos de cobro que se le muestran al comprador. Mientras `configured` sea false son de ejemplo. */
export async function getManualPaymentSettings(): Promise<ManualPaymentSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("manual_payment_settings").select("*").maybeSingle();
  const wallets = Array.isArray(data?.crypto_wallets) ? (data.crypto_wallets as unknown as CryptoWallet[]) : [];
  const qrUrl = data?.qr_path ? supabase.storage.from("cobro").getPublicUrl(data.qr_path).data.publicUrl : null;
  return {
    configured: data?.configured ?? false,
    holderName: data?.holder_name ?? "",
    bankName: data?.bank_name ?? "",
    cvu: data?.cvu ?? "",
    alias: data?.alias ?? "",
    cuit: data?.cuit ?? "",
    qrUrl,
    binancePayId: data?.binance_pay_id ?? "",
    binanceEmail: data?.binance_email ?? "",
    wallets: wallets.filter((w) => w && typeof w.address === "string"),
    usdRateCents: data?.usd_rate_cents != null ? Number(data.usd_rate_cents) : null,
    usdRateAuto: data?.usd_rate_auto ?? true,
    instructions: data?.instructions ?? "",
  };
}
