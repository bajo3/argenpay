/**
 * Medios del pago manual y detección de datos genéricos. Sin dependencias del servidor para poder probarlo.
 * Mientras los datos de cobro sean los de fábrica, el sitio muestra "no transferir".
 */
export const MANUAL_METHODS = [
  { id: "cvu", label: "Transferencia / QR (CVU)", kind: "pesos" },
  { id: "binance_pay", label: "Binance Pay", kind: "cripto" },
  { id: "usdt", label: "USDT", kind: "cripto" },
  { id: "usdc", label: "USDC", kind: "cripto" },
  { id: "btc", label: "Bitcoin (BTC)", kind: "cripto" },
] as const;

export type ManualMethod = (typeof MANUAL_METHODS)[number]["id"] | "otro";
export const METHOD_LABEL: Record<string, string> = { ...Object.fromEntries(MANUAL_METHODS.map((m) => [m.id, m.label])), otro: "Otro" };

export interface CryptoWallet {
  asset: string;
  network: string;
  address: string;
}

export const IS_PLACEHOLDER = /ejemplo|reemplazar/i;

/** ¿Qué medios tienen datos reales (y no los genéricos de fábrica)? */
export function realMethods(v: { cvu: string; alias: string; binancePayId: string; wallets: { address: string }[] }) {
  return {
    cvu: /^\d{22}$/.test(v.cvu) && !/^0+$/.test(v.cvu),
    alias: v.alias.length > 0 && !IS_PLACEHOLDER.test(v.alias),
    binance: /^\d{5,}$/.test(v.binancePayId) && !/^0+$/.test(v.binancePayId),
    crypto: v.wallets.some((w) => w.address.length >= 20 && !IS_PLACEHOLDER.test(w.address)),
  };
}
