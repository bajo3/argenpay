"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth";
import { getPaymentsConfig } from "@/lib/config";
import { formatARS, parseARSToCents } from "@/lib/money";
import { IS_PLACEHOLDER, METHOD_LABEL, realMethods } from "@/lib/manual-payments";
import { notifyAdmin } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { done, errorMessage, fail, str } from "./helpers";

const METHODS = ["cvu", "binance_pay", "usdt", "usdc", "btc", "otro"];

/** El comprador avisa que transfirió. No confirma nada: un administrador lo verifica a mano. */
export async function reportManualPayment(formData: FormData) {
  const orderId = str(formData, "order_id");
  const back = `/ordenes/${orderId}`;
  const s = await requireUser(back);
  if (getPaymentsConfig().mode !== "manual") fail(back, "Los pagos por transferencia no están habilitados");
  const method = str(formData, "method");
  if (!METHODS.includes(method)) fail(back, "Elegí cómo pagaste");

  const supabase = await createClient();
  const { error } = await supabase.rpc("report_manual_payment", {
    p_order_id: orderId,
    p_method: method,
    p_reference: str(formData, "reference"),
    p_payer_name: str(formData, "payer_name") || undefined,
    p_note: str(formData, "note") || undefined,
    p_proof_path: str(formData, "proof_path") || undefined,
  });
  if (error) fail(back, error.message);

  // Aviso al titular fuera del sitio (Telegram / ntfy, si están configurados). Nunca frena la operación.
  const { data: order } = await supabase.from("orders").select("price_cents").eq("id", orderId).maybeSingle();
  await notifyAdmin({
    title: "💸 Pago para verificar",
    body: `Orden #${orderId.slice(0, 8).toUpperCase()} · ${order ? formatARS(Number(order.price_cents)) : ""} · ${METHOD_LABEL[method] ?? method} · ${s.profile.display_name}`,
    link: "/admin#pagos-manuales",
  }).catch(() => []);

  revalidatePath(back);
  done(back, "Listo, avisamos tu pago. Lo verificamos y te confirmamos por acá.");
}

/** Carga de saldo: el usuario avisa que transfirió pesos o envió USDT/USDC. La acredita un administrador. */
export async function reportTopup(formData: FormData) {
  const back = "/saldo";
  const s = await requireUser(back);
  if (getPaymentsConfig().mode !== "manual") fail(back, "Las cargas por transferencia no están habilitadas");
  const method = str(formData, "method");
  if (!METHODS.includes(method)) fail(back, "Elegí cómo enviaste el dinero");
  const currency = ["cvu"].includes(method) ? "ARS" : method === "btc" ? "BTC" : method === "usdc" ? "USDC" : str(formData, "currency") === "ARS" ? "ARS" : "USDT";
  const raw = str(formData, "amount").replace(/s|$|US/gi, "");
  // Pesos: "15.000,50". Cripto: admite "10.5" o "10,5".
  const amount = currency === "ARS" ? (parseARSToCents(raw) ?? 0) / 100 : Number(raw.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) fail(back, "Ingresá el importe que enviaste");

  const supabase = await createClient();
  const { error } = await supabase.rpc("report_topup", {
    p_method: method,
    p_currency: currency,
    p_amount: amount,
    p_reference: str(formData, "reference"),
    p_payer_name: str(formData, "payer_name") || undefined,
    p_note: str(formData, "note") || undefined,
    p_proof_path: str(formData, "proof_path") || undefined,
  });
  if (error) fail(back, error.message);

  await notifyAdmin({
    title: "💸 Carga de saldo para verificar",
    body: `${currency === "ARS" ? formatARS(Math.round(amount * 100)) : `${amount} ${currency}`} · ${METHOD_LABEL[method] ?? method} · ${s.profile.display_name}`,
    link: "/admin#pagos-manuales",
  }).catch(() => []);
  revalidatePath(back);
  done(back, "Listo, avisamos tu carga. Cuando la verifiquemos se acredita en tu saldo.");
}

