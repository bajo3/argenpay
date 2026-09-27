import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  SYSTEM_TRANSITIONS,
  USER_TRANSITIONS,
  availableUserActions,
  canOpenDispute,
  isAllowed,
} from "../orders/state-machine";

describe("máquina de estados", () => {
  it("el frontend nunca puede confirmar un pago", () => {
    for (const actor of ["comprador", "vendedor", "admin"] as const) {
      expect(isAllowed(SYSTEM_TRANSITIONS, "confirmar_pago", "pendiente_pago", actor)).toBe(false);
    }
    expect(USER_TRANSITIONS.some((t) => t.to === "pago_confirmado")).toBe(false);
  });

  it("ningún usuario puede pasar a liquidado ni a reembolsado por order_action", () => {
    expect(USER_TRANSITIONS.some((t) => t.to === "liquidado" || t.to === "reembolsado")).toBe(false);
  });

  it("solo se liquida lo confirmado", () => {
    for (const s of ORDER_STATUSES) {
      expect(isAllowed(SYSTEM_TRANSITIONS, "liquidar", s, "admin")).toBe(s === "confirmado");
    }
  });

  it("no se reembolsa una orden entregada sin reclamo, ni una ya liquidada", () => {
    expect(isAllowed(SYSTEM_TRANSITIONS, "reembolsar", "entregado", "admin")).toBe(false);
    expect(isAllowed(SYSTEM_TRANSITIONS, "reembolsar", "liquidado", "admin")).toBe(false);
    expect(isAllowed(SYSTEM_TRANSITIONS, "reembolsar", "en_reclamo", "admin")).toBe(true);
    expect(isAllowed(SYSTEM_TRANSITIONS, "reembolsar", "en_reclamo", "vendedor")).toBe(true);
    expect(isAllowed(SYSTEM_TRANSITIONS, "reembolsar", "en_reclamo", "comprador")).toBe(false);
  });

  it("los estados finales no tienen salida", () => {
    for (const s of ["reembolsado", "cancelado", "liquidado"] as const) {
      expect([...USER_TRANSITIONS, ...SYSTEM_TRANSITIONS].some((t) => t.from.includes(s))).toBe(false);
    }
  });

  it("reclamo por falta de entrega solo después del plazo", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    expect(canOpenDispute({ status: "pago_confirmado", delivery_due_at: "2026-01-03T00:00:00Z" }, now)).toBe(false);
    expect(canOpenDispute({ status: "pago_confirmado", delivery_due_at: "2026-01-01T00:00:00Z" }, now)).toBe(true);
    expect(canOpenDispute({ status: "entregado", delivery_due_at: null }, now)).toBe(true);
    expect(canOpenDispute({ status: "confirmado", delivery_due_at: null }, now)).toBe(false);
  });

  it("acciones disponibles por rol", () => {
    const o = { status: "entregado" as const, delivery_due_at: null };
    expect(availableUserActions(o, "comprador").map((t) => t.action).sort()).toEqual(
      ["abrir_reclamo", "confirmar_recepcion"].sort(),
    );
    expect(availableUserActions(o, "vendedor")).toEqual([]);
  });
});
