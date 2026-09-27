/**
 * Cálculo de importes de una orden. Espejo exacto de public.create_order (SQL).
 * La fuente de verdad es la base de datos; esto sirve para mostrar cotizaciones y para tests.
 *
 * Todos los importes son centavos enteros.
 * Regla de redondeo: mitad hacia arriba al centavo → floor((monto * bps + 5000) / 10000).
 */

export type ProcessorFeePolicy = "plataforma_absorbe" | "vendedor_absorbe";

export interface FeeInput {
  unitPriceCents: number;
  quantity: number;
  commissionBps: number;
  processorFeeBps: number;
  processorFeePolicy: ProcessorFeePolicy;
}

export interface OrderAmounts {
  priceCents: number;
  commissionCents: number;
  processorFeeCents: number;
  sellerNetCents: number;
  platformNetCents: number;
}

function assertInt(name: string, value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} inválido: ${value}`);
  }
}

/** Porcentaje en puntos básicos, redondeo mitad hacia arriba. Usa BigInt para no perder precisión. */
export function bpsOf(amountCents: number, bps: number): number {
  assertInt("amountCents", amountCents, 0, Number.MAX_SAFE_INTEGER);
  assertInt("bps", bps, 0, 10_000);
  return Number((BigInt(amountCents) * BigInt(bps) + 5000n) / 10000n);
}

export function computeOrderAmounts(input: FeeInput): OrderAmounts {
  assertInt("unitPriceCents", input.unitPriceCents, 1, 10_000_000_000);
  assertInt("quantity", input.quantity, 1, 1000);
  const priceCents = input.unitPriceCents * input.quantity;
  const commissionCents = bpsOf(priceCents, input.commissionBps);
  const processorFeeCents = bpsOf(priceCents, input.processorFeeBps);
  const sellerBears = input.processorFeePolicy === "vendedor_absorbe";
  return {
    priceCents,
    commissionCents,
    processorFeeCents,
    sellerNetCents: priceCents - commissionCents - (sellerBears ? processorFeeCents : 0),
    platformNetCents: commissionCents - (sellerBears ? 0 : processorFeeCents),
  };
}
