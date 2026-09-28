import "server-only";
import { getPaymentsConfig, siteUrl } from "@/lib/config";
import { getPaymentProvider, getProviderById } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowed, SYSTEM_TRANSITIONS, type Actor, type OrderStatus } from "./state-machine";

/**
 * Operaciones que involucran al procesador de pagos. Se ejecutan SOLO en el servidor,
 * con service_role, después de validar actor y estado. El cliente nunca cambia estados de pago.
 */

export class OrderError extends Error {}

interface OrderRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  status: OrderStatus;
  price_cents: number;
  seller_net_cents: number;
  currency: string;
  payment_mode: "simulado" | "real" | "manual";
  payment_provider: string | null;
  listing_snapshot: { title?: string };
}

async function loadOrder(orderId: string): Promise<OrderRow> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("orders")
    .select("id, buyer_id, seller_id, status, price_cents, seller_net_cents, currency, payment_mode, payment_provider, listing_snapshot")
    .eq("id", orderId)
    .single();
  if (error || !data) throw new OrderError("Orden inexistente");
  return { ...data, price_cents: Number(data.price_cents), seller_net_cents: Number(data.seller_net_cents) } as OrderRow;
}

async function actorFor(order: OrderRow, userId: string): Promise<Actor | null> {
  if (order.buyer_id === userId) return "comprador";
  if (order.seller_id === userId) return "vendedor";
  const db = createAdminClient();
  const { data } = await db.from("profiles").select("is_admin").eq("id", userId).single();
  return data?.is_admin ? "admin" : null;
}

function modeMatches(order: OrderRow) {
  const cfg = getPaymentsConfig();
  return order.payment_mode === cfg.mode;
}

/** Inicia el cobro de una orden pendiente. Devuelve la URL del checkout del proveedor. */
export async function startCheckout(orderId: string, userId: string): Promise<string> {
  const order = await loadOrder(orderId);
  if (order.buyer_id !== userId) throw new OrderError("Solo el comprador puede pagar esta orden");
  if (order.status !== "pendiente_pago") throw new OrderError("La orden no está pendiente de pago");
  if (!modeMatches(order)) throw new OrderError("El modo de pagos cambió; cancelá la orden y creá una nueva");
  const provider = getPaymentProvider();
  if (!provider?.charges) throw new OrderError("Los pagos no están habilitados");

  const { redirectUrl } = await provider.charges.createCharge({
    orderId: order.id,
    amountCents: order.price_cents,
    currency: order.currency,
    description: `Argenpay · ${order.listing_snapshot.title ?? "Orden"}`,
    idempotencyKey: `cobro:${order.id}`,
    returnUrl: `${siteUrl()}/ordenes/${order.id}`,
    notificationUrl: `${siteUrl()}/api/webhooks/${provider.id}`,
  });
  return redirectUrl;
}

/**
 * Concilia un cobro: consulta el estado oficial en el proveedor y, si está aprobado y el importe
 * coincide, confirma el pago de la orden. Idempotente (unique provider+ref en payment_transactions).
 */
export async function reconcileCharge(providerId: string, providerRef: string): Promise<string> {
  const provider = getProviderById(providerId);
  if (!provider?.charges) throw new OrderError("Proveedor no habilitado");
  const charge = await provider.charges.getCharge(providerRef);
  if (!charge.orderId) return "sin_referencia";
  if (charge.state !== "aprobado") return `estado_${charge.state}`;

  const db = createAdminClient();
  const { data, error } = await db.rpc("sys_confirm_payment", {
    p_order_id: charge.orderId,
    p_provider: provider.id,
    p_provider_ref: charge.providerRef,
    p_amount_cents: charge.amountCents,
    p_currency: charge.currency,
    p_fee_cents: charge.feeCents,
    p_raw: charge.raw,
  });
  if (error) throw error;
  return String(data);
}

