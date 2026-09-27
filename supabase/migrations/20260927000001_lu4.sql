-- Argenpay · reversión para Lineage 2 LU4 (lu4.org)
-- - Catálogo LU4: servidores Carmine, Gamma, Black y White; categorías Adena (por kk), Cuentas, Ítems y Servicios.
-- - Atributos de personaje (raza, clase, nivel), cantidad mínima y stock grande para adena.
-- - Presencia en línea, reseñas de vendedores y chat entre usuarios (con mensajes de sistema por orden).

-- ───────────────────────────── Catálogo ──────────────────────────────
alter table public.categories
  add column if not exists unit_label text not null default 'unidad',
  add column if not exists unit_label_plural text not null default 'unidades',
  add column if not exists description text not null default '';

alter table public.game_servers
  add column if not exists description text not null default '',
  add column if not exists sort_order integer not null default 100,
  add column if not exists active boolean not null default true;

insert into public.games (slug, name, sort_order, active)
values ('lineage-2-lu4', 'Lineage 2 LU4', 1, true)
on conflict (slug) do update set name = excluded.name, sort_order = 1, active = true;

update public.games set active = false where slug <> 'lineage-2-lu4';

delete from public.game_servers s
 where s.game_id in (select id from public.games where slug <> 'lineage-2-lu4')
   and not exists (select 1 from public.listings l where l.server_id = s.id);

insert into public.game_servers (game_id, name, description, sort_order)
select g.id, v.name, v.descr, v.ord
  from public.games g,
       (values ('Carmine', 'UTC-3 · comunidad latinoamericana', 10),
               ('Gamma', 'Servidor Gamma', 20),
               ('Black', 'UTC+3', 30),
               ('White', 'UTC+3', 40)) as v(name, descr, ord)
 where g.slug = 'lineage-2-lu4'
on conflict (game_id, name) do update set description = excluded.description, sort_order = excluded.sort_order, active = true;

-- La categoría "monedas" del esquema inicial pasa a ser "adena".
update public.categories set slug = 'adena'
 where slug = 'monedas' and not exists (select 1 from public.categories where slug = 'adena');

insert into public.categories (slug, name, sort_order, unit_label, unit_label_plural, description) values
  ('adena', 'Adena', 10, 'kk', 'kk', 'Moneda del juego. 1 kk = 1.000.000 de adena.'),
  ('cuentas', 'Cuentas y personajes', 20, 'cuenta', 'cuentas', 'Personajes con clase, nivel y equipo.'),
  ('items', 'Ítems y equipo', 30, 'ítem', 'ítems', 'Armas, armaduras, joyas, recetas y materiales.'),
  ('servicios', 'Servicios', 40, 'servicio', 'servicios', 'Leveo, quests de profesión, farm y acompañamiento.')
on conflict (slug) do update set
  name = excluded.name, sort_order = excluded.sort_order, unit_label = excluded.unit_label,
  unit_label_plural = excluded.unit_label_plural, description = excluded.description;

delete from public.categories c
 where c.slug not in ('adena', 'cuentas', 'items', 'servicios')
   and not exists (select 1 from public.listings l where l.category_id = c.id);

-- ─────────────────────────── Publicaciones ───────────────────────────
alter table public.listings alter column region_id drop not null;

alter table public.listings
  add column if not exists min_quantity integer not null default 1 check (min_quantity between 1 and 1000000),
  add column if not exists char_race text check (char_race in ('humano', 'elfo', 'elfo_oscuro', 'orco', 'enano')),
  add column if not exists char_class text check (char_class is null or char_length(char_class) between 2 and 40),
  add column if not exists char_level integer check (char_level is null or char_level between 1 and 99);

alter table public.listings drop constraint if exists listings_stock_check;
alter table public.listings add constraint listings_stock_check check (stock between 0 and 10000000);

alter table public.orders drop constraint if exists orders_quantity_check;
alter table public.orders add constraint orders_quantity_check check (quantity between 1 and 10000000);
-- Tope del total por orden: evita desbordes en el cálculo de comisión (precio × bps).
alter table public.orders add constraint orders_price_cap check (price_cents <= 1000000000000);

