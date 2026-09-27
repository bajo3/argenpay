"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { parseARSToCents } from "@/lib/money";
import { getPaymentProvider } from "@/lib/payments";
import { createSimulatedDeposit } from "@/lib/payments/simulated";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { walletEnabled } from "@/lib/wallet";
import { done, errorMessage, fail, str } from "./helpers";

const MAX_DEPOSIT_CENTS = 100_000_000; // $ 1.000.000 por carga

/** Carga de saldo: crea un cobro en el procesador (simulado) y redirige a su checkout. */
export async function startDeposit(formData: FormData) {
  const s = await requireUser("/saldo");
  if (!walletEnabled()) fail("/saldo", "El saldo no está disponible");
  const cents = parseARSToCents(str(formData, "amount"));
  if (cents === null || cents < 100) fail("/saldo", "Ingresá un importe válido (mínimo $ 1,00)");
  if (cents > MAX_DEPOSIT_CENTS) fail("/saldo", "El máximo por carga es $ 1.000.000");
  let ref: string;
  try {
    ref = await createSimulatedDeposit(s.userId, cents);
  } catch (e) {
    fail("/saldo", errorMessage(e));
  }
  redirect(`/simulador/pago/${ref}`);
}

export async function requestWithdrawal(formData: FormData) {
  await requireUser("/saldo");
  if (!walletEnabled()) fail("/saldo", "El saldo no está disponible");
  const cents = parseARSToCents(str(formData, "amount"));
  if (cents === null || cents < 100) fail("/saldo", "Ingresá un importe válido (mínimo $ 1,00)");
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_withdrawal", { p_amount_cents: cents });
  if (error) fail("/saldo", error.message);
  revalidatePath("/", "layout");
  done("/saldo", "Retiro solicitado. Lo procesamos a la brevedad.");
}

export async function payWithBalance(formData: FormData) {
  const orderId = str(formData, "order_id");
  const back = `/ordenes/${orderId}`;
  await requireUser(back);
  const supabase = await createClient();
  const { error } = await supabase.rpc("pay_order_with_balance", { p_order_id: orderId });
  if (error) fail(back, error.message);
  revalidatePath("/", "layout");
  done(back, "¡Pagaste con tu saldo! El vendedor ya puede entregar.");
}

/** Admin: aprueba (envía la transferencia por el procesador) o rechaza (devuelve al saldo) un retiro. */
export async function processWithdrawal(formData: FormData) {
  const admin = await requireAdmin();
  const id = str(formData, "withdrawal_id");
  const approve = str(formData, "decision") === "aprobar";
  const note = str(formData, "note") || null;
  const db = createAdminClient();
  const { data: w } = await db.from("withdrawals").select("id, user_id, amount_cents, status, destination").eq("id", id).maybeSingle();
  if (!w || w.status !== "pendiente") fail("/admin", "El retiro ya fue procesado");

  let providerRef: string | null = null;
  if (approve) {
    const provider = getPaymentProvider();
    if (!provider?.payouts) fail("/admin", "El proveedor configurado no admite transferencias automáticas");
    try {
      const dest = w.destination as { holder_name: string; tax_id: string; cbu_or_alias: string };
      const res = await provider.payouts.payout({
        orderId: w.id,
        sellerId: w.user_id,
        amountCents: Number(w.amount_cents),
        currency: "ARS",
        idempotencyKey: `retiro:${w.id}`,
        destination: { holderName: dest.holder_name, taxId: dest.tax_id, cbuOrAlias: dest.cbu_or_alias },
      });
      if (res.state !== "aprobado") fail("/admin", "El procesador no aprobó la transferencia");
      providerRef = res.providerRef;
    } catch (e) {
      fail("/admin", errorMessage(e));
    }
  } else if (!note) {
    fail("/admin", "Indicá el motivo del rechazo");
  }

  const { error } = await db.rpc("sys_process_withdrawal", {
    p_withdrawal_id: id,
    p_approve: approve,
    p_provider_ref: providerRef,
    p_note: note,
    p_admin_id: admin.userId,
  });
  if (error) fail("/admin", error.message);
  revalidatePath("/admin");
  done("/admin", approve ? "Retiro pagado" : "Retiro rechazado y devuelto al saldo");
}
