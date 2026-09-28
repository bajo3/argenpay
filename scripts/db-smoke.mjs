/* eslint-disable @typescript-eslint/no-unused-expressions -- aserciones con ternarios */
// Prueba de humo de la migración sin Docker: ejecuta el esquema en PGlite (Postgres en WASM)
// con stubs mínimos de los esquemas auth/storage y roles de Supabase, y recorre el flujo
// completo verificando RLS, permisos, importes y transiciones.
// Uso: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

async function as(role, uid, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  if (role) await db.exec(`set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}
async function expectError(label, fn, match) {
  try {
    await fn();
    bad(`${label}: se esperaba error`);
  } catch (e) {
    if (match && !String(e.message).includes(match)) bad(`${label}: error inesperado: ${e.message}`);
    else ok(`${label} → rechazado (${e.message.slice(0, 70)})`);
  }
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

// ── Stubs de Supabase ──
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema extensions;
  grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  -- Privilegios por defecto como en Supabase
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

const migDir = "supabase/migrations";
for (const f of readdirSync(migDir).sort()) await db.exec(readFileSync(join(migDir, f), "utf8"));
await db.exec(readFileSync("supabase/seed.sql", "utf8"));
console.log("Migraciones y seed aplicados");

const BUYER = "00000000-0000-0000-0000-00000000000b";
const SELLER = "00000000-0000-0000-0000-00000000000s".replace("s", "5");
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000c";
for (const [id, name] of [[BUYER, "Comprador"], [SELLER, "Vendedora"], [ADMIN, "Admin"], [OTHER, "Otro"]]) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${name}@test.local`, { display_name: name }]);
}
await db.exec(`update public.profiles set is_admin = true where id = '${ADMIN}'`);
ok("perfiles creados por trigger");

await db.exec(`insert into games (slug, name) values ('otro-juego', 'Otro juego');
  insert into game_servers (game_id, name) select id, 'Servidor ajeno' from games where slug = 'otro-juego';`);
const ref = await one(`select
  (select id from games where slug='lineage-2-lu4') game,
  (select s.id from game_servers s join games g on g.id=s.game_id where g.slug='lineage-2-lu4' and s.name='Carmine') server,
  (select s.id from game_servers s join games g on g.id=s.game_id where g.slug='otro-juego') other_server,
  null::uuid region,
  (select id from categories where slug='adena') category`);
const catalog = await one(`select (select count(*)::int from game_servers s join games g on g.id=s.game_id where g.slug='lineage-2-lu4') servers,
  (select count(*)::int from categories) categories`);
catalog.servers === 4 && catalog.categories === 6
  ? ok("catálogo LU4: 4 servidores, 6 categorías")
  : bad(`catálogo inesperado ${JSON.stringify(catalog)}`);

console.log("\nPerfiles y publicaciones");
await as("authenticated", SELLER, () =>
  expectError("autoasignarse admin", () => db.query(`update profiles set is_admin = true where id = $1`, [SELLER]), "No podés"),
);
const listingSql = `insert into listings (seller_id, game_id, server_id, region_id, category_id, title, description, price_cents, stock, delivery_time_hours)
  values ($1, $2, $3, $4, $5, 'Adena Carmine', 'Entrega por trade en Giran', 1234567, 5, 2) returning id`;
await as("authenticated", SELLER, () =>
  expectError("publicar sin ser vendedor", () => db.query(listingSql, [SELLER, ref.game, ref.server, ref.region, ref.category]), "vendedor"),
);
await as("authenticated", SELLER, () => db.query(`select activate_seller()`));
await as("authenticated", SELLER, () =>
  expectError("servidor de otro juego", () => db.query(listingSql, [SELLER, ref.game, ref.other_server, ref.region, ref.category])),
);
await as("authenticated", SELLER, () =>
  expectError("publicar a nombre de otro", () => db.query(listingSql, [OTHER, ref.game, ref.server, ref.region, ref.category])),
);
const listing = (await as("authenticated", SELLER, () => db.query(listingSql, [SELLER, ref.game, ref.server, ref.region, ref.category]))).rows[0].id;
ok("publicación creada por vendedora activada");
await as("authenticated", OTHER, () =>
  db.query(`update listings set price_cents = 1 where id = $1`, [listing]).then((r) =>
    r.affectedRows === 0 ? ok("otro usuario no puede editar la publicación") : bad("otro usuario editó la publicación"),
  ),
);

console.log("\nÓrdenes e importes");
await as("authenticated", SELLER, () =>
  expectError("comprar la propia publicación", () => db.query(`select create_order($1, 1, 'simulado')`, [listing]), "propia"),
);
await as("authenticated", BUYER, () =>
  expectError("insertar orden directo", () =>
    db.query(`insert into orders (listing_id,buyer_id,seller_id,quantity,unit_price_cents,price_cents,commission_bps,commission_cents,processor_fee_bps,processor_fee_cents,processor_fee_policy,seller_net_cents,platform_net_cents,payment_mode,listing_snapshot,delivery_time_hours)
      values ($1,$2,$3,1,1,1,0,0,0,0,'plataforma_absorbe',1,0,'simulado','{}',1)`, [listing, BUYER, SELLER])),
);
const order1 = (await as("authenticated", BUYER, () => one(`select create_order($1, 1, 'simulado') id`, [listing]))).id;
const o1 = await one(`select * from orders where id = $1`, [order1]);
Number(o1.commission_cents) === 123457 && Number(o1.seller_net_cents) === 1111110 && Number(o1.processor_fee_cents) === 37037 && Number(o1.platform_net_cents) === 86420
  ? ok("importes: 12.345,67 → comisión 1.234,57 · neto vendedor 11.111,10 · cargo 370,37 · neto plataforma 864,20")
  : bad(`importes inesperados ${JSON.stringify(o1)}`);
