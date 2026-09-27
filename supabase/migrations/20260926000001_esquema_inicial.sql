-- Argenpay · esquema inicial del MVP
-- Importes: siempre en centavos (bigint). Nunca se guardan decimales.
-- Regla de redondeo: comisión y cargos se redondean "mitad hacia arriba" al centavo:
--   comision = floor((precio * bps + 5000) / 10000)
-- Los clientes (rol authenticated) NO pueden insertar ni modificar órdenes, pagos ni eventos:
-- todo cambio pasa por funciones SECURITY DEFINER que validan actor y transición.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm with schema extensions;

-- ─────────────────────────────── Tipos ───────────────────────────────
create type public.order_status as enum (
  'pendiente_pago',
  'pago_confirmado',
  'entrega_en_curso',
  'entregado',
  'confirmado',
  'en_reclamo',
  'reembolsado',
  'cancelado',
  'liquidado'
);

create type public.listing_status as enum ('activa', 'pausada', 'eliminada');

-- Quién asume el cargo del procesador de pagos.
create type public.processor_fee_policy as enum ('plataforma_absorbe', 'vendedor_absorbe');

-- ─────────────────────────── Configuración ───────────────────────────
create table public.platform_settings (
  id boolean primary key default true check (id),
  commission_bps integer not null default 1000 check (commission_bps between 0 and 5000),
  processor_fee_bps integer not null default 0 check (processor_fee_bps between 0 and 2000),
  processor_fee_policy public.processor_fee_policy not null default 'plataforma_absorbe',
  auto_confirm_hours integer not null default 72 check (auto_confirm_hours between 1 and 720),
  pending_payment_minutes integer not null default 60 check (pending_payment_minutes between 5 and 10080),
  currency text not null default 'ARS' check (currency = 'ARS'),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true);

-- ───────────────────────────── Perfiles ──────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  is_seller boolean not null default false,
  is_admin boolean not null default false,
  seller_terms_accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Datos de cobro del vendedor: solo el dueño y administradores.
create table public.seller_payout_accounts (
  seller_id uuid primary key references public.profiles (id) on delete cascade,
  holder_name text not null check (char_length(holder_name) between 3 and 120),
  tax_id text not null check (tax_id ~ '^[0-9]{11}$'),              -- CUIT/CUIL sin guiones
  cbu_or_alias text not null check (char_length(cbu_or_alias) between 6 and 40),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- Crear perfil al registrarse.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
begin
  if v_name is null or char_length(v_name) < 2 then
    v_name := 'usuario_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles (id, display_name) values (new.id, left(v_name, 40));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un usuario no puede darse permisos de admin ni de vendedor editando su fila.
create or replace function public.guard_profile_flags()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.is_admin is distinct from old.is_admin
       or new.is_seller is distinct from old.is_seller
       or new.seller_terms_accepted_at is distinct from old.seller_terms_accepted_at
       or new.id is distinct from old.id then
      raise exception 'No podés modificar estos campos del perfil' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_flags
  before update on public.profiles
  for each row execute function public.guard_profile_flags();

-- ───────────────────────────── Catálogo ──────────────────────────────
create table public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 100
);

create table public.game_servers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  name text not null,
  unique (game_id, name),
  unique (id, game_id)
);

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  sort_order integer not null default 100
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles (id) on delete cascade,
  game_id uuid not null references public.games (id),
  server_id uuid,
  region_id uuid not null references public.regions (id),
  category_id uuid not null references public.categories (id),
  title text not null check (char_length(title) between 5 and 120),
  description text not null check (char_length(description) between 10 and 5000),
  price_cents bigint not null check (price_cents between 100 and 10000000000),
  currency text not null default 'ARS' check (currency = 'ARS'),
  stock integer not null default 1 check (stock between 0 and 100000),
  delivery_time_hours integer not null default 24 check (delivery_time_hours between 1 and 720),
  conditions text not null default '' check (char_length(conditions) <= 3000),
  status public.listing_status not null default 'activa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- el servidor (si existe) debe pertenecer al juego elegido
  foreign key (server_id, game_id) references public.game_servers (id, game_id)
);

create index listings_search_idx on public.listings (status, game_id, category_id, region_id, price_cents);
create index listings_seller_idx on public.listings (seller_id);
create index listings_title_trgm_idx on public.listings using gin (title extensions.gin_trgm_ops);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger listings_touch before update on public.listings
  for each row execute function public.touch_updated_at();