create index if not exists listings_server_idx on public.listings (server_id, category_id, price_cents) where status = 'activa';

-- ───────────────────────────── Presencia ─────────────────────────────
alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_seen_at = now()
   where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '60 seconds');
$$;

-- ───────────────────────────── Órdenes ───────────────────────────────
create or replace function public.create_order(p_listing_id uuid, p_quantity integer, p_payment_mode text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_settings public.platform_settings%rowtype;
  v_price bigint;
  v_commission bigint;
  v_proc bigint;
  v_order_id uuid;
  v_snapshot jsonb;
  v_min integer;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión para comprar' using errcode = '42501';
  end if;
  if p_payment_mode not in ('simulado', 'real') then
    raise exception 'Modo de pago inválido';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000000 then
    raise exception 'Cantidad inválida';
  end if;

  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found or v_listing.status <> 'activa' then
    raise exception 'La publicación no está disponible';
  end if;
  if v_listing.seller_id = v_uid then
    raise exception 'No podés comprar tu propia publicación';
  end if;
  if v_listing.stock < p_quantity then
    raise exception 'No hay disponibilidad suficiente';
  end if;
  -- Si queda menos stock que el mínimo, se puede comprar todo lo que queda.
  v_min := least(v_listing.min_quantity, v_listing.stock);
  if p_quantity < v_min then
    raise exception 'La compra mínima de esta publicación es %', v_min;
  end if;

  select * into v_settings from public.platform_settings where id;

  v_price := v_listing.price_cents * p_quantity;
  if v_price > 1000000000000 then
    raise exception 'El total supera el máximo permitido por orden';
  end if;
  v_commission := (v_price * v_settings.commission_bps + 5000) / 10000;
  v_proc := (v_price * v_settings.processor_fee_bps + 5000) / 10000;

  select jsonb_build_object(
    'title', v_listing.title,
    'description', v_listing.description,
    'conditions', v_listing.conditions,
    'game', g.name, 'game_slug', g.slug,
    'server', s.name,
    'region', r.name,
    'category', c.name,
    'category_slug', c.slug,
    'unit', c.unit_label,
    'unit_plural', c.unit_label_plural,
    'race', v_listing.char_race,
    'class', v_listing.char_class,
    'level', v_listing.char_level
  ) into v_snapshot
  from public.games g
  join public.categories c on c.id = v_listing.category_id
  left join public.regions r on r.id = v_listing.region_id
  left join public.game_servers s on s.id = v_listing.server_id
  where g.id = v_listing.game_id;

  insert into public.orders (
    listing_id, buyer_id, seller_id, quantity, unit_price_cents, price_cents,
    commission_bps, commission_cents, processor_fee_bps, processor_fee_cents, processor_fee_policy,
    seller_net_cents, platform_net_cents, currency, status, payment_mode, listing_snapshot, delivery_time_hours)
  values (
    v_listing.id, v_uid, v_listing.seller_id, p_quantity, v_listing.price_cents, v_price,
    v_settings.commission_bps, v_commission, v_settings.processor_fee_bps, v_proc, v_settings.processor_fee_policy,
    v_price - v_commission - case when v_settings.processor_fee_policy = 'vendedor_absorbe' then v_proc else 0 end,
    v_commission - case when v_settings.processor_fee_policy = 'plataforma_absorbe' then v_proc else 0 end,
    v_listing.currency, 'pendiente_pago', p_payment_mode, v_snapshot, v_listing.delivery_time_hours)
  returning id into v_order_id;

  update public.listings set stock = stock - p_quantity where id = v_listing.id;

  perform public.log_order_event(v_order_id, v_uid, 'comprador', 'orden_creada', null, 'pendiente_pago', null,
    jsonb_build_object('precio_cents', v_price, 'comision_cents', v_commission,
                       'cargo_procesador_cents', v_proc, 'neto_vendedor_cents',
                       v_price - v_commission - case when v_settings.processor_fee_policy = 'vendedor_absorbe' then v_proc else 0 end));
  return v_order_id;
end;
$$;

-- ───────────────────────────── Reseñas ───────────────────────────────
create table public.reviews (
  id bigint generated always as identity primary key,
  order_id uuid not null unique references public.orders (id),
  seller_id uuid not null references public.profiles (id),
  buyer_id uuid not null references public.profiles (id),
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 1000),
  created_at timestamptz not null default now()
);
create index reviews_seller_idx on public.reviews (seller_id, created_at desc);