(await one(`select stock from listings where id=$1`, [listing])).stock === 4 ? ok("stock reservado") : bad("stock no reservado");

await as("authenticated", BUYER, () =>
  db.query(`update orders set status='pago_confirmado' where id=$1`, [order1]).then(
    (r) => (r.affectedRows === 0 ? ok("comprador no puede marcar pagado (RLS)") : bad("comprador cambió estado")),
    (e) => ok(`comprador no puede marcar pagado (${e.message.slice(0, 50)})`),
  ),
);
await as("authenticated", BUYER, () =>
  expectError("comprador llama sys_confirm_payment", () =>
    db.query(`select sys_confirm_payment($1,'simulado','x',1234567,'ARS',null,'{}')`, [order1]), "permission denied"),
);
await as("authenticated", SELLER, () =>
  expectError("vendedor entrega sin pago", () => db.query(`select order_action($1,'marcar_entregado','ya está',null)`, [order1]), "lista"),
);
await as("authenticated", OTHER, () =>
  db.query(`select * from orders`).then((r) => (r.rows.length === 0 ? ok("terceros no ven órdenes ajenas") : bad("tercero ve órdenes"))),
);
await as("authenticated", OTHER, () =>
  db.query(`select * from payment_transactions`).then((r) => (r.rows.length === 0 ? ok("terceros no ven transacciones") : bad("tercero ve transacciones"))),
);
await as("anon", null, () =>
  db.query(`select * from seller_payout_accounts`).then((r) => (r.rows.length === 0 ? ok("anon no ve datos de cobro") : bad("anon ve datos de cobro"))),
);

console.log("\nConfirmación de pago (servidor)");
const cp = (amount, r) => as("service_role", null, () => one(`select sys_confirm_payment($1,'simulado',$2,$3,'ARS',null,'{}') r`, [order1, r, amount]));
(await cp(1000, "pago-malo")).r === "monto_invalido" ? ok("importe distinto → monto_invalido, sin cambio de estado") : bad("monto inválido aceptado");
(await cp(1234567, "pago-1")).r === "confirmado" ? ok("pago correcto → confirmado") : bad("no confirmó");
(await cp(1234567, "pago-1")).r === "duplicado" ? ok("notificación repetida → idempotente") : bad("no idempotente");
await as("service_role", null, () =>
  expectError("importes inmutables incluso para service_role", () => db.query(`update orders set price_cents = 1 where id=$1`, [order1]), "inmutables"),
);

console.log("\nEntrega, reclamo y reembolso");
await as("authenticated", BUYER, () =>
  expectError("reclamo antes de vencer el plazo", () => db.query(`select order_action($1,'abrir_reclamo','No me llegó nada todavía',null)`, [order1]), "plazo"),
);
await as("authenticated", SELLER, () => db.query(`select order_action($1,'iniciar_entrega',null,null)`, [order1]));
await as("authenticated", SELLER, () => expectError("entrega sin evidencia", () => db.query(`select order_action($1,'marcar_entregado','',null)`, [order1]), "evidencia"));
await as("authenticated", SELLER, () => db.query(`select order_action($1,'marcar_entregado','Oro enviado por correo al personaje Thrall',null)`, [order1]));
await as("authenticated", SELLER, () => expectError("vendedor confirma recepción", () => db.query(`select order_action($1,'confirmar_recepcion',null,null)`, [order1])));
await as("authenticated", BUYER, () => db.query(`select order_action($1,'abrir_reclamo','Llegó la mitad del oro prometido',null)`, [order1]));
(await one(`select status from orders where id=$1`, [order1])).status === "en_reclamo" ? ok("reclamo abierto") : bad("no pasó a reclamo");
await as("authenticated", BUYER, () => expectError("comprador resuelve su reclamo", () => db.query(`select order_action($1,'resolver_vendedor','ok',null)`, [order1]), "administrador"));
await as("service_role", null, () => db.query(`select sys_record_refund($1,'simulado','ref-1',1234567,'{}',$2,'admin','Evidencia insuficiente')`, [order1, ADMIN]));
const d1 = await one(`select o.status, d.resolution from orders o join disputes d on d.order_id=o.id where o.id=$1`, [order1]);
d1.status === "reembolsado" && d1.resolution === "reembolso_comprador" ? ok("reembolso registrado y reclamo resuelto") : bad(`reembolso: ${JSON.stringify(d1)}`);
await as("service_role", null, () => expectError("liquidar una orden reembolsada", () => db.query(`select sys_record_payout($1,'simulado','p',1111110,'{}',null)`, [order1]), "confirmadas"));

