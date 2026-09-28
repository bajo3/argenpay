import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cotización del dólar cripto (ARS por 1 USD, en centavos). Todo en Argenpay se contabiliza en pesos;
 * el USD es solo una forma de mostrar los importes. La cotización se actualiza sola (dolarapi.com, "cripto",
 * precio de venta) salvo que el administrador la fije a mano.
 */
export type Currency = "ARS" | "USD";
export const CURRENCY_COOKIE = "moneda";
const REFRESH_MS = 5 * 60 * 1000;

async function fetchCryptoDollar(): Promise<number | null> {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/cripto", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const d = (await res.json()) as { venta?: number };
      if (typeof d.venta === "number" && d.venta > 0) return Math.round(d.venta * 100);
    }
  } catch {
    // Probamos la fuente alternativa.
  }
  try {
    const res = await fetch("https://criptoya.com/api/usdt/ars/1", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const d = (await res.json()) as Record<string, { totalAsk?: number }>;
      const ask = d.binancep2p?.totalAsk ?? d.binance?.totalAsk;
      if (typeof ask === "number" && ask > 0) return Math.round(ask * 100);
    }
  } catch {
    // Sin cotización nueva: se mantiene la anterior.
  }
  return null;
}

/** Actualiza la cotización guardada si está vencida y en modo automático. Lo llama la tarea de cada minuto. */
export async function refreshUsdRate(): Promise<number | null> {
  const db = createAdminClient();
  const { data } = await db.from("manual_payment_settings").select("usd_rate_cents, usd_rate_auto, usd_rate_updated_at").single();
  if (!data?.usd_rate_auto) return data?.usd_rate_cents ?? null;
  if (data.usd_rate_updated_at && Date.now() - new Date(data.usd_rate_updated_at).getTime() < REFRESH_MS) return data.usd_rate_cents;
  const cents = await fetchCryptoDollar();
  if (!cents) return data.usd_rate_cents ?? null;
  await db.from("manual_payment_settings").update({ usd_rate_cents: cents, usd_rate_updated_at: new Date().toISOString() }).eq("id", true);
  revalidateTag("usd-rate", { expire: 0 });
  return cents;
}

/** Cotización para mostrar precios (cacheada 5 minutos; visible también para visitantes sin sesión). */
export const getUsdRate = unstable_cache(
  async (): Promise<number | null> => {
    const { data } = await createAdminClient().from("manual_payment_settings").select("usd_rate_cents").single();
    return data?.usd_rate_cents ? Number(data.usd_rate_cents) : null;
  },
  ["usd-rate"],
  { revalidate: 300, tags: ["usd-rate"] },
);

export async function getCurrency(): Promise<Currency> {
  const c = (await cookies()).get(CURRENCY_COOKIE)?.value;
  return c === "USD" ? "USD" : "ARS";
}
