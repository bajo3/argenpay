/**
 * Máquina de estados de una orden. Espejo de public.order_action y de las funciones sys_* en SQL.
 * La base de datos vuelve a validar todo; este módulo sirve para la interfaz, el servidor y los tests.
 */

export const ORDER_STATUSES = [
  "pendiente_pago",
  "pago_confirmado",
  "entrega_en_curso",
  "entregado",
  "confirmado",
  "en_reclamo",
  "reembolsado",
  "cancelado",
  "liquidado",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type Actor = "comprador" | "vendedor" | "admin" | "sistema";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pendiente_pago: "Pendiente de pago",
  pago_confirmado: "Pago confirmado",
  entrega_en_curso: "Entrega en curso",
  entregado: "Entregado",
  confirmado: "Confirmado",
  en_reclamo: "En reclamo",
  reembolsado: "Reembolsado",
  cancelado: "Cancelado",
  liquidado: "Liquidado",
};

export const STATUS_TONE: Record<OrderStatus, "neutral" | "info" | "warn" | "ok" | "bad"> = {
  pendiente_pago: "neutral",
  pago_confirmado: "info",
  entrega_en_curso: "info",
  entregado: "info",
  confirmado: "ok",
  en_reclamo: "warn",
  reembolsado: "bad",
  cancelado: "bad",
  liquidado: "ok",
};

export const FINAL_STATUSES: readonly OrderStatus[] = ["reembolsado", "cancelado", "liquidado"];

/** Acciones que un usuario ejecuta vía public.order_action. */
export type UserAction =
  | "cancelar"
  | "iniciar_entrega"
  | "marcar_entregado"
  | "confirmar_recepcion"
  | "abrir_reclamo"
  | "resolver_vendedor";

/** Acciones que requieren al procesador de pagos y solo ejecuta el servidor. */
export type SystemAction =
  | "confirmar_pago"
  | "reembolsar"
  | "liquidar"
  | "confirmacion_automatica"
  | "vencer_pago";

export interface Transition<A extends string> {
  action: A;
  from: readonly OrderStatus[];
  to: OrderStatus;
  actors: readonly Actor[];
  label: string;
  /** Requiere texto (evidencia, motivo, nota). */
  requiresNote?: boolean;
}

export const USER_TRANSITIONS: readonly Transition<UserAction>[] = [
  { action: "cancelar", from: ["pendiente_pago"], to: "cancelado", actors: ["comprador", "admin"], label: "Cancelar orden" },
  { action: "iniciar_entrega", from: ["pago_confirmado"], to: "entrega_en_curso", actors: ["vendedor"], label: "Iniciar entrega" },
  {
    action: "marcar_entregado",
    from: ["pago_confirmado", "entrega_en_curso"],
    to: "entregado",
    actors: ["vendedor"],
    label: "Marcar como entregado",
    requiresNote: true,
  },
  { action: "confirmar_recepcion", from: ["entregado"], to: "confirmado", actors: ["comprador"], label: "Confirmar recepción" },
  {
    action: "abrir_reclamo",
    // Desde pago_confirmado / entrega_en_curso solo si venció el plazo estimado (ver canOpenDispute).
    from: ["entregado", "pago_confirmado", "entrega_en_curso"],
    to: "en_reclamo",
    actors: ["comprador"],
    label: "Abrir reclamo",
    requiresNote: true,
  },
  {
    action: "resolver_vendedor",
    from: ["en_reclamo"],
    to: "confirmado",
    actors: ["admin"],
    label: "Resolver a favor del vendedor",
    requiresNote: true,
  },
];

export const SYSTEM_TRANSITIONS: readonly Transition<SystemAction>[] = [
  { action: "confirmar_pago", from: ["pendiente_pago"], to: "pago_confirmado", actors: ["sistema"], label: "Pago verificado" },
  {
    action: "reembolsar",
    from: ["pago_confirmado", "entrega_en_curso", "en_reclamo"],
    to: "reembolsado",
    // El vendedor puede devolver el dinero si no puede entregar; el admin, al resolver un reclamo.
    actors: ["vendedor", "admin"],
    label: "Reembolsar al comprador",
  },
  { action: "liquidar", from: ["confirmado"], to: "liquidado", actors: ["admin", "sistema"], label: "Liquidar al vendedor" },
  { action: "confirmacion_automatica", from: ["entregado"], to: "confirmado", actors: ["sistema"], label: "Confirmación automática" },
  { action: "vencer_pago", from: ["pendiente_pago"], to: "cancelado", actors: ["sistema"], label: "Vencimiento sin pago" },
];

export interface OrderLike {
  status: OrderStatus;
  delivery_due_at: string | null;
}

export function canOpenDispute(order: OrderLike, now: Date = new Date()): boolean {
  if (order.status === "entregado") return true;
  if (order.status === "pago_confirmado" || order.status === "entrega_en_curso") {
    return order.delivery_due_at !== null && now >= new Date(order.delivery_due_at);
  }
  return false;
}

export function findTransition<A extends string>(
  table: readonly Transition<A>[],
  action: A,
): Transition<A> | undefined {
  return table.find((t) => t.action === action);
}

export function isAllowed<A extends string>(
  table: readonly Transition<A>[],
  action: A,
  status: OrderStatus,
  actor: Actor,
): boolean {
  const t = findTransition(table, action);
  return !!t && t.from.includes(status) && t.actors.includes(actor);
}

/** Acciones de usuario disponibles para mostrar en la interfaz. */
export function availableUserActions(order: OrderLike, actor: Actor, now: Date = new Date()): Transition<UserAction>[] {
  return USER_TRANSITIONS.filter((t) => {
    if (!t.from.includes(order.status) || !t.actors.includes(actor)) return false;
    if (t.action === "abrir_reclamo") return canOpenDispute(order, now);
    return true;
  });
}
