/**
 * Interfaz de proveedores de pago. Cobro, reembolso y liquidación son capacidades separadas:
 * un proveedor puede implementar solo algunas (el valor null significa "no soportada").
 * Las órdenes no dependen de ningún proveedor concreto.
 */

export type CapabilityStatus =
  /** Confirmada en documentación oficial y habilitada para esta cuenta. */
  | "verificada"
  /** Implementada pero sin confirmación del proveedor para el caso de Argenpay. */
  | "no_verificada"
  | "no_soportada";

export interface ProviderCapabilities {
  cobro: CapabilityStatus;
  reembolso: CapabilityStatus;
  liquidacion: CapabilityStatus;
  /** Cobrar el total, esperar la resolución de la orden y recién entonces pagar al vendedor. */
  retencionHastaConfirmacion: CapabilityStatus;
}

export type ChargeState = "pendiente" | "aprobado" | "rechazado" | "reembolsado" | "otro";

export interface CreateChargeInput {
  orderId: string;
  amountCents: number;
  currency: string;
  description: string;
  idempotencyKey: string;
  returnUrl: string;
  notificationUrl: string;
}

export interface CreateChargeResult {
  providerRef: string;
  redirectUrl: string;
}

export interface ChargeInfo {
  providerRef: string;
  orderId: string | null;
  state: ChargeState;
  amountCents: number;
  currency: string;
  /** Cargo del procesador informado por el proveedor (si lo informa). */
  feeCents: number | null;
  raw: Record<string, unknown>;
}

export interface ChargeGateway {
  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>;
  /** Consulta el estado OFICIAL del cobro en el proveedor. Nunca confiar en datos del navegador. */
  getCharge(providerRef: string): Promise<ChargeInfo>;
}

export interface RefundInput {
  orderId: string;
  chargeRef: string;
  amountCents: number;
  idempotencyKey: string;
}

export interface OperationResult {
  providerRef: string;
  state: "aprobado" | "pendiente" | "rechazado";
  raw: Record<string, unknown>;
}

export interface RefundGateway {
  refund(input: RefundInput): Promise<OperationResult>;
}

export interface PayoutInput {
  orderId: string;
  sellerId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  destination: { holderName: string; taxId: string; cbuOrAlias: string };
}

export interface PayoutGateway {
  payout(input: PayoutInput): Promise<OperationResult>;
}

export interface PaymentProvider {
  id: string;
  label: string;
  simulated: boolean;
  capabilities: ProviderCapabilities;
  charges: ChargeGateway | null;
  refunds: RefundGateway | null;
  payouts: PayoutGateway | null;
}
