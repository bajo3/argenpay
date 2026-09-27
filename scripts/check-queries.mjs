// Valida contra el Supabase configurado en .env.local que las consultas de las páginas
// (embeds, filtros y vistas) sean sintácticamente válidas para PostgREST. Solo lectura, rol anon.
// Uso: node --env-file=.env.local scripts/check-queries.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const LOT_SELECT =
  "id, title, price_cents, stock, min_quantity, delivery_time_hours, created_at, char_race, char_class, char_level, seller_id, " +
  "seller:profiles!listings_seller_id_fkey!inner(id, display_name, last_seen_at), " +
  "category:categories(slug, name, unit_label, unit_label_plural), server:game_servers(id, name)";
const uuid = "00000000-0000-0000-0000-000000000000";

const checks = {
  catalogo_juego: db.from("games").select("id, slug, name").eq("slug", "lineage-2-lu4").single(),
  catalogo_categorias: db.from("categories").select("id, slug, name, description, unit_label, unit_label_plural").order("sort_order"),
  catalogo_servidores: db.from("game_servers").select("id, game_id, name, description").eq("active", true).order("sort_order"),
  lotes_filtros: db
    .from("listings")
    .select(LOT_SELECT, { count: "exact" })
    .eq("status", "activa")
    .gt("stock", 0)
    .gte("seller.last_seen_at", new Date().toISOString())
    .eq("char_race", "orco")
    .gte("char_level", 1)
    .ilike("title", "%a%")
    .order("price_cents")
    .range(0, 29),
  oferta: db
    .from("listings")
    .select(
      "id, seller_id, title, description, conditions, price_cents, stock, min_quantity, delivery_time_hours, status, created_at, char_race, char_class, char_level, " +
        "seller:profiles!listings_seller_id_fkey(id, display_name, created_at, last_seen_at), category:categories(name, slug, unit_label, unit_label_plural), server:game_servers(name)",
    )
    .eq("id", uuid)
    .maybeSingle(),
  resenas: db.from("reviews").select("id, rating, body, created_at, buyer:profiles!reviews_buyer_id_fkey(display_name)").eq("seller_id", uuid).limit(5),
  ratings_vista: db.from("seller_ratings").select("seller_id, reviews_count, rating_avg").in("seller_id", [uuid]),
  otros_lotes: db.from("listings").select("id, title, price_cents, category:categories(unit_label), server:game_servers(name)").eq("seller_id", uuid).limit(4),
  perfil: db.from("profiles").select("id, display_name, created_at, last_seen_at, is_seller").eq("id", uuid).maybeSingle(),
  ordenes_embed: db.from("orders").select("*, buyer:profiles!orders_buyer_id_fkey(display_name), seller:profiles!orders_seller_id_fkey(display_name)").limit(1),
  conversaciones: db.from("conversations").select("id, user_low, user_high, listing_id, last_message_at, last_message_preview, low_last_read_at, high_last_read_at").or(`user_low.eq.${uuid},user_high.eq.${uuid}`).limit(1),
  mensajes: db.from("conversation_messages").select("id, sender_id, kind, body, order_id, listing_id, created_at").eq("conversation_id", uuid).gt("id", 0).order("id"),
  reclamos_admin: db.from("disputes").select("order_id, reason, created_at, order:orders(price_cents, listing_snapshot, buyer:profiles!orders_buyer_id_fkey(display_name), seller:profiles!orders_seller_id_fkey(display_name))").limit(1),
  vendedor_lotes: db.from("listings").select("id, title, price_cents, stock, status, server:game_servers(name), category:categories(name, unit_label_plural)").eq("seller_id", uuid),
  settings: db.from("platform_settings").select("*").single(),
  lotes_con_avatar: db.from("listings").select(LOT_SELECT.replace("last_seen_at)", "last_seen_at, avatar_url)")).limit(1),
  ratings_distribucion: db.from("seller_ratings").select("seller_id, reviews_count, rating_avg, r5, r4, r3, r2, r1").limit(1),
  compras_filtros: db
    .from("orders")
    .select("id, code, status, quantity, price_cents, seller_net_cents, created_at, listing_snapshot, seller:profiles!orders_seller_id_fkey!inner(id, display_name, last_seen_at, avatar_url)")
    .eq("buyer_id", uuid)
    .ilike("code", "AB%")
    .ilike("seller.display_name", "%x%")
    .limit(5),
  saldo_movimientos: db.from("wallet_entries").select("id, amount_cents, kind, order_id, note, created_at").eq("user_id", uuid).limit(5),
  retiros: db.from("withdrawals").select("id, amount_cents, status, destination, admin_note, created_at, processed_at").eq("user_id", uuid),
  retiros_admin: db.from("withdrawals").select("id, amount_cents, destination, created_at, user:profiles!withdrawals_user_id_fkey(display_name)").eq("status", "pendiente"),
  resenas_perfil: db.from("reviews").select("id, rating, body, created_at, seller_reply, seller_reply_at, buyer:profiles!reviews_buyer_id_fkey(display_name, avatar_url), order:orders(listing_snapshot)").eq("seller_id", uuid).limit(5),
  lotes_mecanicas: db
    .from("listings")
    .select("id, char_equipment, auto_delivery, bumped_at, seller:profiles!listings_seller_id_fkey!inner(id, created_at)")
    .eq("auto_delivery", true)
    .eq("char_equipment", "equipado")
    .lte("char_level", 80)
    .order("bumped_at", { ascending: false })
    .limit(1),
  entrega_automatica: db.from("listing_delivery_items").select("id, content, order_id, delivered_at").eq("listing_id", uuid),
  mensajes_adjuntos: db.from("conversation_messages").select("id, attachment_path").eq("conversation_id", uuid),
  perfil_avatar: db.from("profiles").select("id, display_name, is_seller, is_admin, avatar_url, created_at").eq("id", uuid).maybeSingle(),
};

let failed = 0;
for (const [name, p] of Object.entries(checks)) {
  const { error, data } = await p;
  if (error) {
    failed++;
    console.log(`✗ ${name}: ${error.message}`);
  } else {
    console.log(`✓ ${name}${Array.isArray(data) ? ` (${data.length} filas)` : ""}`);
  }
}
const walletAnon = await db.rpc("my_wallet");
console.log(walletAnon.error ? `✓ anon no puede ver saldos (${walletAnon.error.message.slice(0, 50)})` : "✗ anon ve saldo");
if (!walletAnon.error) failed++;
const rpcAnon = await db.rpc("create_order", { p_listing_id: uuid, p_quantity: 1, p_payment_mode: "simulado" });
console.log(rpcAnon.error ? `✓ anon no puede crear órdenes (${rpcAnon.error.message.slice(0, 60)})` : "✗ anon creó una orden");
if (!rpcAnon.error) failed++;
process.exit(failed ? 1 : 0);