-- Solo vendedores activos pueden publicar; nadie puede cambiar el dueño de una publicación.
create or replace function public.guard_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.seller_id is distinct from old.seller_id then
    raise exception 'No se puede cambiar el vendedor de una publicación' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and not exists (select 1 from public.profiles where id = new.seller_id and is_seller) then
    raise exception 'Tenés que activar tu perfil de vendedor para publicar' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger listings_guard before insert or update on public.listings
  for each row execute function public.guard_listing();

-- ───────────────────────────── Órdenes ───────────────────────────────
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id),
  buyer_id uuid not null references public.profiles (id),
  seller_id uuid not null references public.profiles (id),
  quantity integer not null check (quantity between 1 and 1000),
  -- Importes inmutables (centavos)
  unit_price_cents bigint not null check (unit_price_cents > 0),
  price_cents bigint not null check (price_cents > 0),
  commission_bps integer not null,
  commission_cents bigint not null check (commission_cents >= 0),
  processor_fee_bps integer not null,
  processor_fee_cents bigint not null check (processor_fee_cents >= 0),
  processor_fee_policy public.processor_fee_policy not null,
  seller_net_cents bigint not null check (seller_net_cents >= 0),
  platform_net_cents bigint not null,
  currency text not null default 'ARS',
  -- Estado
  status public.order_status not null default 'pendiente_pago',
  payment_mode text not null check (payment_mode in ('simulado', 'real')),
  payment_provider text,
  listing_snapshot jsonb not null,
  delivery_time_hours integer not null,
  paid_at timestamptz,
  delivery_due_at timestamptz,
  delivered_at timestamptz,
  auto_confirm_at timestamptz,
  confirmed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id),
  check (price_cents = unit_price_cents * quantity),
  check (commission_cents = (price_cents * commission_bps + 5000) / 10000),
  check (processor_fee_cents = (price_cents * processor_fee_bps + 5000) / 10000),
  check (seller_net_cents = price_cents - commission_cents
         - case when processor_fee_policy = 'vendedor_absorbe' then processor_fee_cents else 0 end),
  check (platform_net_cents = commission_cents
         - case when processor_fee_policy = 'plataforma_absorbe' then processor_fee_cents else 0 end)
);

create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_seller_idx on public.orders (seller_id, created_at desc);
create index orders_status_idx on public.orders (status);

create or replace function public.guard_order_update()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'Las órdenes solo se modifican desde el servidor' using errcode = '42501';
  end if;
  if (new.listing_id, new.buyer_id, new.seller_id, new.quantity, new.unit_price_cents, new.price_cents,
      new.commission_bps, new.commission_cents, new.processor_fee_bps, new.processor_fee_cents,
      new.processor_fee_policy, new.seller_net_cents, new.platform_net_cents, new.currency,
      new.payment_mode, new.listing_snapshot, new.created_at)
     is distinct from
     (old.listing_id, old.buyer_id, old.seller_id, old.quantity, old.unit_price_cents, old.price_cents,
      old.commission_bps, old.commission_cents, old.processor_fee_bps, old.processor_fee_cents,
      old.processor_fee_policy, old.seller_net_cents, old.platform_net_cents, old.currency,
      old.payment_mode, old.listing_snapshot, old.created_at) then
    raise exception 'Los importes y datos base de una orden son inmutables' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_guard before update on public.orders
  for each row execute function public.guard_order_update();

create or replace function public.forbid_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Registro no eliminable' using errcode = '42501';
end;
$$;

create trigger orders_no_delete before delete on public.orders
  for each row execute function public.forbid_delete();

-- Registro de eventos (append-only)
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id),
  actor_id uuid references public.profiles (id),
  actor_role text not null check (actor_role in ('comprador', 'vendedor', 'admin', 'sistema')),
  event_type text not null,
  from_status public.order_status,
  to_status public.order_status,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, id);

create or replace function public.forbid_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Registro inmutable' using errcode = '42501';
end;
$$;

create trigger order_events_immutable before update or delete on public.order_events
  for each row execute function public.forbid_mutation();

create table public.order_messages (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id),
  sender_id uuid not null references public.profiles (id),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index order_messages_order_idx on public.order_messages (order_id, id);

create trigger order_messages_immutable before update or delete on public.order_messages
  for each row execute function public.forbid_mutation();

