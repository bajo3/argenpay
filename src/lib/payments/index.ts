import "server-only";
import { getPaymentsConfig } from "@/lib/config";
import { createMercadoPagoProvider } from "./mercadopago";
import { createSimulatedProvider } from "./simulated";
import type { PaymentProvider } from "./types";

/** Devuelve el proveedor activo, o null si los pagos están bloqueados por configuración. */
export function getPaymentProvider(): PaymentProvider | null {
  const cfg = getPaymentsConfig();
  if (cfg.mode === "simulado") return createSimulatedProvider();
  if (cfg.mode === "real" && cfg.provider === "mercadopago") {
    return createMercadoPagoProvider({ holdAndPayoutVerified: cfg.holdAndPayoutVerified });
  }
  return null;
}

/** Proveedor por id, para procesar notificaciones o reembolsos de órdenes creadas con él. */
export function getProviderById(id: string): PaymentProvider | null {
  const active = getPaymentProvider();
  return active && active.id === id ? active : null;
}

export type { PaymentProvider } from "./types";