console.log("\nConfirmación y liquidación");
const order2 = (await as("authenticated", BUYER, () => one(`select create_order($1, 2, 'simulado') id`, [listing]))).id;
await as("service_role", null, () => db.query(`select sys_confirm_payment($1,'simulado','pago-2',2469134,'ARS',null,'{}')`, [order2]));
await as("authenticated", SELLER, () => db.query(`select order_action($1,'marcar_entregado','Entregado en el juego',null)`, [order2]));
await as("authenticated", BUYER, () => db.query(`select order_action($1,'confirmar_recepcion',null,null)`, [order2]));
const o2 = await one(`select status, seller_net_cents from orders where id=$1`, [order2]);
o2.status === "liquidado" ? ok("al confirmar, la orden simulada se liquida sola") : bad(`estado tras confirmar: ${o2.status}`);
const credit = await as("authenticated", SELLER, () => one(`select amount_cents from wallet_entries where order_id=$1 and kind='venta'`, [order2]));
Number(credit?.amount_cents) === Number(o2.seller_net_cents) ? ok("el neto (90%) se acreditó en el saldo del vendedor") : bad("no se acreditó la venta");
await as("service_role", null, () => expectError("liquidar dos veces", () => db.query(`select sys_record_payout($1,'simulado','p2',$2,'{}',$3)`, [order2, o2.seller_net_cents, ADMIN]), "confirmadas"));

console.log("\nCancelación, vencimiento y confirmación automática");
const order3 = (await as("authenticated", BUYER, () => one(`select create_order($1, 1, 'simulado') id`, [listing]))).id;
await as("authenticated", SELLER, () => expectError("vendedor cancela", () => db.query(`select order_action($1,'cancelar',null,null)`, [order3]), "comprador"));
await as("authenticated", BUYER, () => db.query(`select order_action($1,'cancelar',null,null)`, [order3]));
(await one(`select stock from listings where id=$1`, [listing])).stock === 2 ? ok("cancelación devuelve stock") : bad("stock no devuelto");
(await as("service_role", null, () => one(`select sys_confirm_payment($1,'simulado','tarde',1234567,'ARS',null,'{}') r`, [order3]))).r === "fuera_de_estado"
  ? ok("pago tardío sobre orden cancelada → queda registrado para revisión")
  : bad("pago tardío mal manejado");

const order4 = (await as("authenticated", BUYER, () => one(`select create_order($1, 1, 'simulado') id`, [listing]))).id;
await as("service_role", null, () => db.query(`select sys_confirm_payment($1,'simulado','pago-4',1234567,'ARS',null,'{}')`, [order4]));
await as("authenticated", SELLER, () => db.query(`select order_action($1,'marcar_entregado','Entregado',null)`, [order4]));
await db.exec(`select set_config('session_replication_role','replica',false); update orders set auto_confirm_at = now() - interval '1 minute' where id='${order4}'; select set_config('session_replication_role','origin',false);`);
(await as("service_role", null, () => one(`select sys_auto_confirm() n`))).n === 1 ? ok("confirmación automática al vencer la ventana") : bad("no autoconfirmó");

const order5 = (await as("authenticated", BUYER, () => one(`select create_order($1, 1, 'simulado') id`, [listing]))).id;
await db.exec(`select set_config('session_replication_role','replica',false); update orders set created_at = now() - interval '2 hours' where id='${order5}'; select set_config('session_replication_role','origin',false);`);
(await as("service_role", null, () => one(`select sys_expire_pending() n`))).n === 1 ? ok("órdenes impagas vencen") : bad("no venció");

console.log("\nRegistro de eventos");
await as("authenticated", BUYER, () =>
  db.query(`select count(*)::int n from order_events where order_id=$1`, [order1]).then((r) => (r.rows[0].n >= 6 ? ok(`comprador ve ${r.rows[0].n} eventos de su orden`) : bad("faltan eventos"))),
);
await as("service_role", null, () => expectError("eventos inmutables", () => db.query(`delete from order_events where order_id=$1`, [order1]), "inmutable"));
await as("authenticated", OTHER, () =>
  expectError("tercero escribe en chat ajeno", () => db.query(`insert into order_messages (order_id, sender_id, body) values ($1,$2,'hola')`, [order2, OTHER])),
);
await as("authenticated", BUYER, () => db.query(`insert into order_messages (order_id, sender_id, body) values ($1,$2,'¡Gracias!')`, [order2, BUYER]).then(() => ok("comprador escribe en su chat")));

console.log("\nLU4: cantidad mínima, chat, reseñas y presencia");
const adena = (await as("authenticated", SELLER, () =>
  one(`insert into listings (seller_id, game_id, server_id, category_id, title, description, price_cents, stock, min_quantity, delivery_time_hours)
       values ($1, $2, $3, $4, 'Adena Carmine x kk', 'Trade en Giran, horario 18 a 24', 4500, 5000, 50, 1) returning id`,
      [SELLER, ref.game, ref.server, ref.category]))).id;
await as("authenticated", BUYER, () => expectError("compra debajo del mínimo", () => db.query(`select create_order($1, 10, 'simulado')`, [adena]), "mínima"));
const order6 = (await as("authenticated", BUYER, () => one(`select create_order($1, 1000, 'simulado') id`, [adena]))).id;
const o6 = await one(`select price_cents, commission_cents, listing_snapshot from orders where id=$1`, [order6]);
Number(o6.price_cents) === 4_500_000 && Number(o6.commission_cents) === 450_000 && o6.listing_snapshot.unit === "kk" && o6.listing_snapshot.server === "Carmine"
  ? ok("1000 kk × $45 = $45.000; comisión $4.500; snapshot con servidor y unidad")
  : bad(`orden adena inesperada ${JSON.stringify(o6)}`);