/** Reembolso total. Lo pueden pedir el vendedor (si no puede entregar) o un admin (resolución de reclamo). */
export async function refundOrder(orderId: string, userId: string, note: string): Promise<void> {
  const order = await loadOrder(orderId);
  const actor = await actorFor(order, userId);
  if (!actor || !isAllowed(SYSTEM_TRANSITIONS, "reembolsar", order.status, actor)) {
    throw new OrderError("No podés reembolsar esta orden en su estado actual");
  }
  if (!note.trim()) throw new OrderError("Indicá el motivo del reembolso");
  if (!modeMatches(order) || !order.payment_provider) throw new OrderError("La orden no pertenece al modo de pagos activo");

  // Pago manual: el dinero está en la cuenta de Argenpay, así que solo un administrador puede devolverlo
  // (por transferencia) y dejarlo registrado. El vendedor no tiene cómo hacerlo.
  if (order.payment_mode === "manual") {
    if (actor !== "admin") {
      throw new OrderError("En pagos por transferencia el reembolso lo registra un administrador tras devolver el dinero. Escribile a soporte.");
    }
    const db = createAdminClient();
    const { error } = await db.rpc("sys_record_refund", {
      p_order_id: order.id,
      p_provider: "manual",
      p_provider_ref: `reembolso:${order.id}`,
      p_amount_cents: order.price_cents,
      p_raw: { manual: true },
      p_actor_id: userId,
      p_actor_role: actor,
      p_note: note.trim(),
    });
    if (error) throw new OrderError(error.message);
    return;
  }

  // Pagada con saldo: el reembolso vuelve al saldo del comprador.
  if (order.payment_provider === "saldo") {
    const db = createAdminClient();
    const { error } = await db.rpc("sys_refund_to_wallet", {
      p_order_id: order.id,
      p_actor_id: userId,
      p_actor_role: actor,
      p_note: note.trim(),
    });
    if (error) throw new OrderError(error.message);
    return;
  }
  const provider = getProviderById(order.payment_provider);
  if (!provider?.refunds) throw new OrderError("El proveedor configurado no admite reembolsos automáticos");

  const db = createAdminClient();
  const { data: charge } = await db
    .from("payment_transactions")
    .select("provider_ref")
    .eq("order_id", order.id)
    .eq("kind", "cobro")
    .eq("provider", provider.id)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!charge) throw new OrderError("No se encontró el cobro de la orden");

  const result = await provider.refunds.refund({
    orderId: order.id,
    chargeRef: charge.provider_ref,
    amountCents: order.price_cents,
    idempotencyKey: `reembolso:${order.id}`,
  });
  if (result.state !== "aprobado") {
    throw new OrderError(
      result.state === "pendiente"
        ? "El reembolso quedó pendiente en el proveedor; se actualizará al confirmarse"
        : "El proveedor rechazó el reembolso (¿saldo insuficiente?)",
    );
  }
  const { error } = await db.rpc("sys_record_refund", {
    p_order_id: order.id,
    p_provider: provider.id,
    p_provider_ref: result.providerRef,
    p_amount_cents: order.price_cents,
    p_raw: result.raw,
    p_actor_id: userId,
    p_actor_role: actor,
    p_note: note.trim(),
  });
  if (error) throw new OrderError(error.message);
}

/** Liquida el neto al vendedor de una orden confirmada. Solo admin (o cron). */
export async function settleOrder(orderId: string, adminUserId: string | null, manualReference?: string): Promise<void> {
  const order = await loadOrder(orderId);
  if (adminUserId) {
    const actor = await actorFor(order, adminUserId);
    if (actor !== "admin") throw new OrderError("Solo un administrador puede liquidar");
  }
  if (!isAllowed(SYSTEM_TRANSITIONS, "liquidar", order.status, adminUserId ? "admin" : "sistema")) {
    throw new OrderError("Solo se liquidan órdenes confirmadas");
  }
  if (!modeMatches(order) || !order.payment_provider) throw new OrderError("La orden no pertenece al modo de pagos activo");

  // Pago manual: el administrador ya transfirió el neto al vendedor por fuera y deja el comprobante.
  if (order.payment_mode === "manual") {
    const reference = manualReference?.trim() ?? "";
    if (!adminUserId || reference.length < 4) {
      throw new OrderError("Indicá el número de comprobante de la transferencia al vendedor (mínimo 4 caracteres)");
    }
    const db = createAdminClient();
    const { error } = await db.rpc("sys_record_payout", {
      p_order_id: order.id,
      p_provider: "manual",
      p_provider_ref: `${order.id.slice(0, 8)}:${reference}`,
      p_amount_cents: order.seller_net_cents,
      p_raw: { manual: true, comprobante: reference },
      p_actor_id: adminUserId,
    });
    if (error) throw new OrderError(error.message);
    return;
  }
  const provider = getProviderById(order.payment_provider);
  if (!provider?.payouts || provider.capabilities.liquidacion === "no_soportada") {
    throw new OrderError("El proveedor configurado no admite liquidaciones automáticas");
  }

  const db = createAdminClient();
  const { data: account } = await db
    .from("seller_payout_accounts")
    .select("holder_name, tax_id, cbu_or_alias")
    .eq("seller_id", order.seller_id)
    .maybeSingle();
  if (!account) throw new OrderError("El vendedor todavía no cargó sus datos de cobro");

  const result = await provider.payouts.payout({
    orderId: order.id,
    sellerId: order.seller_id,
    amountCents: order.seller_net_cents,
    currency: order.currency,
    idempotencyKey: `liquidacion:${order.id}`,
    destination: { holderName: account.holder_name, taxId: account.tax_id, cbuOrAlias: account.cbu_or_alias },
  });
  if (result.state !== "aprobado") throw new OrderError("La liquidación no fue aprobada por el proveedor");

  const { error } = await db.rpc("sys_record_payout", {
    p_order_id: order.id,
    p_provider: provider.id,
    p_provider_ref: result.providerRef,
    p_amount_cents: order.seller_net_cents,
    p_raw: result.raw,
    p_actor_id: adminUserId,
  });
  if (error) throw new OrderError(error.message);
}

/** Tareas periódicas: confirmación automática y vencimiento de órdenes impagas. */
export async function runMaintenance() {
  const db = createAdminClient();
  const [auto, expired] = await Promise.all([db.rpc("sys_auto_confirm"), db.rpc("sys_expire_pending")]);
  if (auto.error) throw auto.error;
  if (expired.error) throw expired.error;
  return { confirmadas: auto.data as number, vencidas: expired.data as number };
}