alter table public.reviews enable row level security;
create policy "resenas lectura publica" on public.reviews for select using (true);
revoke insert, update, delete on public.reviews from anon, authenticated;

create trigger reviews_immutable before update or delete on public.reviews
  for each row execute function public.forbid_mutation();

create view public.seller_ratings
with (security_invoker = true) as
  select seller_id, count(*)::integer as reviews_count, round(avg(rating)::numeric, 2) as rating_avg
    from public.reviews
   group by seller_id;

create or replace function public.leave_review(p_order_id uuid, p_rating integer, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.buyer_id is distinct from auth.uid() then
    raise exception 'Solo el comprador puede calificar esta orden' using errcode = '42501';
  end if;
  if v_order.status not in ('confirmado', 'liquidado') then
    raise exception 'Podés calificar cuando la orden esté confirmada';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'La calificación debe ser de 1 a 5';
  end if;
  insert into public.reviews (order_id, seller_id, buyer_id, rating, body)
  values (v_order.id, v_order.seller_id, v_order.buyer_id, p_rating, left(trim(coalesce(p_body, '')), 1000));
exception when unique_violation then
  raise exception 'Ya calificaste esta orden';
end;
$$;

-- ─────────────────────────── Conversaciones ──────────────────────────
-- Un chat por par de usuarios (como en los marketplaces entre jugadores). Las órdenes
-- publican mensajes de sistema en el chat del comprador con el vendedor.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.profiles (id) on delete cascade,
  user_high uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '',
  low_last_read_at timestamptz not null default now(),
  high_last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (user_low < user_high),
  unique (user_low, user_high)
);
create index conversations_low_idx on public.conversations (user_low, last_message_at desc);
create index conversations_high_idx on public.conversations (user_high, last_message_at desc);

create table public.conversation_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id),
  kind text not null default 'usuario' check (kind in ('usuario', 'sistema')),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  order_id uuid references public.orders (id),
  listing_id uuid references public.listings (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'usuario') = (sender_id is not null))
);
create index conversation_messages_conv_idx on public.conversation_messages (conversation_id, id);

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

create policy "conversaciones participantes" on public.conversations for select
  using (auth.uid() in (user_low, user_high) or public.is_admin());

create policy "mensajes conversacion lectura" on public.conversation_messages for select
  using (public.is_admin() or exists (
    select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.user_low, c.user_high)));

create policy "mensajes conversacion alta" on public.conversation_messages for insert
  with check (
    kind = 'usuario' and sender_id = auth.uid()
    and (public.is_admin() or exists (
      select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.user_low, c.user_high))));

revoke insert, update, delete on public.conversations from anon, authenticated;
revoke update, delete on public.conversation_messages from anon, authenticated;

create trigger conversation_messages_immutable before update or delete on public.conversation_messages
  for each row execute function public.forbid_mutation();