const conv = await as("authenticated", BUYER, () =>
  one(`select id, last_message_preview from conversations where user_low = least($1::uuid,$2::uuid) and user_high = greatest($1::uuid,$2::uuid)`, [BUYER, SELLER]));
conv?.id ? ok("la orden abrió el chat comprador–vendedor") : bad("no se creó la conversación");
const sys = await as("authenticated", SELLER, () =>
  db.query(`select body from conversation_messages where conversation_id=$1 and kind='sistema' order by id`, [conv.id]));
sys.rows.some((r) => r.body.includes("Pendiente de pago")) && sys.rows.some((r) => r.body.includes("liquidada"))
  ? ok(`vendedor ve ${sys.rows.length} mensajes de sistema de las órdenes`)
  : bad("faltan mensajes de sistema");
(await as("authenticated", SELLER, () => one(`select unread_conversations() n`))).n === 1 ? ok("vendedor tiene 1 chat sin leer") : bad("conteo no leído");
await as("authenticated", SELLER, () => db.query(`select mark_conversation_read($1)`, [conv.id]));
(await as("authenticated", SELLER, () => one(`select unread_conversations() n`))).n === 0 ? ok("marcar como leído") : bad("no marcó leído");
await as("authenticated", SELLER, () => db.query(`insert into conversation_messages (conversation_id, sender_id, body) values ($1,$2,'Te paso la adena a las 20 en Giran')`, [conv.id, SELLER]));
(await as("authenticated", BUYER, () => one(`select unread_conversations() n`))).n === 1 ? ok("comprador recibe el mensaje como no leído") : bad("comprador sin no leídos");
(await as("authenticated", SELLER, () => one(`select unread_conversations() n`))).n === 0 ? ok("el propio mensaje no cuenta como no leído") : bad("propio mensaje contado");
await as("authenticated", OTHER, () =>
  db.query(`select * from conversation_messages where conversation_id=$1`, [conv.id]).then((r) => (r.rows.length === 0 ? ok("terceros no leen el chat") : bad("tercero lee chat"))));
await as("authenticated", OTHER, () => expectError("tercero escribe en el chat", () => db.query(`insert into conversation_messages (conversation_id, sender_id, body) values ($1,$2,'spam')`, [conv.id, OTHER])));
await as("authenticated", BUYER, () => expectError("falsificar mensaje de sistema", () => db.query(`insert into conversation_messages (conversation_id, sender_id, kind, body) values ($1,null,'sistema','Pago confirmado')`, [conv.id])));
await as("authenticated", BUYER, () => expectError("hacerse pasar por otro", () => db.query(`insert into conversation_messages (conversation_id, sender_id, body) values ($1,$2,'hola')`, [conv.id, SELLER])));
await as("authenticated", ADMIN, () => db.query(`insert into conversation_messages (conversation_id, sender_id, body) values ($1,$2,'Admin revisando el caso')`, [conv.id, ADMIN]).then(() => ok("admin puede intervenir en el chat")));
const conv2 = (await as("authenticated", OTHER, () => one(`select start_conversation($1, $2) id`, [SELLER, adena]))).id;
conv2 && conv2 !== conv.id ? ok("otro usuario abre chat pre-venta con la vendedora") : bad("start_conversation");
(await as("authenticated", OTHER, () => one(`select start_conversation($1) id`, [SELLER]))).id === conv2 ? ok("start_conversation es idempotente") : bad("duplicó conversación");
await as("authenticated", OTHER, () => expectError("chat con uno mismo", () => db.query(`select start_conversation($1)`, [OTHER]), "mismo"));

await as("authenticated", BUYER, () => expectError("reseñar orden no confirmada", () => db.query(`select leave_review($1, 5, 'x')`, [order6]), "confirmada"));
await as("authenticated", SELLER, () => expectError("vendedor se autoreseña", () => db.query(`select leave_review($1, 5, 'x')`, [order2]), "comprador"));
await as("authenticated", BUYER, () => db.query(`select leave_review($1, 5, 'Rápido y confiable')`, [order2]));
await as("authenticated", BUYER, () => expectError("reseñar dos veces", () => db.query(`select leave_review($1, 1, 'x')`, [order2]), "Ya calificaste"));
const reviewMsg = await as("authenticated", SELLER, () => one(`select body from conversation_messages where kind='sistema' and order_id=$1 and body like '%reseña%' order by id desc limit 1`, [order2]));
reviewMsg?.body.includes("★★★★★ (5/5)") ? ok("el vendedor recibe aviso de la reseña en el chat") : bad(`sin aviso de reseña: ${reviewMsg?.body}`);
const rating = await as("anon", null, () => one(`select reviews_count, rating_avg from seller_ratings where seller_id=$1`, [SELLER]));
rating?.reviews_count === 1 && Number(rating.rating_avg) === 5 ? ok("calificación pública del vendedor: 5,0 (1)") : bad(`rating ${JSON.stringify(rating)}`);

await as("authenticated", SELLER, () => db.query(`select touch_presence()`));
(await one(`select last_seen_at from profiles where id=$1`, [SELLER])).last_seen_at ? ok("presencia en línea registrada") : bad("sin presencia");
await as("anon", null, () => expectError("anon no puede marcar presencia", () => db.query(`select touch_presence()`), "permission"));