/** Administrador: aprueba (confirma la orden o acredita la carga) o rechaza un aviso de pago. */
export async function reviewManualPayment(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(str(formData, "payment_id"));
  const approve = str(formData, "decision") === "aprobar";
  if (!Number.isSafeInteger(id) || id < 1) fail("/admin", "Aviso inválido");
  const creditRaw = str(formData, "credit");
  const credit = creditRaw ? parseARSToCents(creditRaw) : null;
  if (creditRaw && (credit === null || credit < 100)) fail("/admin#pagos-manuales", "Importe a acreditar inválido");
  const db = createAdminClient();
  const { error } = await db.rpc("sys_review_manual_payment", {
    p_payment_id: id,
    p_approve: approve,
    p_admin_id: admin.userId,
    p_note: str(formData, "note") || undefined,
    p_credit_cents: credit ?? undefined,
  });
  if (error) fail("/admin#pagos-manuales", error.message);
  revalidatePath("/admin");
  done("/admin#pagos-manuales", approve ? (credit !== null || str(formData, "purpose") === "carga" ? "Carga acreditada en el saldo del usuario" : "Pago confirmado: el vendedor ya puede entregar") : "Aviso rechazado");
}

/** Administrador: guarda los datos de cobro que ven los compradores. */
export async function saveManualPaymentSettings(formData: FormData) {
  await requireAdmin();
  const back = "/admin#datos-de-cobro";
  const clean = (k: string, max: number) => str(formData, k).slice(0, max);

  const cvu = clean("cvu", 40).replace(/\s/g, "");
  const alias = clean("alias", 40);
  const binancePayId = clean("binance_pay_id", 40);
  const wallets = ["USDT", "USDC", "BTC"].map((asset) => ({
    asset,
    network: clean(`network_${asset}`, 30),
    address: clean(`address_${asset}`, 120).replace(/\s/g, ""),
  }));
  const configured = formData.get("configured") === "on";
  const rate = str(formData, "usd_rate");
  const usdRateCents = rate ? parseARSToCents(rate) : null;
  if (rate && (usdRateCents === null || usdRateCents < 1)) fail(back, "La cotización del dólar no es válida");
  const qrPath = str(formData, "qr_path");
  if (qrPath && !/^qr-\d+\.(png|jpe?g|webp)$/.test(qrPath)) fail(back, "Archivo del QR inválido");

  if (cvu && !/^\d{22}$/.test(cvu)) fail(back, "El CVU/CBU tiene 22 dígitos, sin espacios ni guiones");
  const real = realMethods({ cvu, alias, binancePayId, wallets });
  if (configured) {
    if (!(real.cvu || real.alias || real.binance || real.crypto)) {
      fail(back, "Para marcar los datos como definitivos cargá al menos un medio real (CVU/alias, Binance o una dirección cripto)");
    }
    if (IS_PLACEHOLDER.test(clean("holder_name", 120))) fail(back, "Cargá el titular real de la cuenta");
  }

  const db = createAdminClient();
  const { error } = await db
    .from("manual_payment_settings")
    .update({
      configured,
      holder_name: clean("holder_name", 120),
      bank_name: clean("bank_name", 80),
      cvu: cvu || "0000000000000000000000",
      alias,
      cuit: clean("cuit", 20),
      binance_pay_id: binancePayId,
      binance_email: clean("binance_email", 120),
      crypto_wallets: wallets.filter((w) => w.address),
      usd_rate_auto: formData.get("usd_rate_auto") === "on",
      ...(formData.get("usd_rate_auto") === "on" ? {} : { usd_rate_cents: usdRateCents, usd_rate_updated_at: new Date().toISOString() }),
      instructions: clean("instructions", 1500),
      ...(qrPath ? { qr_path: qrPath } : {}),
      ...(formData.get("remove_qr") === "on" ? { qr_path: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) fail(back, errorMessage(error));
  revalidatePath("/admin");
  revalidatePath("/ordenes", "layout");
  revalidateTag("usd-rate", { expire: 0 });
  done(back, configured ? "Datos de cobro guardados y marcados como definitivos" : "Datos guardados (siguen en modo ejemplo)");
}