create table public.delivery_evidence (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id),
  seller_id uuid not null references public.profiles (id),
  description text not null check (char_length(description) between 5 and 3000),
  file_path text,
  created_at timestamptz not null default now()
);

create trigger delivery_evidence_immutable before update or delete on public.delivery_evidence
  for each row execute function public.forbid_mutation();

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id),
  opened_by uuid not null references public.profiles (id),
  reason text not null check (char_length(reason) between 10 and 3000),
  status text not null default 'abierto' check (status in ('abierto', 'resuelto')),
  resolution text check (resolution in ('a_favor_vendedor', 'reembolso_comprador')),
  resolution_note text,
  resolved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Transacciones con el procesador (cobros, reembolsos, liquidaciones). Solo servidor/admin.
create table public.payment_transactions (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id),
  provider text not null,
  kind text not null check (kind in ('cobro', 'reembolso', 'liquidacion')),
  provider_ref text not null,
  status text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  fee_cents bigint,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, kind, provider_ref)
);
create index payment_transactions_order_idx on public.payment_transactions (order_id);

create trigger payment_transactions_no_delete before delete on public.payment_transactions
  for each row execute function public.forbid_delete();

-- Idempotencia de notificaciones entrantes.
create table public.webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  result text,
  unique (provider, event_key)
);

-- Estado interno del proveedor SIMULADO (solo service_role).
create table public.sim_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  amount_cents bigint not null,
  currency text not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobado', 'rechazado', 'reembolsado')),
  refunded_cents bigint not null default 0,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sim_payouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  seller_id uuid not null references public.profiles (id),
  amount_cents bigint not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

-- ───────────────────────────── RLS ───────────────────────────────────
alter table public.platform_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.seller_payout_accounts enable row level security;
alter table public.games enable row level security;
alter table public.game_servers enable row level security;
alter table public.regions enable row level security;
alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.order_messages enable row level security;
alter table public.delivery_evidence enable row level security;
alter table public.disputes enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.webhook_events enable row level security;
alter table public.sim_payments enable row level security;
alter table public.sim_payouts enable row level security;

create policy "settings lectura publica" on public.platform_settings for select using (true);

create policy "perfiles lectura publica" on public.profiles for select using (true);
create policy "perfil propio editable" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy "cobro vendedor propio lectura" on public.seller_payout_accounts for select
  using (seller_id = auth.uid() or public.is_admin());
create policy "cobro vendedor propio alta" on public.seller_payout_accounts for insert
  with check (seller_id = auth.uid());
create policy "cobro vendedor propio edicion" on public.seller_payout_accounts for update
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());

create policy "juegos lectura" on public.games for select using (true);
create policy "juegos admin" on public.games for all using (public.is_admin()) with check (public.is_admin());
create policy "servidores lectura" on public.game_servers for select using (true);
create policy "servidores admin" on public.game_servers for all using (public.is_admin()) with check (public.is_admin());
create policy "regiones lectura" on public.regions for select using (true);
create policy "regiones admin" on public.regions for all using (public.is_admin()) with check (public.is_admin());
create policy "categorias lectura" on public.categories for select using (true);
create policy "categorias admin" on public.categories for all using (public.is_admin()) with check (public.is_admin());

create policy "publicaciones visibles" on public.listings for select
  using (status = 'activa' or seller_id = auth.uid() or public.is_admin());
create policy "publicaciones alta" on public.listings for insert
  with check (seller_id = auth.uid());
create policy "publicaciones edicion propia" on public.listings for update
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());

create policy "ordenes participantes" on public.orders for select
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.is_admin());
-- Sin políticas de insert/update/delete: solo funciones del servidor.

create policy "eventos participantes" on public.order_events for select
  using (public.is_admin() or exists (
    select 1 from public.orders o where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id)));

create policy "mensajes participantes" on public.order_messages for select
  using (public.is_admin() or exists (
    select 1 from public.orders o where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id)));
create policy "mensajes alta participantes" on public.order_messages for insert
  with check (sender_id = auth.uid() and (public.is_admin() or exists (
    select 1 from public.orders o where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id))));

create policy "evidencia participantes" on public.delivery_evidence for select
  using (public.is_admin() or exists (
    select 1 from public.orders o where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id)));

create policy "reclamos participantes" on public.disputes for select
  using (public.is_admin() or exists (
    select 1 from public.orders o where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id)));