create or replace function public.ensure_conversation(p_a uuid, p_b uuid, p_listing uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_a = p_b then
    raise exception 'No podés abrir un chat con vos mismo';
  end if;
  insert into public.conversations (user_low, user_high, listing_id)
  values (least(p_a, p_b), greatest(p_a, p_b), p_listing)
  on conflict (user_low, user_high)
  do update set listing_id = coalesce(excluded.listing_id, public.conversations.listing_id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.start_conversation(p_other uuid, p_listing uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Necesitás iniciar sesión' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'Usuario inexistente';
  end if;
  return public.ensure_conversation(auth.uid(), p_other, p_listing);
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversations
     set low_last_read_at = case when user_low = auth.uid() then now() else low_last_read_at end,
         high_last_read_at = case when user_high = auth.uid() then now() else high_last_read_at end
   where id = p_conversation_id and auth.uid() in (user_low, user_high);
$$;

create or replace function public.unread_conversations()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.conversations
   where (user_low = auth.uid() and last_message_at > low_last_read_at)
      or (user_high = auth.uid() and last_message_at > high_last_read_at);
$$;

create or replace function public.on_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = left(new.body, 140),
         low_last_read_at = case when new.sender_id = user_low then new.created_at else low_last_read_at end,
         high_last_read_at = case when new.sender_id = user_high then new.created_at else high_last_read_at end,
         listing_id = coalesce(new.listing_id, listing_id)
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger conversation_messages_after_insert after insert on public.conversation_messages
  for each row execute function public.on_conversation_message();

-- Los eventos de orden también se publican como mensajes de sistema en el chat del par.
create or replace function public.log_order_event(
  p_order_id uuid, p_actor_id uuid, p_actor_role text, p_event_type text,
  p_from public.order_status, p_to public.order_status, p_note text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_code text := upper(left(p_order_id::text, 8));
  v_text text;
  v_conv uuid;
begin
  insert into public.order_events (order_id, actor_id, actor_role, event_type, from_status, to_status, note, metadata)
  values (p_order_id, p_actor_id, p_actor_role, p_event_type, p_from, p_to, p_note, coalesce(p_metadata, '{}'::jsonb));

  select * into v_order from public.orders where id = p_order_id;
  v_text := case p_event_type
    when 'orden_creada' then format('Orden #%s creada: %s · %s %s. Pendiente de pago.', v_code,
      v_order.listing_snapshot ->> 'title', v_order.quantity, coalesce(v_order.listing_snapshot ->> 'unit_plural', 'u.'))
    when 'pago_confirmado' then format('Orden #%s: pago confirmado. El vendedor ya puede entregar.', v_code)
    when 'iniciar_entrega' then format('Orden #%s: el vendedor inició la entrega.', v_code)
    when 'marcar_entregado' then format('Orden #%s: el vendedor marcó la entrega. Revisá y confirmá la recepción o abrí un reclamo.', v_code)
    when 'confirmar_recepcion' then format('Orden #%s confirmada por el comprador.', v_code)
    when 'confirmacion_automatica' then format('Orden #%s confirmada automáticamente.', v_code)
    when 'abrir_reclamo' then format('Orden #%s: el comprador abrió un reclamo. Un administrador va a intervenir.', v_code)
    when 'resolver_vendedor' then format('Orden #%s: reclamo resuelto a favor del vendedor.', v_code)
    when 'reembolso' then format('Orden #%s reembolsada al comprador.', v_code)
    when 'liquidacion' then format('Orden #%s liquidada al vendedor.', v_code)
    when 'cancelar' then format('Orden #%s cancelada.', v_code)
    when 'vencimiento_pago' then format('Orden #%s cancelada por falta de pago.', v_code)
    else null end;

  if v_text is not null then
    v_conv := public.ensure_conversation(v_order.buyer_id, v_order.seller_id, v_order.listing_id);
    insert into public.conversation_messages (conversation_id, sender_id, kind, body, order_id)
    values (v_conv, null, 'sistema', v_text, p_order_id);
  end if;
end;
$$;

-- ───────────────────────────── Permisos ──────────────────────────────
revoke execute on function public.ensure_conversation(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.on_conversation_message() from public, anon, authenticated;
revoke execute on function public.log_order_event(uuid, uuid, text, text, public.order_status, public.order_status, text, jsonb) from public, anon, authenticated;
revoke execute on function public.create_order(uuid, integer, text) from public, anon;
grant execute on function public.create_order(uuid, integer, text) to authenticated;

revoke execute on function public.touch_presence() from public, anon;
revoke execute on function public.leave_review(uuid, integer, text) from public, anon;
revoke execute on function public.start_conversation(uuid, uuid) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
revoke execute on function public.unread_conversations() from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.leave_review(uuid, integer, text) to authenticated;
grant execute on function public.start_conversation(uuid, uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.unread_conversations() to authenticated;

-- Tiempo real para el chat (Supabase Realtime respeta RLS).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.conversation_messages;
  end if;
end;
$$;