console.log("\nSaldo, retiros, respuestas a reseñas y avatares");
const wallet = async (uid) => (await as("authenticated", uid, () => one(`select * from my_wallet()`)));
const sellerBefore = Number((await wallet(SELLER)).available_cents);
sellerBefore > 0 ? ok(`saldo de la vendedora: $${(sellerBefore / 100).toFixed(2)}`) : bad("vendedora sin saldo");
await as("authenticated", BUYER, () => expectError("acreditarse saldo a mano", () => db.query(`insert into wallet_entries (user_id, amount_cents, kind) values ($1, 100000, 'carga')`, [BUYER]), "permission"));
await as("authenticated", BUYER, () => expectError("llamar sys_credit_deposit", () => db.query(`select sys_credit_deposit($1, 100000, 'simulado', 'x')`, [BUYER]), "permission"));
(await as("service_role", null, () => one(`select sys_credit_deposit($1, 5000000, 'simulado', 'carga-1') r`, [BUYER]))).r === "acreditado" ? ok("carga de saldo verificada: $50.000") : bad("carga");
(await as("service_role", null, () => one(`select sys_credit_deposit($1, 5000000, 'simulado', 'carga-1') r`, [BUYER]))).r === "duplicado" ? ok("carga repetida → idempotente") : bad("carga duplicada");

await db.exec(`update listings set stock = 100 where id = '${listing}'`);
const order7 = (await as("authenticated", BUYER, () => one(`select create_order($1, 2, 'simulado') id`, [listing]))).id;
await as("authenticated", OTHER, () => expectError("pagar orden ajena con saldo", () => db.query(`select pay_order_with_balance($1)`, [order7]), "comprador"));
await as("authenticated", BUYER, () => db.query(`select pay_order_with_balance($1)`, [order7]));
const o7 = await one(`select status, paid_with, price_cents from orders where id=$1`, [order7]);
o7.status === "pago_confirmado" && o7.paid_with === "saldo" ? ok("orden pagada con saldo") : bad(`pago con saldo: ${JSON.stringify(o7)}`);
Number((await wallet(BUYER)).available_cents) === 5000000 - Number(o7.price_cents) ? ok("se descontó el saldo del comprador") : bad("saldo comprador");
await as("authenticated", BUYER, () => expectError("pagar dos veces", () => db.query(`select pay_order_with_balance($1)`, [order7]), "pendiente"));
Number((await wallet(SELLER)).pending_sales_cents) > 0 ? ok("la venta figura como pendiente en el saldo del vendedor") : bad("pendiente vendedor");
await as("service_role", null, () => db.query(`select sys_refund_to_wallet($1, $2, 'vendedor', 'Sin stock en el juego')`, [order7, SELLER]));
(await one(`select status from orders where id=$1`, [order7])).status === "reembolsado" && Number((await wallet(BUYER)).available_cents) === 5000000
  ? ok("reembolso de orden pagada con saldo → vuelve al saldo")
  : bad("reembolso a saldo");

const big = (await as("authenticated", BUYER, () => one(`select create_order($1, 50, 'simulado') id`, [listing]))).id;
await as("authenticated", BUYER, () => expectError("saldo insuficiente", () => db.query(`select pay_order_with_balance($1)`, [big]), "insuficiente"));

await as("authenticated", SELLER, () => expectError("retiro sin datos de cobro", () => db.query(`select request_withdrawal(1000)`), "datos de cobro"));
await as("authenticated", SELLER, () => db.query(`insert into seller_payout_accounts (seller_id, holder_name, tax_id, cbu_or_alias) values ($1, 'Vendedora Test', '20123456789', 'vendedora.test')`, [SELLER]));
await as("authenticated", SELLER, () => expectError("retirar más que el saldo", () => db.query(`select request_withdrawal($1)`, [sellerBefore + 1]), "insuficiente"));
const w1 = (await as("authenticated", SELLER, () => one(`select request_withdrawal(100000) id`))).id;
const sw = await wallet(SELLER);
Number(sw.available_cents) === sellerBefore - 100000 && Number(sw.pending_withdrawals_cents) === 100000 ? ok("retiro solicitado: se reserva del saldo") : bad(`retiro ${JSON.stringify(sw)}`);
await as("service_role", null, () => db.query(`select sys_process_withdrawal($1, false, null, 'CBU inválido', $2)`, [w1, ADMIN]));
Number((await wallet(SELLER)).available_cents) === sellerBefore ? ok("retiro rechazado → el dinero vuelve al saldo") : bad("rechazo retiro");
const w2 = (await as("authenticated", SELLER, () => one(`select request_withdrawal(50000) id`))).id;
(await as("service_role", null, () => one(`select sys_process_withdrawal($1, true, 'sim-transfer-1', null, $2) r`, [w2, ADMIN]))).r === "pagado" ? ok("retiro aprobado") : bad("aprobar retiro");
(await as("service_role", null, () => one(`select sys_process_withdrawal($1, false, null, 'x', $2) r`, [w2, ADMIN]))).r === "ya_procesado" ? ok("un retiro procesado no se reprocesa") : bad("reproceso retiro");
await as("authenticated", OTHER, () => db.query(`select * from wallet_entries`).then((r) => (r.rows.length === 0 ? ok("terceros no ven movimientos de saldo ajenos") : bad("tercero ve saldo"))));

const orderReal = (await as("authenticated", BUYER, () => one(`select create_order($1, 1, 'real') id`, [listing]))).id;
await as("authenticated", BUYER, () => expectError("pago con saldo en modo real", () => db.query(`select pay_order_with_balance($1)`, [orderReal]), "simulado"));

