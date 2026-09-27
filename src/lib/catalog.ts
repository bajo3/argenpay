import "server-only";
import { createClient } from "@/lib/supabase/server";

export const LU4_SLUG = "lineage-2-lu4";

export interface Game { id: string; slug: string; name: string }
export interface GameServer { id: string; game_id: string; name: string; description: string }
export interface Category {
  id: string; slug: string; name: string; description: string; unit_label: string; unit_label_plural: string;
}

/** Catálogo LU4: juego, servidores y categorías. */
export async function getCatalog() {
  const supabase = await createClient();
  const [game, categories] = await Promise.all([
    supabase.from("games").select("id, slug, name").eq("slug", LU4_SLUG).single(),
    supabase.from("categories").select("id, slug, name, description, unit_label, unit_label_plural").order("sort_order"),
  ]);
  const servers = game.data
    ? await supabase
        .from("game_servers")
        .select("id, game_id, name, description")
        .eq("game_id", game.data.id)
        .eq("active", true)
        .order("sort_order")
    : { data: [] };
  return {
    game: (game.data ?? null) as Game | null,
    servers: (servers.data ?? []) as GameServer[],
    categories: (categories.data ?? []) as Category[],
  };
}

export const LOT_SELECT =
  "id, title, price_cents, stock, min_quantity, delivery_time_hours, created_at, char_race, char_class, char_level, seller_id, " +
  "seller:profiles!listings_seller_id_fkey!inner(id, display_name, last_seen_at, avatar_url), " +
  "category:categories(slug, name, unit_label, unit_label_plural), server:game_servers(id, name)";

export interface LotRow {
  id: string;
  title: string;
  price_cents: number;
  stock: number;
  min_quantity: number;
  delivery_time_hours: number;
  created_at: string;
  char_race: string | null;
  char_class: string | null;
  char_level: number | null;
  seller_id: string;
  seller: { id: string; display_name: string; last_seen_at: string | null; avatar_url: string | null };
  category: { slug: string; name: string; unit_label: string; unit_label_plural: string } | null;
  server: { id: string; name: string } | null;
}

export interface Rating { reviews_count: number; rating_avg: number; r5?: number; r4?: number; r3?: number; r2?: number; r1?: number }

/** Calificaciones públicas por vendedor. */
export async function getRatings(sellerIds: string[]): Promise<Record<string, Rating>> {
  const ids = [...new Set(sellerIds)];
  if (!ids.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.from("seller_ratings").select("seller_id, reviews_count, rating_avg, r5, r4, r3, r2, r1").in("seller_id", ids);
  return Object.fromEntries(
    (data ?? []).map((r) => [r.seller_id, { reviews_count: Number(r.reviews_count), rating_avg: Number(r.rating_avg), r5: r.r5, r4: r.r4, r3: r.r3, r2: r.r2, r1: r.r1 }]),
  );
}
