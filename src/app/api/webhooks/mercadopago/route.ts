import { NextResponse, type NextRequest } from "next/server";
import { getPaymentsConfig } from "@/lib/config";
import { reconcileCharge } from "@/lib/orders/service";
import { verifyMercadoPagoSignature } from "@/lib/payments/mercadopago-signature";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Webhook de Mercado Pago. Flujo:
 * 1) verificar firma x-signature; 2) deduplicar por x-request-id;
 * 3) consultar el pago en la API oficial; 4) conciliar con la orden (importe, moneda, estado).
 * Nunca se usa el contenido del body como prueba de pago.
 */
export async function POST(req: NextRequest) {
  const cfg = getPaymentsConfig();
  if (cfg.provider !== "mercadopago" || cfg.mode !== "real") {
    return NextResponse.json({ error: "Integración con Mercado Pago bloqueada por configuración" }, { status: 503 });
  }

  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as { type?: string; data?: { id?: string | number } };
  const dataId = url.searchParams.get("data.id") ?? (body.data?.id != null ? String(body.data.id) : null);
  const type = url.searchParams.get("type") ?? body.type;
  const requestId = req.headers.get("x-request-id");

  const valid = verifyMercadoPagoSignature({
    xSignature: req.headers.get("x-signature"),
    xRequestId: requestId,
    dataId,
    secret: process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "",
    toleranceSeconds: 600,
  });
  if (!valid) return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  if (type !== "payment" || !dataId) return NextResponse.json({ ignorado: true });

  const db = createAdminClient();
  const eventKey = `${type}:${dataId}:${requestId ?? "sin-request-id"}`;
  const inserted = await db
    .from("webhook_events")
    .insert({ provider: "mercadopago", event_key: eventKey, payload: body })
    .select("id")
    .maybeSingle();
  if (inserted.error && inserted.error.code === "23505") return NextResponse.json({ duplicado: true });
  if (inserted.error) return NextResponse.json({ error: "No se pudo registrar" }, { status: 500 });

  try {
    const result = await reconcileCharge("mercadopago", dataId);
    await db.from("webhook_events").update({ processed_at: new Date().toISOString(), result }).eq("id", inserted.data!.id);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    await db
      .from("webhook_events")
      .update({ result: `error: ${(e as Error).message}`.slice(0, 500) })
      .eq("id", inserted.data!.id);
    // 500 para que el proveedor reintente
    return NextResponse.json({ error: "Error al conciliar" }, { status: 500 });
  }
}
