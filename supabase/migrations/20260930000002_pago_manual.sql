-- Pago manual: el comprador transfiere a los datos de cobro de Argenpay (CVU/QR, Binance, cripto),
-- avisa con la referencia/TXID y un administrador verifica a mano antes de confirmar la orden.
-- La confirmación reutiliza sys_confirm_payment (proveedor 'manual'), así que el frontend nunca marca pagos.

-- ── Modo de pago 'manual' ──
alter table public.orders drop constraint orders_payment_mode_check;
alter table public.orders add constraint orders_payment_mode_check check (payment_mode in ('simulado', 'real', 'manual'));

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
  if p_payment_mode not in ('simulado', 'real', 'manual') then
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

-- ── Datos de cobro (fila única). Se leen para mostrarlos al comprador; solo el servidor los escribe. ──
-- Los valores iniciales son GENÉRICOS a propósito: hasta que un administrador cargue los reales y marque
-- "configured", el sitio muestra un aviso de "datos de ejemplo" y no hay que transferir nada.
create table public.manual_payment_settings (
  id boolean primary key default true check (id),
  configured boolean not null default false,
  holder_name text not null default 'TITULAR DE EJEMPLO' check (char_length(holder_name) <= 120),
  bank_name text not null default 'Banco / billetera de ejemplo' check (char_length(bank_name) <= 80),
  cvu text not null default '0000000000000000000000' check (char_length(cvu) <= 40),
  alias text not null default 'ejemplo.alias.argenpay' check (char_length(alias) <= 40),
  cuit text not null default '00-00000000-0' check (char_length(cuit) <= 20),
  qr_path text check (qr_path is null or char_length(qr_path) <= 200),
  binance_pay_id text not null default '00000000' check (char_length(binance_pay_id) <= 40),
  binance_email text not null default '' check (char_length(binance_email) <= 120),
  -- [{ "asset": "USDT", "network": "TRC20", "address": "…" }]
  crypto_wallets jsonb not null default '[
    {"asset":"USDT","network":"TRC20","address":"REEMPLAZAR-DIRECCION-USDT-TRC20"},
    {"asset":"USDC","network":"BEP20","address":"REEMPLAZAR-DIRECCION-USDC-BEP20"},
    {"asset":"BTC","network":"Bitcoin","address":"REEMPLAZAR-DIRECCION-BTC"}
  ]'::jsonb check (jsonb_typeof(crypto_wallets) = 'array' and jsonb_array_length(crypto_wallets) <= 12),
  -- Cotización de referencia para mostrar el equivalente en USDT/USDC (ARS por 1 USD, en centavos).
  usd_rate_cents bigint check (usd_rate_cents is null or usd_rate_cents > 0),
  instructions text not null default '' check (char_length(instructions) <= 1500),
  updated_at timestamptz not null default now()
);
insert into public.manual_payment_settings (id) values (true);

alter table public.manual_payment_settings enable row level security;
create policy "datos de cobro lectura" on public.manual_payment_settings for select to authenticated using (true);
revoke insert, update, delete on public.manual_payment_settings from anon, authenticated;
revoke select on public.manual_payment_settings from anon;

-- ── Avisos de pago que envía el comprador ──
create table public.manual_payments (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id),
  buyer_id uuid not null references public.profiles (id),
  method text not null check (method in ('cvu', 'binance_pay', 'usdt', 'usdc', 'btc', 'otro')),
  reference text not null check (char_length(reference) between 4 and 200),
  payer_name text check (payer_name is null or char_length(payer_name) <= 120),
  note text check (note is null or char_length(note) <= 500),
  proof_path text check (proof_path is null or char_length(proof_path) <= 200),
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobado', 'rechazado')),
  admin_note text,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index manual_payments_order_idx on public.manual_payments (order_id, id);
create index manual_payments_pending_idx on public.manual_payments (created_at) where status = 'pendiente';
-- Una referencia (TXID / nº de comprobante) no puede usarse en dos avisos vigentes: frena reusar un mismo pago.
create unique index manual_payments_reference_uniq on public.manual_payments (method, lower(reference)) where status <> 'rechazado';

