import "server-only";
import { createHmac } from "node:crypto";

/**
 * Lectura de ingresos en Binance con una API key de SOLO LECTURA (sin retiros ni trading).
 * Se usa para avisar al titular cuando entra dinero y para cruzarlo con los avisos de pago de los compradores.
 * Nunca mueve fondos. Binance bloquea pedidos desde EE. UU.: esta función corre en São Paulo (vercel.json).
 */
const BASE = process.env.BINANCE_API_BASE ?? "https://api.binance.com";

export interface IncomingDeposit {
  /** Identificador único estable: "<fuente>:<id>". */
  key: string;
  source: "cripto" | "pesos" | "binance_pay";
  asset: string;
  /** Importe en la unidad del activo (ej: "25.5" USDT, "15000" ARS). */
  amount: string;
  network: string | null;
  txId: string | null;
  payer: string | null;
  occurredAt: string;
  raw: Record<string, unknown>;
}

export function binanceConfigured(): boolean {
  return !!(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET);
}

export class BinanceError extends Error {}

async function signedGet(path: string, params: Record<string, string | number>): Promise<unknown> {
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  if (!key || !secret) throw new BinanceError("Faltan BINANCE_API_KEY / BINANCE_API_SECRET");
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), recvWindow: "20000", timestamp: String(Date.now()) });
  const signature = createHmac("sha256", secret).update(qs.toString()).digest("hex");
  const res = await fetch(`${BASE}${path}?${qs}&signature=${signature}`, {
    headers: { "X-MBX-APIKEY": key },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body && typeof body === "object" && "msg" in body ? String((body as { msg: unknown }).msg) : res.statusText;
    throw new BinanceError(`Binance ${path} → ${res.status}: ${msg}`);
  }
  return body;
}

/** Depósitos cripto acreditados (USDT, USDC, BTC…). status 1 = éxito, 6 = acreditado sin poder retirar aún. */
async function cryptoDeposits(since: number): Promise<IncomingDeposit[]> {
  const rows = (await signedGet("/sapi/v1/capital/deposit/hisrec", { startTime: since, limit: 1000 })) as Record<string, unknown>[];
  return (Array.isArray(rows) ? rows : [])
    .filter((d) => d.status === 1 || d.status === 6)
    .map((d) => ({
      key: `cripto:${d.id ?? d.txId}`,
      source: "cripto" as const,
      asset: String(d.coin),
      amount: String(d.amount),
      network: d.network ? String(d.network) : null,
      txId: d.txId ? String(d.txId).replace(/^Internal transfer\s*/i, "") : null,
      payer: null,
      occurredAt: new Date(Number(d.insertTime ?? Date.now())).toISOString(),
      raw: d,
    }));
}

/** Depósitos en pesos (transferencia al CVU / alias de Binance). Binance no informa quién transfirió. */
async function fiatDeposits(since: number): Promise<IncomingDeposit[]> {
  const res = (await signedGet("/sapi/v1/fiat/orders", { transactionType: 0, beginTime: since, rows: 500 })) as { data?: Record<string, unknown>[] };
  return (res?.data ?? [])
    .filter((d) => String(d.status).toLowerCase() === "successful")
    .map((d) => ({
      key: `pesos:${d.orderNo}`,
      source: "pesos" as const,
      asset: String(d.fiatCurrency ?? "ARS"),
      amount: String(d.indicatedAmount ?? d.amount),
      network: d.method ? String(d.method) : null,
      txId: String(d.orderNo),
      payer: null,
      occurredAt: new Date(Number(d.updateTime ?? d.createTime ?? Date.now())).toISOString(),
      raw: d,
    }));
}

/** Cobros recibidos por Binance Pay (importe positivo = entrante). Incluye quién pagó. */
async function payReceived(since: number): Promise<IncomingDeposit[]> {
  const res = (await signedGet("/sapi/v1/pay/transactions", { startTime: since, limit: 100 })) as { data?: Record<string, unknown>[] };
  return (res?.data ?? [])
    .filter((d) => Number(d.amount) > 0)
    .map((d) => {
      const payer = (d.payerInfo ?? {}) as { name?: string; binanceId?: string | number };
      return {
        key: `pay:${d.transactionId}`,
        source: "binance_pay" as const,
        asset: String(d.currency),
        amount: String(d.amount),
        network: null,
        txId: String(d.transactionId),
        payer: [payer.name, payer.binanceId ? `ID ${payer.binanceId}` : null].filter(Boolean).join(" · ") || null,
        occurredAt: new Date(Number(d.transactionTime ?? Date.now())).toISOString(),
        raw: d,
      };
    });
}

/** Todos los ingresos desde `since` (ms). Si una fuente falla, informa el error pero devuelve las demás. */
export async function fetchIncoming(since: number): Promise<{ deposits: IncomingDeposit[]; errors: string[] }> {
  const results = await Promise.allSettled([cryptoDeposits(since), fiatDeposits(since), payReceived(since)]);
  const deposits: IncomingDeposit[] = [];
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") deposits.push(...r.value);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  return { deposits, errors };
}
