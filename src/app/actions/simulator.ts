"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPaymentsConfig } from "@/lib/config";
import { reconcileCharge } from "@/lib/orders/service";
import { decideSimulatedPayment } from "@/lib/payments/simulated";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorMessage, fail, str } from "./helpers";

/**
 * Checkout del proveedor SIMULADO. Equivale a lo que el comprador hace en la página del procesador.
 * Luego se concilia igual que una notificación real: se consulta el estado del cobro en el "proveedor"
 * y la base valida importe, moneda e idempotencia.
 */
export async function decideSimPayment(formData: FormData) {
  const ref = str(formData, "ref");
  const approve = str(formData, "decision") === "aprobar";
  const back = `/simulador/pago/${ref}`;
  if (getPaymentsConfig().mode !== "simulado") fail("/", "El simulador está deshabilitado");
  const s = await requireUser(back);

  const db = createAdminClient();
  const { data: payment } = await db
    .from("sim_payments")
    .select("order_id, user_id, purpose, amount_cents, status")
    .eq("id", ref)
    .maybeSingle();
  if (!payment) fail("/", "Pago simulado inexistente");

  // Carga de saldo
  if (payment.purpose === "carga") {
    if (payment.user_id !== s.userId) fail("/", "Este pago no te pertenece");
    try {
      if (payment.status === "pendiente") await decideSimulatedPayment(ref, approve);
      const { data: fresh } = await db.from("sim_payments").select("status").eq("id", ref).single();
      if (fresh?.status === "aprobado") {
        const { error } = await db.rpc("sys_credit_deposit", {
          p_user: s.userId,
          p_amount_cents: Number(payment.amount_cents),
          p_provider: "simulado",
          p_ref: ref,
        });
        if (error) throw error;
      }
    } catch (e) {
      fail(back, errorMessage(e));
    }
    redirect(`/saldo?${approve ? "ok=" + encodeURIComponent("Saldo acreditado") : "error=" + encodeURIComponent("Carga rechazada")}`);
  }

  // Pago de una orden
  const { data: order } = await db.from("orders").select("buyer_id").eq("id", payment.order_id).single();
  if (order?.buyer_id !== s.userId) fail("/", "Este pago no te pertenece");
  try {
    if (payment.status === "pendiente") await decideSimulatedPayment(ref, approve);
    await reconcileCharge("simulado", ref);
  } catch (e) {
    fail(back, errorMessage(e));
  }
  redirect(`/ordenes/${payment.order_id}?ok=${encodeURIComponent(approve ? "Pago simulado aprobado" : "Pago simulado rechazado")}`);
}
