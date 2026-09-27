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
catalog.servers === 4 && catalog.categories === 4
  ? ok("catálogo LU4: 4 servidores, 4 categorías")
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
await as("service_role", null, () => expectError("liquidar un importe distinto al neto", () => db.query(`select sys_record_payout($1,'simulado','p2',1,'{}',$2)`, [order2, ADMIN]), "neto"));
const o2 = await one(`select seller_net_cents from orders where id=$1`, [order2]);
await as("service_role", null, () => db.query(`select sys_record_payout($1,'simulado','p2',$2,'{}',$3)`, [order2, o2.seller_net_cents, ADMIN]));
(await one(`select status from orders where id=$1`, [order2])).status === "liquidado" ? ok("orden liquidada") : bad("no liquidó");

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
const rating = await as("anon", null, () => one(`select reviews_count, rating_avg from seller_ratings where seller_id=$1`, [SELLER]));
rating?.reviews_count === 1 && Number(rating.rating_avg) === 5 ? ok("calificación pública del vendedor: 5,0 (1)") : bad(`rating ${JSON.stringify(rating)}`);

await as("authenticated", SELLER, () => db.query(`select touch_presence()`));
(await one(`select last_seen_at from profiles where id=$1`, [SELLER])).last_seen_at ? ok("presencia en línea registrada") : bad("sin presencia");
await as("anon", null, () => expectError("anon no puede marcar presencia", () => db.query(`select touch_presence()`), "permission"));

console.log(failures ? `\n${failures} verificaciones fallaron` : "\nTodas las verificaciones pasaron");
process.exit(failures ? 1 : 0);
