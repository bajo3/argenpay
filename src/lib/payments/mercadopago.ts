import "server-only";
import { requireEnv } from "@/lib/config";
import { parseARSToCents } from "@/lib/money";
import type { ChargeInfo, ChargeState, PaymentProvider } from "./types";

/**
 * Adaptador de Mercado Pago (Checkout Pro + API de pagos).
 *
 * Estado: BLOQUEADO por configuración (ver src/lib/config.ts y docs/decision-pagos.md).
 * - Cobro: Checkout Pro a la cuenta de Argenpay. Técnica documentada, pero la aceptación de las
 *   categorías de Argenpay y el cobro por cuenta de terceros NO están confirmados.
 * - Reembolso: POST /v1/payments/{id}/refunds (documentado, requiere saldo suficiente, 180 días).
 * - Liquidación a vendedores: NO implementada. Split 1:1 divide el pago al aprobarse (no retiene),
 *   y "Pagos avanzados" con fecha de liberación requiere confirmación comercial.
 */
const API = "https://api.mercadopago.com";

async function mpFetch(path: string, init: RequestInit & { idempotencyKey?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${requireEnv("MERCADOPAGO_ACCESS_TOKEN")}`);
  headers.set("Content-Type", "application/json");
  if (init.idempotencyKey) headers.set("X-Idempotency-Key", init.idempotencyKey);
  const res = await fetch(`${API}${path}`, { ...init, headers, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Mercado Pago ${res.status} en ${path}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

function toCents(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  const cents = Number.isFinite(n) ? parseARSToCents(n.toFixed(2)) : null;
  if (cents === null) throw new Error(`Importe inválido de Mercado Pago: ${String(value)}`);
  return cents;
}

function mapStatus(status: unknown): ChargeState {
  switch (status) {
    case "approved":
      return "aprobado";
    case "pending":
    case "in_process":
    case "authorized":
      return "pendiente";
    case "rejected":
    case "cancelled":
      return "rechazado";
    case "refunded":
    case "charged_back":
      return "reembolsado";
    default:
      return "otro";
  }
}

export function createMercadoPagoProvider(opts: { holdAndPayoutVerified: boolean }): PaymentProvider {
  return {
    id: "mercadopago",
    label: "Mercado Pago",
    simulated: false,
    capabilities: {
      cobro: "no_verificada",
      reembolso: "no_verificada",
      liquidacion: "no_soportada",
      retencionHastaConfirmacion: opts.holdAndPayoutVerified ? "verificada" : "no_verificada",
    },
    charges: {
      async createCharge(input) {
        const pref = await mpFetch("/checkout/preferences", {
          method: "POST",
          idempotencyKey: input.idempotencyKey,
          body: JSON.stringify({
            external_reference: input.orderId,
            items: [
              {
                id: input.orderId,
                title: input.description.slice(0, 250),
                quantity: 1,
                currency_id: input.currency,
                unit_price: input.amountCents / 100,
              },
            ],
            back_urls: { success: input.returnUrl, failure: input.returnUrl, pending: input.returnUrl },
            auto_return: "approved",
            notification_url: input.notificationUrl,
            binary_mode: true,
          }),
        });
        return { providerRef: String(pref.id), redirectUrl: String(pref.init_point) };
      },
      async getCharge(paymentId): Promise<ChargeInfo> {
        const p = await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);
        const fees = Array.isArray(p.fee_details) ? (p.fee_details as { amount?: number }[]) : [];
        return {
          providerRef: String(p.id),
          orderId: typeof p.external_reference === "string" ? p.external_reference : null,
          state: mapStatus(p.status),
          amountCents: toCents(p.transaction_amount),
          currency: String(p.currency_id ?? ""),
          feeCents: fees.length ? fees.reduce((acc, f) => acc + toCents(f.amount ?? 0), 0) : null,
          raw: { id: p.id, status: p.status, status_detail: p.status_detail, money_release_date: p.money_release_date },
        };
      },
    },
    refunds: {
      async refund(input) {
        const r = await mpFetch(`/v1/payments/${encodeURIComponent(input.chargeRef)}/refunds`, {
          method: "POST",
          idempotencyKey: input.idempotencyKey,
          body: JSON.stringify({ amount: input.amountCents / 100 }),
        });
        const status = String(r.status ?? "");
        return {
          providerRef: String(r.id),
          state: status === "approved" ? "aprobado" : status === "rejected" ? "rechazado" : "pendiente",
          raw: { id: r.id, status },
        };
      },
    },
    // Sin liquidación automática: ver docs/decision-pagos.md
    payouts: null,
  };
}
