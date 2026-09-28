import "server-only";

/**
 * Configuración de pagos. La integración real queda BLOQUEADA salvo que se cumplan
 * todas las condiciones explícitas. Ver docs/decision-pagos.md.
 */
export type PaymentsMode = "simulado" | "real" | "manual" | "bloqueado";

export interface PaymentsConfig {
  mode: PaymentsMode;
  provider: "simulado" | "mercadopago" | "manual";
  /** Motivo por el cual los pagos reales están bloqueados (si aplica). */
  blockedReason: string | null;
  /** Se verificó por escrito con el proveedor que se puede cobrar, esperar y luego liquidar al vendedor. */
  holdAndPayoutVerified: boolean;
}

const flag = (v: string | undefined) => v?.trim().toLowerCase() === "true";

export function getPaymentsConfig(): PaymentsConfig {
  const provider = (process.env.PAYMENTS_PROVIDER ?? "simulado").trim().toLowerCase();

  if (provider === "simulado") {
    return { mode: "simulado", provider: "simulado", blockedReason: null, holdAndPayoutVerified: false };
  }

  // Transferencia manual (CVU/QR, Binance, cripto): un administrador verifica cada pago a mano.
  // Mueve dinero real, así que exige la misma autorización expresa del titular. No usa procesador ni
  // retención automática: no hay checkout, y la plataforma no debe presentarse como "dinero protegido".
  if (provider === "manual") {
    const reasons: string[] = [];
    if (!flag(process.env.PAYMENTS_REAL_CHARGES_AUTHORIZED)) {
      reasons.push("PAYMENTS_REAL_CHARGES_AUTHORIZED no está en true (falta autorización del titular)");
    }
    if (!process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") && process.env.NODE_ENV === "production") {
      reasons.push("NEXT_PUBLIC_SITE_URL debe ser https");
    }
    return {
      mode: reasons.length ? "bloqueado" : "manual",
      provider: "manual",
      blockedReason: reasons.length ? reasons.join("; ") : null,
      holdAndPayoutVerified: false,
    };
  }

  if (provider === "mercadopago") {
    const holdAndPayoutVerified = flag(process.env.PAYMENTS_HOLD_AND_PAYOUT_VERIFIED);
    const reasons: string[] = [];
    if (!flag(process.env.PAYMENTS_REAL_CHARGES_AUTHORIZED)) {
      reasons.push("PAYMENTS_REAL_CHARGES_AUTHORIZED no está en true (falta autorización del titular)");
    }
    if (!holdAndPayoutVerified) {
      reasons.push("PAYMENTS_HOLD_AND_PAYOUT_VERIFIED no está en true (retención y liquidación posterior sin confirmar por el proveedor)");
    }
    if (!process.env.MERCADOPAGO_ACCESS_TOKEN) reasons.push("falta MERCADOPAGO_ACCESS_TOKEN");
    if (!process.env.MERCADOPAGO_WEBHOOK_SECRET) reasons.push("falta MERCADOPAGO_WEBHOOK_SECRET");
    if (!process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://")) reasons.push("NEXT_PUBLIC_SITE_URL debe ser https");
    return {
      mode: reasons.length ? "bloqueado" : "real",
      provider: "mercadopago",
      blockedReason: reasons.length ? reasons.join("; ") : null,
      holdAndPayoutVerified,
    };
  }

  return {
    mode: "bloqueado",
    provider: "simulado",
    blockedReason: `PAYMENTS_PROVIDER desconocido: ${provider}`,
    holdAndPayoutVerified: false,
  };
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}