const review = (await as("anon", null, () => one(`select id from reviews where order_id=$1`, [order2]))).id;
await as("authenticated", BUYER, () => expectError("comprador responde como vendedor", () => db.query(`select reply_review($1, 'hola')`, [review]), "vendedor"));
await as("authenticated", SELLER, () => db.query(`select reply_review($1, '¡Gracias por la compra!')`, [review]));
(await as("authenticated", BUYER, () => one(`select count(*)::int n from conversation_messages where kind='sistema' and order_id=$1 and body like '%respondió tu reseña%'`, [order2]))).n === 1
  ? ok("el comprador recibe aviso de la respuesta a su reseña") : bad("sin aviso de respuesta");
await as("authenticated", SELLER, () => expectError("responder dos veces", () => db.query(`select reply_review($1, 'otra')`, [review]), "Ya respondiste"));
await as("service_role", null, () => expectError("cambiar la calificación", () => db.query(`update reviews set rating = 1 where id = $1`, [review]), "no se puede modificar"));
const breakdown = await as("anon", null, () => one(`select r5, r1 from seller_ratings where seller_id=$1`, [SELLER]));
breakdown.r5 === 1 && breakdown.r1 === 0 ? ok("distribución de estrellas en la calificación pública") : bad("breakdown");

await as("authenticated", SELLER, () => expectError("avatar de otro usuario", () =>
  db.query(`update profiles set avatar_url = $2 where id = $1`, [SELLER, `https://x.supabase.co/storage/v1/object/public/avatares/${BUYER}/a.png`])));
await as("authenticated", SELLER, () => expectError("avatar externo", () => db.query(`update profiles set avatar_url = 'https://evil.example/a.png' where id = $1`, [SELLER])));
await as("authenticated", SELLER, () => db.query(`update profiles set avatar_url = $2 where id = $1`, [SELLER, `https://x.supabase.co/storage/v1/object/public/avatares/${SELLER}/a.png`]).then(() => ok("avatar propio guardado")));
const codeRow = await one(`select code from orders where id=$1`, [order2]);
codeRow.code === order2.slice(0, 8).toUpperCase() ? ok(`código de orden buscable: #${codeRow.code}`) : bad("code");

console.log("\nEntrega automática, subir ofertas y adjuntos");
const cats = await one(`select (select count(*)::int from categories) n, (select id from categories where slug='coins') coins`);
cats.n === 6 && cats.coins ? ok("categorías Coins y Otros agregadas (6 en total)") : bad(`categorías ${JSON.stringify(cats)}`);
const auto = (await as("authenticated", SELLER, () =>
  one(`insert into listings (seller_id, game_id, server_id, category_id, title, description, price_cents, stock, delivery_time_hours)
       values ($1, $2, $3, $4, 'Cuenta auto LU4', 'Se entrega sola al pagar', 250000, 0, 1) returning id`, [SELLER, ref.game, ref.server, ref.category]))).id;
await as("authenticated", BUYER, () => expectError("cargar ítems en oferta ajena", () => db.query(`select add_delivery_items($1, array['x'])`, [auto]), "vendedor"));
(await as("authenticated", SELLER, () => one(`select add_delivery_items($1, array['user: a1 / pass: p1', '  ', 'user: a2 / pass: p2']) n`, [auto]))).n === 2
  ? ok("vendedor carga 2 ítems (ignora líneas vacías)")
  : bad("add_delivery_items");
const autoL = await one(`select stock, auto_delivery from listings where id=$1`, [auto]);
autoL.stock === 2 && autoL.auto_delivery ? ok("stock = ítems cargados y entrega automática activa") : bad(`stock auto ${JSON.stringify(autoL)}`);
await as("authenticated", BUYER, () => db.query(`select * from listing_delivery_items where listing_id=$1`, [auto]).then((r) => (r.rows.length === 0 ? ok("el comprador no ve los ítems antes de comprar") : bad("comprador ve ítems"))));
const order9 = (await as("authenticated", BUYER, () => one(`select create_order($1, 1, 'simulado') id`, [auto]))).id;
await as("authenticated", BUYER, () => db.query(`select pay_order_with_balance($1)`, [order9]));
const o9 = await one(`select status, auto_confirm_at from orders where id=$1`, [order9]);
o9.status === "entregado" && o9.auto_confirm_at ? ok("al pagar, la orden se entregó sola") : bad(`auto entrega: ${JSON.stringify(o9)}`);
const got = await as("authenticated", BUYER, () => db.query(`select content from listing_delivery_items where order_id=$1`, [order9]));
got.rows.length === 1 && got.rows[0].content === "user: a1 / pass: p1" ? ok("el comprador ve solo el ítem que compró") : bad(`ítems comprador ${JSON.stringify(got.rows)}`);
await as("authenticated", OTHER, () => db.query(`select * from listing_delivery_items where order_id=$1`, [order9]).then((r) => (r.rows.length === 0 ? ok("terceros no ven el contenido entregado") : bad("tercero ve ítems"))));
const delivered = (await as("authenticated", SELLER, () => one(`select id from listing_delivery_items where order_id=$1`, [order9]))).id;
await as("authenticated", SELLER, () => expectError("borrar ítem ya entregado", () => db.query(`select remove_delivery_item($1)`, [delivered]), "entregado"));
const spare = (await as("authenticated", SELLER, () => one(`select id from listing_delivery_items where listing_id=$1 and order_id is null`, [auto]))).id;
await as("authenticated", SELLER, () => db.query(`select remove_delivery_item($1)`, [spare]));
(await one(`select stock from listings where id=$1`, [auto])).stock === 0 ? ok("quitar ítem baja el stock") : bad("stock tras quitar");