create policy "transacciones admin" on public.payment_transactions for select using (public.is_admin());
create policy "webhooks admin" on public.webhook_events for select using (public.is_admin());
-- sim_payments / sim_payouts: sin políticas => solo service_role.

-- ──────────────────────── Funciones de negocio ───────────────────────

create or replace function public.log_order_event(
  p_order_id uuid, p_actor_id uuid, p_actor_role text, p_event_type text,
  p_from public.order_status, p_to public.order_status, p_note text, p_metadata jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.order_events (order_id, actor_id, actor_role, event_type, from_status, to_status, note, metadata)
  values (p_order_id, p_actor_id, p_actor_role, p_event_type, p_from, p_to, p_note, coalesce(p_metadata, '{}'::jsonb));
$$;

-- Activar perfil de vendedor (acepta condiciones).
create or replace function public.activate_seller()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Necesitás iniciar sesión' using errcode = '42501';
  end if;
  update public.profiles
     set is_seller = true, seller_terms_accepted_at = coalesce(seller_terms_accepted_at, now())
   where id = auth.uid();
end;
$$;

-- Crear orden: los importes se calculan SIEMPRE acá, nunca en el cliente.
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
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión para comprar' using errcode = '42501';
  end if;
  if p_payment_mode not in ('simulado', 'real') then
    raise exception 'Modo de pago inválido';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000 then
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

  select * into v_settings from public.platform_settings where id;

  v_price := v_listing.price_cents * p_quantity;
  v_commission := (v_price * v_settings.commission_bps + 5000) / 10000;
  v_proc := (v_price * v_settings.processor_fee_bps + 5000) / 10000;

  select jsonb_build_object(
    'title', v_listing.title,
    'description', v_listing.description,
    'conditions', v_listing.conditions,
    'game', g.name, 'game_slug', g.slug,
    'server', s.name,
    'region', r.name,
    'category', c.name
  ) into v_snapshot
  from public.games g
  join public.regions r on r.id = v_listing.region_id
  join public.categories c on c.id = v_listing.category_id
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

  -- Reservamos la disponibilidad; se devuelve si la orden se cancela.
  update public.listings set stock = stock - p_quantity where id = v_listing.id;

  perform public.log_order_event(v_order_id, v_uid, 'comprador', 'orden_creada', null, 'pendiente_pago', null,
    jsonb_build_object('precio_cents', v_price, 'comision_cents', v_commission,
                       'cargo_procesador_cents', v_proc, 'neto_vendedor_cents',
                       v_price - v_commission - case when v_settings.processor_fee_policy = 'vendedor_absorbe' then v_proc else 0 end));
  return v_order_id;
end;
$$;

-- Acciones de usuarios sobre una orden. Cada transición valida estado y actor.
-- Transiciones permitidas (espejo en src/lib/orders/state-machine.ts):
--   cancelar             comprador|admin  pendiente_pago                              -> cancelado
--   iniciar_entrega      vendedor         pago_confirmado                             -> entrega_en_curso
--   marcar_entregado     vendedor         pago_confirmado|entrega_en_curso            -> entregado (requiere evidencia)
--   confirmar_recepcion  comprador        entregado                                   -> confirmado
--   abrir_reclamo        comprador        entregado | (pago_confirmado|entrega_en_curso si venció el plazo) -> en_reclamo
--   resolver_vendedor    admin            en_reclamo                                  -> confirmado
-- Transiciones que dependen del procesador (solo servidor con service_role):
--   sys_confirm_payment  pendiente_pago -> pago_confirmado
--   sys_record_refund    pago_confirmado|entrega_en_curso|en_reclamo -> reembolsado
--   sys_record_payout    confirmado -> liquidado
--   sys_auto_confirm     entregado -> confirmado (vence ventana sin reclamo)
--   sys_expire_pending   pendiente_pago -> cancelado
create or replace function public.order_action(
  p_order_id uuid, p_action text, p_note text default null, p_evidence_path text default null)
returns public.order_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_admin boolean := public.is_admin();
  v_role text;
  v_to public.order_status;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_hours integer;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Orden inexistente';
  end if;

  v_role := case
    when v_order.buyer_id = v_uid then 'comprador'
    when v_order.seller_id = v_uid then 'vendedor'
    when v_admin then 'admin'
    else null end;
  if v_role is null then
    raise exception 'No participás de esta orden' using errcode = '42501';
  end if;

  if p_action = 'cancelar' then
    if v_role not in ('comprador', 'admin') and not v_admin then
      raise exception 'Solo el comprador o un administrador pueden cancelar';
    end if;
    if v_order.status <> 'pendiente_pago' then
      raise exception 'Solo se puede cancelar una orden pendiente de pago';
    end if;
    v_to := 'cancelado';
    update public.orders set status = v_to, closed_at = now() where id = v_order.id;
    update public.listings set stock = stock + v_order.quantity where id = v_order.listing_id;

  elsif p_action = 'iniciar_entrega' then
    if v_role <> 'vendedor' then
      raise exception 'Solo el vendedor puede iniciar la entrega';
    end if;
    if v_order.status <> 'pago_confirmado' then
      raise exception 'La orden no tiene el pago confirmado';
    end if;
    v_to := 'entrega_en_curso';
    update public.orders set status = v_to where id = v_order.id;

  elsif p_action = 'marcar_entregado' then
    if v_role <> 'vendedor' then
      raise exception 'Solo el vendedor puede marcar la entrega';
    end if;
    if v_order.status not in ('pago_confirmado', 'entrega_en_curso') then
      raise exception 'La orden no está lista para entregarse';
    end if;
    if v_note is null or char_length(v_note) < 5 then
      raise exception 'Describí la evidencia de entrega (mínimo 5 caracteres)';
    end if;
    if p_evidence_path is not null and split_part(p_evidence_path, '/', 1) <> v_order.id::text then
      raise exception 'Archivo de evidencia inválido';
    end if;
    insert into public.delivery_evidence (order_id, seller_id, description, file_path)
      values (v_order.id, v_uid, v_note, p_evidence_path);
    select auto_confirm_hours into v_hours from public.platform_settings where id;
    v_to := 'entregado';
    update public.orders
       set status = v_to, delivered_at = now(), auto_confirm_at = now() + make_interval(hours => v_hours)
     where id = v_order.id;

  elsif p_action = 'confirmar_recepcion' then
    if v_role <> 'comprador' then
      raise exception 'Solo el comprador puede confirmar la recepción';
    end if;
    if v_order.status <> 'entregado' then
      raise exception 'La orden todavía no fue marcada como entregada';
    end if;
    v_to := 'confirmado';
    update public.orders set status = v_to, confirmed_at = now() where id = v_order.id;

  elsif p_action = 'abrir_reclamo' then
    if v_role <> 'comprador' then
      raise exception 'Solo el comprador puede abrir un reclamo';
    end if;
    if v_order.status = 'entregado' then
      null;
    elsif v_order.status in ('pago_confirmado', 'entrega_en_curso') then
      if v_order.delivery_due_at is null or now() < v_order.delivery_due_at then
        raise exception 'Podrás reclamar por falta de entrega cuando venza el plazo estimado';
      end if;
    else
      raise exception 'No se puede abrir un reclamo en este estado';
    end if;
    if v_note is null or char_length(v_note) < 10 then
      raise exception 'Explicá el motivo del reclamo (mínimo 10 caracteres)';
    end if;
    insert into public.disputes (order_id, opened_by, reason) values (v_order.id, v_uid, v_note);
    v_to := 'en_reclamo';
    update public.orders set status = v_to, auto_confirm_at = null where id = v_order.id;

  elsif p_action = 'resolver_vendedor' then
    if not v_admin then
      raise exception 'Solo un administrador puede resolver reclamos' using errcode = '42501';
    end if;
    if v_order.status <> 'en_reclamo' then
      raise exception 'La orden no está en reclamo';
    end if;
    if v_note is null then
      raise exception 'Agregá una nota de resolución';
    end if;
    v_role := 'admin';
    update public.disputes
       set status = 'resuelto', resolution = 'a_favor_vendedor', resolution_note = v_note,
           resolved_by = v_uid, resolved_at = now()
     where order_id = v_order.id;
    v_to := 'confirmado';
    update public.orders set status = v_to, confirmed_at = now() where id = v_order.id;

  else
    raise exception 'Acción desconocida: %', p_action;
  end if;

  perform public.log_order_event(v_order.id, v_uid, v_role, p_action, v_order.status, v_to, v_note,
    case when p_evidence_path is not null then jsonb_build_object('evidencia', p_evidence_path) else '{}'::jsonb end);
  return v_to;
end;
$$;

-- ─────────────── Funciones de sistema (solo service_role) ───────────────

create or replace function public.sys_confirm_payment(
  p_order_id uuid, p_provider text, p_provider_ref text, p_amount_cents bigint,
  p_currency text, p_fee_cents bigint, p_raw jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_inserted integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return 'orden_inexistente';
  end if;

  insert into public.payment_transactions (order_id, provider, kind, provider_ref, status, amount_cents, fee_cents, raw)
  values (p_order_id, p_provider, 'cobro', p_provider_ref, 'aprobado', p_amount_cents, p_fee_cents, coalesce(p_raw, '{}'::jsonb))
  on conflict (provider, kind, provider_ref) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return 'duplicado';
  end if;

  if p_amount_cents <> v_order.price_cents or p_currency <> v_order.currency then
    perform public.log_order_event(p_order_id, null, 'sistema', 'pago_monto_no_coincide', v_order.status, v_order.status,
      'El importe cobrado no coincide con la orden. Requiere revisión.',
      jsonb_build_object('esperado', v_order.price_cents, 'recibido', p_amount_cents, 'moneda', p_currency, 'ref', p_provider_ref));
    return 'monto_invalido';
  end if;

  if v_order.status <> 'pendiente_pago' then
    -- Pago aprobado sobre una orden ya cerrada/cancelada: queda registrado para reembolso manual.
    perform public.log_order_event(p_order_id, null, 'sistema', 'pago_fuera_de_estado', v_order.status, v_order.status,
      'Se recibió un pago aprobado con la orden en estado ' || v_order.status || '. Requiere revisión/reembolso.',
      jsonb_build_object('ref', p_provider_ref));
    return 'fuera_de_estado';
  end if;

  update public.orders
     set status = 'pago_confirmado', paid_at = now(), payment_provider = p_provider,
         delivery_due_at = now() + make_interval(hours => v_order.delivery_time_hours)
   where id = p_order_id;

  perform public.log_order_event(p_order_id, null, 'sistema', 'pago_confirmado', 'pendiente_pago', 'pago_confirmado',
    'Pago verificado con el procesador', jsonb_build_object('proveedor', p_provider, 'ref', p_provider_ref));
  return 'confirmado';
end;
$$;

create or replace function public.sys_record_refund(
  p_order_id uuid, p_provider text, p_provider_ref text, p_amount_cents bigint,
  p_raw jsonb, p_actor_id uuid, p_actor_role text, p_note text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Orden inexistente';
  end if;
  if v_order.status not in ('pago_confirmado', 'entrega_en_curso', 'en_reclamo') then
    raise exception 'La orden no admite reembolso en estado %', v_order.status;
  end if;
  if p_amount_cents <> v_order.price_cents then
    raise exception 'El MVP solo admite reembolsos totales';
  end if;

  insert into public.payment_transactions (order_id, provider, kind, provider_ref, status, amount_cents, raw)
  values (p_order_id, p_provider, 'reembolso', p_provider_ref, 'aprobado', p_amount_cents, coalesce(p_raw, '{}'::jsonb))
  on conflict (provider, kind, provider_ref) do nothing;

  update public.disputes
     set status = 'resuelto', resolution = 'reembolso_comprador', resolution_note = p_note,
         resolved_by = p_actor_id, resolved_at = now()
   where order_id = p_order_id and status = 'abierto';

  update public.orders set status = 'reembolsado', closed_at = now() where id = p_order_id;

  perform public.log_order_event(p_order_id, p_actor_id, p_actor_role, 'reembolso', v_order.status, 'reembolsado',
    p_note, jsonb_build_object('proveedor', p_provider, 'ref', p_provider_ref, 'importe_cents', p_amount_cents));
  return 'reembolsado';
end;
$$;

create or replace function public.sys_record_payout(
  p_order_id uuid, p_provider text, p_provider_ref text, p_amount_cents bigint,
  p_raw jsonb, p_actor_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Orden inexistente';
  end if;
  if v_order.status <> 'confirmado' then
    raise exception 'Solo se liquidan órdenes confirmadas (estado actual: %)', v_order.status;
  end if;
  if p_amount_cents <> v_order.seller_net_cents then
    raise exception 'El importe liquidado debe ser el neto del vendedor';
  end if;

  insert into public.payment_transactions (order_id, provider, kind, provider_ref, status, amount_cents, raw)
  values (p_order_id, p_provider, 'liquidacion', p_provider_ref, 'aprobado', p_amount_cents, coalesce(p_raw, '{}'::jsonb))
  on conflict (provider, kind, provider_ref) do nothing;

  update public.orders set status = 'liquidado', closed_at = now() where id = p_order_id;

  perform public.log_order_event(p_order_id, p_actor_id, case when p_actor_id is null then 'sistema' else 'admin' end,
    'liquidacion', 'confirmado', 'liquidado', null,
    jsonb_build_object('proveedor', p_provider, 'ref', p_provider_ref, 'neto_vendedor_cents', p_amount_cents,
                       'comision_cents', v_order.commission_cents));
  return 'liquidado';
end;
$$;

create or replace function public.sys_auto_confirm()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select id from public.orders
     where status = 'entregado' and auto_confirm_at is not null and auto_confirm_at <= now()
     for update skip locked
  loop
    update public.orders set status = 'confirmado', confirmed_at = now() where id = v_row.id;
    perform public.log_order_event(v_row.id, null, 'sistema', 'confirmacion_automatica', 'entregado', 'confirmado',
      'Venció la ventana de reclamo sin objeciones del comprador', '{}'::jsonb);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.sys_expire_pending()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_minutes integer;
  v_count integer := 0;
begin
  select pending_payment_minutes into v_minutes from public.platform_settings where id;
  for v_row in
    select id, listing_id, quantity from public.orders
     where status = 'pendiente_pago' and created_at < now() - make_interval(mins => v_minutes)
     for update skip locked
  loop
    update public.orders set status = 'cancelado', closed_at = now() where id = v_row.id;
    update public.listings set stock = stock + v_row.quantity where id = v_row.listing_id;
    perform public.log_order_event(v_row.id, null, 'sistema', 'vencimiento_pago', 'pendiente_pago', 'cancelado',
      'La orden venció sin pago confirmado', '{}'::jsonb);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ───────────────────────────── Permisos ──────────────────────────────
-- Supabase otorga EXECUTE a anon/authenticated por defecto: lo quitamos donde corresponde.
revoke execute on function public.log_order_event(uuid, uuid, text, text, public.order_status, public.order_status, text, jsonb) from public, anon, authenticated;
revoke execute on function public.sys_confirm_payment(uuid, text, text, bigint, text, bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.sys_record_refund(uuid, text, text, bigint, jsonb, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.sys_record_payout(uuid, text, text, bigint, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.sys_auto_confirm() from public, anon, authenticated;
revoke execute on function public.sys_expire_pending() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.sys_confirm_payment(uuid, text, text, bigint, text, bigint, jsonb) to service_role;
grant execute on function public.sys_record_refund(uuid, text, text, bigint, jsonb, uuid, text, text) to service_role;
grant execute on function public.sys_record_payout(uuid, text, text, bigint, jsonb, uuid) to service_role;
grant execute on function public.sys_auto_confirm() to service_role;
grant execute on function public.sys_expire_pending() to service_role;

revoke execute on function public.create_order(uuid, integer, text) from public, anon;
revoke execute on function public.order_action(uuid, text, text, text) from public, anon;
revoke execute on function public.activate_seller() from public, anon;
grant execute on function public.create_order(uuid, integer, text) to authenticated;
grant execute on function public.order_action(uuid, text, text, text) to authenticated;
grant execute on function public.activate_seller() to authenticated;

-- Los clientes no escriben directamente en tablas sensibles (además de RLS).
revoke insert, update, delete on public.orders, public.order_events, public.payment_transactions,
  public.webhook_events, public.sim_payments, public.sim_payouts, public.disputes,
  public.delivery_evidence, public.platform_settings from anon, authenticated;
revoke all on public.sim_payments, public.sim_payouts, public.webhook_events from anon, authenticated;

-- ───────────────────── Storage: evidencias de entrega ─────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias', 'evidencias', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Ruta: <order_id>/<archivo>. Sube el vendedor de la orden; leen participantes y admins.
create policy "evidencias alta vendedor" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidencias'
    and exists (select 1 from public.orders o
                 where o.id::text = (storage.foldername(name))[1]
                   and o.seller_id = auth.uid()
                   and o.status in ('pago_confirmado', 'entrega_en_curso')));

create policy "evidencias lectura participantes" on storage.objects for select to authenticated
  using (
    bucket_id = 'evidencias'
    and (public.is_admin() or exists (select 1 from public.orders o
                 where o.id::text = (storage.foldername(name))[1]
                   and auth.uid() in (o.buyer_id, o.seller_id))));
