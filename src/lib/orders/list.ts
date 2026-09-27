import "server-only";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/state-machine";
import { createClient } from "@/lib/supabase/server";

export type OrdersRole = "comprador" | "vendedor";

export interface OrderFilters {
  code?: string;
  user?: string;
  status?: string;
}

export interface OrderListItem {
  id: string;
  code: string;
  status: OrderStatus;
  quantity: number;
  price_cents: number;
  seller_net_cents: number;
  created_at: string;
  listing_snapshot: { title?: string; server?: string | null; category?: string; unit_plural?: string };
  counterpart: { id: string; display_name: string; last_seen_at: string | null; avatar_url: string | null } | null;
}

/** Órdenes del usuario como comprador o vendedor, con filtros (RLS garantiza que solo vea las suyas). */
export async function listMyOrders(userId: string, role: OrdersRole, f: OrderFilters, limit = 200): Promise<OrderListItem[]> {
  const supabase = await createClient();
  const other = role === "comprador" ? "seller" : "buyer";
  const fk = role === "comprador" ? "orders_seller_id_fkey" : "orders_buyer_id_fkey";
  const userFilter = f.user?.trim().slice(0, 40);
  let q = supabase
    .from("orders")
    .select(
      `id, code, status, quantity, price_cents, seller_net_cents, created_at, listing_snapshot, ` +
        `${other}:profiles!${fk}${userFilter ? "!inner" : ""}(id, display_name, last_seen_at, avatar_url)`,
    )
    .eq(role === "comprador" ? "buyer_id" : "seller_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const code = f.code?.replace(/[^0-9a-z]/gi, "").toUpperCase().slice(0, 8);
  if (code) q = q.ilike("code", `${code}%`);
  if (f.status && (ORDER_STATUSES as readonly string[]).includes(f.status)) q = q.eq("status", f.status);
  if (userFilter) q = q.ilike(`${other}.display_name`, `%${userFilter.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { data } = await q;
  return (data ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown>;
    return { ...(r as unknown as OrderListItem), counterpart: (r[other] as OrderListItem["counterpart"]) ?? null };
  });
}

const rtf = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}