await as("authenticated", SELLER, () => expectError("cambiar bumped_at a mano", () => db.query(`update listings set bumped_at = now() + interval '1 day' where id = $1`, [auto]), "Subir ofertas"));
await as("authenticated", SELLER, () => expectError("subir antes de 4 horas", () => db.query(`select bump_listings($1)`, [ref.category]), "volver a subir"));
await db.exec(`update listings set bumped_at = now() - interval '5 hours' where seller_id = '${SELLER}'`);
(await as("authenticated", SELLER, () => one(`select bump_listings($1) n`, [ref.category]))).n >= 1 ? ok("subir ofertas después de 4 horas") : bad("bump");

const convA = (await as("authenticated", BUYER, () => one(`select id from conversations where user_low = least($1::uuid,$2::uuid) and user_high = greatest($1::uuid,$2::uuid)`, [BUYER, SELLER]))).id;
await as("authenticated", BUYER, () => db.query(`insert into conversation_messages (conversation_id, sender_id, body, attachment_path) values ($1,$2,'',$3)`, [convA, BUYER, `${convA}/captura.png`]).then(() => ok("mensaje solo con imagen adjunta")));
await as("authenticated", BUYER, () => expectError("adjunto de otra conversación", () => db.query(`insert into conversation_messages (conversation_id, sender_id, body, attachment_path) values ($1,$2,'x',$3)`, [convA, BUYER, `${conv2}/x.png`])));
await as("authenticated", BUYER, () => expectError("mensaje vacío sin adjunto", () => db.query(`insert into conversation_messages (conversation_id, sender_id, body) values ($1,$2,'   ')`, [convA, BUYER])));

console.log("\nPago manual (transferencia / cripto verificada por un administrador)");
const mListing = (await as("authenticated", SELLER, () =>
  one(`insert into listings (seller_id, game_id, server_id, category_id, title, description, price_cents, stock, delivery_time_hours)
       values ($1, $2, $3, $4, 'Adena pago manual', 'Prueba de transferencia', 100000, 10, 1) returning id`, [SELLER, ref.game, ref.server, ref.category]))).id;
const mA = (await as("authenticated", BUYER, () => one(`select create_order($1, 1, 'manual') id`, [mListing]))).id;
const mB = (await as("authenticated", BUYER, () => one(`select create_order($1, 1, 'manual') id`, [mListing]))).id;
(await one(`select payment_mode, status from orders where id=$1`, [mA])).payment_mode === "manual" ? ok("orden creada en modo manual") : bad("modo manual");
await as("authenticated", BUYER, () => expectError("modo de pago inexistente", () => db.query(`select create_order($1, 1, 'trueque')`, [mListing]), "inválido"));
(await one(`select configured from manual_payment_settings`)).configured === false ? ok("datos de cobro genéricos y sin confirmar por defecto") : bad("configured por defecto");
await as("authenticated", BUYER, () => expectError("comprador edita datos de cobro", () => db.query(`update manual_payment_settings set cvu = '1111111111111111111111'`)));
await as("authenticated", BUYER, () => expectError("comprador se autoaprueba el pago", () => db.query(`select sys_review_manual_payment(1, true, $1, null)`, [BUYER]), "permission denied"));
await as("authenticated", OTHER, () => expectError("tercero avisa un pago ajeno", () => db.query(`select report_manual_payment($1,'cvu','COMP-0001')`, [mA]), "inexistente"));
await as("authenticated", BUYER, () => expectError("aviso sin referencia", () => db.query(`select report_manual_payment($1,'cvu','ab')`, [mA]), "TXID"));
await as("authenticated", BUYER, () => expectError("medio inválido", () => db.query(`select report_manual_payment($1,'efectivo','COMP-0001')`, [mA])));
await as("authenticated", BUYER, () => expectError("comprobante de otra carpeta", () => db.query(`select report_manual_payment($1,'cvu','COMP-0001','Yo',null,$2)`, [mA, `${OTHER}/${mA}/x.png`]), "Comprobante"));
const mp1 = (await as("authenticated", BUYER, () => one(`select report_manual_payment($1,'usdt','TXID-ABC-123','Comprador Uno','desde binance',$2) id`, [mA, `${BUYER}/${mA}/c.png`]))).id;
ok("el comprador avisa su pago");
(await one(`select count(*)::int n from order_events where order_id=$1 and event_type='pago_informado'`, [mA])).n === 1 ? ok("queda registrado en el historial de la orden") : bad("evento pago_informado");
(await one(`select status from orders where id=$1`, [mA])).status === "pendiente_pago" ? ok("avisar el pago NO cambia el estado de la orden") : bad("aviso cambió la orden");
await as("authenticated", BUYER, () => expectError("segundo aviso mientras hay uno pendiente", () => db.query(`select report_manual_payment($1,'cvu','OTRO-9999')`, [mA]), "Ya avisaste"));
await as("authenticated", BUYER, () => expectError("misma referencia en otra orden", () => db.query(`select report_manual_payment($1,'usdt','txid-abc-123')`, [mB]), "ya fue informada"));
await as("authenticated", BUYER, () => db.query(`select * from manual_payments`).then((r) => (r.rows.length === 1 ? ok("el comprador ve su aviso") : bad("comprador ve avisos"))));
await as("authenticated", OTHER, () => db.query(`select * from manual_payments`).then((r) => (r.rows.length === 0 ? ok("terceros no ven avisos de pago ajenos") : bad("tercero ve avisos"))));
await as("authenticated", ADMIN, () => db.query(`select * from manual_payments`).then((r) => (r.rows.length === 1 ? ok("el administrador ve los avisos") : bad("admin no ve avisos"))));
await as("authenticated", BUYER, () => expectError("comprador borra su aviso", () => db.query(`delete from manual_payments where id=$1`, [mp1])));