alter table public.manual_payments enable row level security;
create policy "avisos de pago lectura" on public.manual_payments for select to authenticated
  using (buyer_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.manual_payments from anon, authenticated;
revoke select on public.manual_payments from anon;
create trigger manual_payments_no_delete before delete on public.manual_payments
  for each row execute function public.forbid_delete();

-- El comprador avisa que pagó. No cambia el estado de la orden: la confirma un administrador.
create or replace function public.report_manual_payment(
  p_order_id uuid, p_method text, p_reference text, p_payer_name text default null,
  p_note text default null, p_proof_path text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_ref text := trim(coalesce(p_reference, ''));
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.buyer_id <> v_uid then
    raise exception 'Orden inexistente';
  end if;
  if v_order.payment_mode <> 'manual' then
    raise exception 'Esta orden no se paga por transferencia manual';
  end if;
  if v_order.status <> 'pendiente_pago' then
    raise exception 'La orden ya no está pendiente de pago';
  end if;
  if char_length(v_ref) < 4 then
    raise exception 'Ingresá el TXID o el número de comprobante (mínimo 4 caracteres)';
  end if;
  if exists (select 1 from public.manual_payments where order_id = p_order_id and status = 'pendiente') then
    raise exception 'Ya avisaste este pago: estamos verificándolo';
  end if;
  if (select count(*) from public.manual_payments where order_id = p_order_id) >= 5 then
    raise exception 'Superaste el máximo de avisos para esta orden. Escribile a soporte.';
  end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> v_uid::text then
    raise exception 'Comprobante inválido';
  end if;

  begin
    insert into public.manual_payments (order_id, buyer_id, method, reference, payer_name, note, proof_path)
    values (p_order_id, v_uid, p_method, v_ref, nullif(trim(coalesce(p_payer_name, '')), ''),
            nullif(trim(coalesce(p_note, '')), ''), p_proof_path)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Esa referencia ya fue informada en otro pago';
  end;

  perform public.log_order_event(p_order_id, v_uid, 'comprador', 'pago_informado', v_order.status, v_order.status,
    'El comprador avisó el pago por ' || p_method || '. Pendiente de verificación.',
    jsonb_build_object('metodo', p_method, 'aviso_id', v_id));
  return v_id;
end;
$$;

-- Un administrador aprueba o rechaza el aviso (lo ejecuta el servidor con service_role).
create or replace function public.sys_review_manual_payment(
  p_payment_id bigint, p_approve boolean, p_admin_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.manual_payments%rowtype;
  v_order public.orders%rowtype;
  v_result text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_pay from public.manual_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Aviso de pago inexistente';
  end if;
  if v_pay.status <> 'pendiente' then
    raise exception 'Este aviso ya fue revisado';
  end if;
  select * into v_order from public.orders where id = v_pay.order_id for update;

  if p_approve then
    v_result := public.sys_confirm_payment(v_order.id, 'manual', v_pay.method || ':' || v_pay.reference,
      v_order.price_cents, v_order.currency, null,
      jsonb_build_object('manual', true, 'metodo', v_pay.method, 'referencia', v_pay.reference,
                         'pagador', v_pay.payer_name, 'aviso_id', v_pay.id, 'admin', p_admin_id));
    if v_result = 'duplicado' then
      raise exception 'Esa referencia ya fue usada para confirmar otro pago';
    elsif v_result <> 'confirmado' then
      raise exception 'No se pudo confirmar (%). Si la orden ya no está pendiente de pago, rechazá el aviso y devolvé el dinero por fuera.', v_result;
    end if;
    update public.manual_payments
       set status = 'aprobado', reviewed_by = p_admin_id, reviewed_at = now(), admin_note = v_note
     where id = p_payment_id;
  else
    if v_note is null then
      raise exception 'Indicá el motivo del rechazo';
    end if;
    update public.manual_payments
       set status = 'rechazado', reviewed_by = p_admin_id, reviewed_at = now(), admin_note = v_note
     where id = p_payment_id;
    perform public.log_order_event(v_order.id, p_admin_id, 'admin', 'pago_rechazado', v_order.status, v_order.status,
      'No se pudo verificar el pago: ' || v_note, jsonb_build_object('aviso_id', p_payment_id));
    -- Aviso en el chat de la orden para que el comprador se entere sin entrar a la orden.
    insert into public.conversation_messages (conversation_id, sender_id, kind, body, order_id)
    values (public.ensure_conversation(v_order.buyer_id, v_order.seller_id, v_order.listing_id), null, 'sistema',
            format('Orden #%s: no pudimos verificar tu pago (%s). Revisá los datos y volvé a avisar desde la orden.',
                   upper(left(v_order.id::text, 8)), left(v_note, 200)),
            v_order.id);
    v_result := 'rechazado';
  end if;
  return v_result;
end;
$$;

-- Un aviso pendiente frena el vencimiento de la orden (la verificación manual puede demorar).
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
    select id, listing_id, quantity from public.orders o
     where status = 'pendiente_pago' and created_at < now() - make_interval(mins => v_minutes)
       and not exists (select 1 from public.manual_payments m where m.order_id = o.id and m.status = 'pendiente')
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

revoke execute on function public.report_manual_payment(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.report_manual_payment(uuid, text, text, text, text, text) to authenticated;
revoke execute on function public.sys_review_manual_payment(bigint, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.sys_review_manual_payment(bigint, boolean, uuid, text) to service_role;
revoke execute on function public.sys_expire_pending() from public, anon, authenticated;
grant execute on function public.sys_expire_pending() to service_role;

-- Los avisos nuevos llegan a los administradores en vivo (RLS: solo ven los suyos y los admins todos).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'manual_payments') then
    alter publication supabase_realtime add table public.manual_payments;
  end if;
end;
$$;

-- ── Storage ──
-- QR de cobro: público (es el mismo QR que se le muestra a cualquier comprador); solo admins lo cambian.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cobro', 'cobro', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
create policy "cobro alta admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'cobro' and public.is_admin());
create policy "cobro baja admin" on storage.objects for delete to authenticated
  using (bucket_id = 'cobro' and public.is_admin());

-- Comprobantes del comprador: privados. Ruta <buyer_id>/<order_id>/<archivo>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy "comprobantes alta comprador" on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "comprobantes lectura" on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
