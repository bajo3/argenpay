"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPaymentsConfig } from "@/lib/config";
import { refundOrder, startCheckout } from "@/lib/orders/service";
import { USER_TRANSITIONS, type UserAction } from "@/lib/orders/state-machine";
import { createClient } from "@/lib/supabase/server";
import { done, errorMessage, fail, str } from "./helpers";

export async function createOrder(formData: FormData) {
  const listingId = str(formData, "listing_id");
  const back = `/ofertas/${listingId}`;
  await requireUser(back);
  const cfg = getPaymentsConfig();
  if (cfg.mode === "bloqueado") fail(back, "Las compras están deshabilitadas por el momento");
  const quantity = Number(str(formData, "quantity") || "1");
  if (!Number.isInteger(quantity) || quantity < 1) fail(back, "Cantidad inválida");

  const supabase = await createClient();
  // Los importes los calcula la base de datos; el cliente solo envía publicación y cantidad.
  const { data, error } = await supabase.rpc("create_order", {
    p_listing_id: listingId,
    p_quantity: quantity,
    p_payment_mode: cfg.mode === "real" ? "real" : cfg.mode === "manual" ? "manual" : "simulado",
  });
  if (error) fail(back, error.message);
  redirect(`/ordenes/${data}`);
}

export async function payOrder(formData: FormData) {
  const orderId = str(formData, "order_id");
  const back = `/ordenes/${orderId}`;
  const s = await requireUser(back);
  let url: string;
  try {
    url = await startCheckout(orderId, s.userId);
  } catch (e) {
    fail(back, errorMessage(e));
  }
  redirect(url);
}

export async function orderAction(formData: FormData) {
  const orderId = str(formData, "order_id");
  const action = str(formData, "action") as UserAction;
  const back = `/ordenes/${orderId}`;
  await requireUser(back);
  if (!USER_TRANSITIONS.some((t) => t.action === action)) fail(back, "Acción inválida");

  const note = str(formData, "note") || null;
  const evidencePath = str(formData, "evidence_path") || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("order_action", {
    p_order_id: orderId,
    p_action: action,
    p_note: note,
    p_evidence_path: evidencePath,
  });
  if (error) fail(back, error.message);
  revalidatePath(back);
  done(back, "Orden actualizada");
}

/** El vendedor devuelve el dinero si no puede entregar, o el admin al resolver un reclamo. */
export async function requestRefund(formData: FormData) {
  const orderId = str(formData, "order_id");
  const back = str(formData, "back") === "admin" ? "/admin" : `/ordenes/${orderId}`;
  const s = await requireUser(back);
  try {
    await refundOrder(orderId, s.userId, str(formData, "note"));
  } catch (e) {
    fail(back, errorMessage(e));
  }
  revalidatePath(`/ordenes/${orderId}`);
  done(back, "Reembolso registrado");
}