// Vencimiento: la orden con aviso pendiente no se cancela; la otra sí.
await db.exec(`alter table orders disable trigger orders_guard;
  update orders set created_at = now() - interval '3 hours' where id in ('${mA}', '${mB}');
  alter table orders enable trigger orders_guard;`);
const stockBefore = (await one(`select stock from listings where id=$1`, [mListing])).stock;
await as("service_role", null, () => db.query(`select sys_expire_pending()`));
const expired = await one(`select (select status from orders where id=$1) a, (select status from orders where id=$2) b, (select stock from listings where id=$3) stock`, [mA, mB, mListing]);
expired.a === "pendiente_pago" && expired.b === "cancelado" && expired.stock === stockBefore + 1
  ? ok("un aviso pendiente frena el vencimiento; la orden sin aviso vence y devuelve stock") : bad(`vencimiento ${JSON.stringify(expired)}`);

// Rechazo: pide motivo, avisa al comprador por el chat y deja volver a intentar.
await as("service_role", null, () => expectError("rechazar sin motivo", () => db.query(`select sys_review_manual_payment($1,false,$2,'')`, [mp1, ADMIN]), "motivo"));
(await as("service_role", null, () => one(`select sys_review_manual_payment($1,false,$2,'No llegó el importe') r`, [mp1, ADMIN]))).r === "rechazado" ? ok("administrador rechaza el aviso con motivo") : bad("rechazo");
(await as("authenticated", BUYER, () => one(`select count(*)::int n from conversation_messages where kind='sistema' and order_id=$1 and body like '%no pudimos verificar tu pago%'`, [mA]))).n === 1
  ? ok("el comprador recibe el motivo en el chat de la orden") : bad("sin aviso de rechazo");
(await one(`select status from orders where id=$1`, [mA])).status === "pendiente_pago" ? ok("tras el rechazo la orden sigue pendiente de pago") : bad("estado tras rechazo");
await as("service_role", null, () => expectError("revisar dos veces el mismo aviso", () => db.query(`select sys_review_manual_payment($1,true,$2,null)`, [mp1, ADMIN]), "ya fue revisado"));
const mp2 = (await as("authenticated", BUYER, () => one(`select report_manual_payment($1,'usdt','TXID-ABC-123','Comprador Uno') id`, [mA]))).id;
ok("una referencia rechazada se puede volver a informar");

// Confirmación: recién ahora la orden queda pagada, con proveedor 'manual'.
(await as("service_role", null, () => one(`select sys_review_manual_payment($1,true,$2,null) r`, [mp2, ADMIN]))).r === "confirmado" ? ok("administrador confirma el pago") : bad("confirmación");
const paid = await one(`select status, payment_provider, paid_at is not null paid from orders where id=$1`, [mA]);
paid.status === "pago_confirmado" && paid.payment_provider === "manual" && paid.paid ? ok("la orden queda pagada (proveedor manual) solo tras la confirmación") : bad(`orden pagada ${JSON.stringify(paid)}`);
(await one(`select count(*)::int n from payment_transactions where order_id=$1 and provider='manual' and kind='cobro' and amount_cents=100000`, [mA])).n === 1
  ? ok("cobro manual registrado por el importe exacto de la orden") : bad("payment_transactions manual");

// Flujo completo hasta la liquidación manual.
await as("authenticated", SELLER, () => db.query(`select order_action($1,'iniciar_entrega',null,null)`, [mA]));
await as("authenticated", SELLER, () => db.query(`select order_action($1,'marcar_entregado','Adena enviada por trade',null)`, [mA]));
await as("authenticated", BUYER, () => db.query(`select order_action($1,'confirmar_recepcion',null,null)`, [mA]));
const net = Number((await one(`select seller_net_cents n from orders where id=$1`, [mA])).n);
await as("service_role", null, () => expectError("liquidar un importe distinto al neto", () => db.query(`select sys_record_payout($1,'manual','x:TRANSF-1',$2,'{}',$3)`, [mA, net + 1, ADMIN]), "neto"));
(await as("service_role", null, () => one(`select sys_record_payout($1,'manual','x:TRANSF-1',$2,'{"manual":true}',$3) r`, [mA, net, ADMIN]))).r === "liquidado"
  ? ok("liquidación manual registrada con su comprobante") : bad("liquidación manual");
(await one(`select status from orders where id=$1`, [mA])).status === "liquidado" ? ok("orden manual liquidada") : bad("estado final manual");

console.log(failures ? `\n${failures} verificaciones fallaron` : "\nTodas las verificaciones pasaron");
process.exit(failures ? 1 : 0);
