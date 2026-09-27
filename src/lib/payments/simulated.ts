import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChargeInfo, PaymentProvider } from "./types";

/**
 * Proveedor SIMULADO. Guarda su estado en sim_payments / sim_payouts (solo service_role)
 * y se comporta como un procesador externo: el checkout vive en /simulador/pago/[ref] y
 * la confirmación se obtiene consultando el estado "oficial" del cobro, igual que con uno real.
 * No mueve dinero.
 */
export function createSimulatedProvider(): PaymentProvider {
  return {
    id: "simulado",
    label: "Proveedor simulado",
    simulated: true,
    capabilities: {
      cobro: "verificada",
      reembolso: "verificada",
      liquidacion: "verificada",
      retencionHastaConfirmacion: "verificada",
    },
    charges: {
      async createCharge(input) {
        const db = createAdminClient();
        const existing = await db
          .from("sim_payments")
          .select("id")
          .eq("idempotency_key", input.idempotencyKey)
          .maybeSingle();
        if (existing.error) throw existing.error;
        let id = existing.data?.id as string | undefined;
        if (!id) {
          const created = await db
            .from("sim_payments")
            .insert({
              order_id: input.orderId,
              amount_cents: input.amountCents,
              currency: input.currency,
              idempotency_key: input.idempotencyKey,
            })
            .select("id")
            .single();
          if (created.error) throw created.error;
          id = created.data.id as string;
        }
        return { providerRef: id, redirectUrl: `/simulador/pago/${id}` };
      },
      async getCharge(providerRef): Promise<ChargeInfo> {
        const db = createAdminClient();
        const { data, error } = await db.from("sim_payments").select("*").eq("id", providerRef).single();
        if (error) throw error;
        const state = (
          { pendiente: "pendiente", aprobado: "aprobado", rechazado: "rechazado", reembolsado: "reembolsado" } as const
        )[data.status as "pendiente"] ?? "otro";
        return {
          providerRef,
          orderId: data.order_id,
          state,
          amountCents: Number(data.amount_cents),
          currency: data.currency,
          feeCents: null,
          raw: { simulado: true, ...data },
        };
      },
    },
    refunds: {
      async refund(input) {
        const db = createAdminClient();
        const { data, error } = await db
          .from("sim_payments")
          .update({ status: "reembolsado", refunded_cents: input.amountCents, updated_at: new Date().toISOString() })
          .eq("id", input.chargeRef)
          .in("status", ["aprobado", "reembolsado"])
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) return { providerRef: `sim-refund-${input.chargeRef}`, state: "rechazado", raw: { simulado: true } };
        return { providerRef: `sim-refund-${input.chargeRef}`, state: "aprobado", raw: { simulado: true } };
      },
    },
    payouts: {
      async payout(input) {
        const db = createAdminClient();
        const { data, error } = await db
          .from("sim_payouts")
          .upsert(
            {
              reference_id: input.orderId,
              seller_id: input.sellerId,
              amount_cents: input.amountCents,
              idempotency_key: input.idempotencyKey,
            },
            { onConflict: "idempotency_key" },
          )
          .select("id")
          .single();
        if (error) throw error;
        return { providerRef: data.id as string, state: "aprobado", raw: { simulado: true } };
      },
    },
  };
}

/** Crea un cobro simulado para cargar saldo (no está asociado a una orden). */
export async function createSimulatedDeposit(userId: string, amountCents: number): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("sim_payments")
    .insert({ user_id: userId, amount_cents: amountCents, currency: "ARS", purpose: "carga" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Decide un pago simulado (lo que en un proveedor real hace el comprador en su checkout). */
export async function decideSimulatedPayment(ref: string, approve: boolean) {
  const db = createAdminClient();
  const { error } = await db
    .from("sim_payments")
    .update({ status: approve ? "aprobado" : "rechazado", updated_at: new Date().toISOString() })
    .eq("id", ref)
    .eq("status", "pendiente");
  if (error) throw error;
}
