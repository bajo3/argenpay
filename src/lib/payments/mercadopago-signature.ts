import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificación del header x-signature de las notificaciones Webhooks de Mercado Pago.
 * Formato: "ts=<timestamp>,v1=<hmac_sha256_hex>"
 * Manifest firmado: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 * (data.id en minúsculas si es alfanumérico; partes ausentes se omiten).
 */
export function verifyMercadoPagoSignature(params: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
  /** Tolerancia de antigüedad en segundos (0 = sin control). */
  toleranceSeconds?: number;
  nowMs?: number;
}): boolean {
  const { xSignature, xRequestId, dataId, secret } = params;
  if (!xSignature || !secret) return false;

  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of xSignature.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "ts") ts = v;
    if (k === "v1") v1 = v;
  }
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;

  const tolerance = params.toleranceSeconds ?? 0;
  if (tolerance > 0) {
    const tsNum = Number(ts);
    const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
    if (!Number.isFinite(tsMs) || Math.abs((params.nowMs ?? Date.now()) - tsMs) > tolerance * 1000) return false;
  }

  let manifest = "";
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac("sha256", secret).update(manifest).digest();
  const received = Buffer.from(v1, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
