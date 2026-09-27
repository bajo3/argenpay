-- Argenpay · saldo (billetera), fotos de perfil, reseñas con respuesta y búsqueda de órdenes.
--
-- SALDO: solo para órdenes en modo 'simulado'. Custodiar dinero de terceros requiere habilitación
-- del procesador y asesoría legal (ver docs/decision-pagos.md). La base impide usar el saldo con
-- órdenes 'real'.
--
-- Flujo simulado: el comprador paga (con saldo o con el procesador) → el vendedor entrega → el
-- comprador confirma → el neto se acredita automáticamente en el saldo del vendedor (orden liquidada)
-- → el vendedor pide un retiro → un administrador lo procesa.

-- ───────────────────────────── Avatares ──────────────────────────────
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add constraint profiles_avatar_url_check check (
  avatar_url is null or (
    avatar_url ~ '^https?://'
    and char_length(avatar_url) <= 500
    and position(('/storage/v1/object/public/avatares/' || id::text || '/') in avatar_url) > 0
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "avatares lectura" on storage.objects for select using (bucket_id = 'avatares');
create policy "avatares alta propia" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatares edicion propia" on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatares borrado propio" on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

-- ────────────────────── Reseñas: respuesta del vendedor ──────────────────────
alter table public.reviews
  add column if not exists seller_reply text check (seller_reply is null or char_length(seller_reply) between 1 and 1000),
  add column if not exists seller_reply_at timestamptz;

drop trigger if exists reviews_immutable on public.reviews;

create or replace function public.guard_review_update()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las reseñas no se pueden borrar' using errcode = '42501';
  end if;
  if (new.order_id, new.seller_id, new.buyer_id, new.rating, new.body, new.created_at)
     is distinct from (old.order_id, old.seller_id, old.buyer_id, old.rating, old.body, old.created_at) then
    raise exception 'La reseña no se puede modificar' using errcode = '42501';
  end if;
  if old.seller_reply is not null then
    raise exception 'Ya respondiste esta reseña' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger reviews_guard before update or delete on public.reviews
  for each row execute function public.guard_review_update();

create or replace function public.reply_review(p_review_id bigint, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews%rowtype;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
begin
  select * into v_review from public.reviews where id = p_review_id for update;
  if not found or v_review.seller_id is distinct from auth.uid() then
    raise exception 'Solo el vendedor puede responder esta reseña' using errcode = '42501';
  end if;
  if v_body is null then
    raise exception 'Escribí una respuesta';
  end if;
  update public.reviews set seller_reply = left(v_body, 1000), seller_reply_at = now() where id = p_review_id;
end;
$$;

create or replace view public.seller_ratings
with (security_invoker = true) as
  select seller_id,
         count(*)::integer as reviews_count,
         round(avg(rating)::numeric, 2) as rating_avg,
         count(*) filter (where rating = 5)::integer as r5,
         count(*) filter (where rating = 4)::integer as r4,
         count(*) filter (where rating = 3)::integer as r3,
         count(*) filter (where rating = 2)::integer as r2,
         count(*) filter (where rating = 1)::integer as r1
    from public.reviews
   group by seller_id;

-- ─────────────────────── Órdenes: código y medio de pago ───────────────────────
alter table public.orders
  add column if not exists code text generated always as (upper(left(id::text, 8))) stored,
  add column if not exists paid_with text check (paid_with in ('saldo', 'procesador'));
create index if not exists orders_code_idx on public.orders (code);

-- ─────────────────────────────── Saldo ───────────────────────────────
create table public.wallet_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents <> 0),
  kind text not null check (kind in ('carga', 'compra', 'venta', 'reembolso', 'retiro', 'retiro_rechazado', 'ajuste')),
  order_id uuid references public.orders (id),
  withdrawal_id uuid,
  ref text,
  note text,
  created_at timestamptz not null default now()
);
create index wallet_entries_user_idx on public.wallet_entries (user_id, id desc);
-- Idempotencia: un movimiento de cada tipo por orden / retiro / referencia externa.
create unique index wallet_entries_order_kind_uq on public.wallet_entries (kind, order_id) where order_id is not null;
create unique index wallet_entries_withdrawal_kind_uq on public.wallet_entries (kind, withdrawal_id) where withdrawal_id is not null;
create unique index wallet_entries_ref_kind_uq on public.wallet_entries (kind, ref) where ref is not null;

create trigger wallet_entries_immutable before update or delete on public.wallet_entries
  for each row execute function public.forbid_mutation();

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  amount_cents bigint not null check (amount_cents >= 100),
  status text not null default 'pendiente' check (status in ('pendiente', 'pagado', 'rechazado')),
  destination jsonb not null,
  admin_note text,
  provider_ref text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.profiles (id)
);
create index withdrawals_user_idx on public.withdrawals (user_id, created_at desc);
create index withdrawals_status_idx on public.withdrawals (status, created_at);

alter table public.wallet_entries add constraint wallet_entries_withdrawal_fk
  foreign key (withdrawal_id) references public.withdrawals (id);

alter table public.wallet_entries enable row level security;
alter table public.withdrawals enable row level security;
create policy "saldo propio" on public.wallet_entries for select using (user_id = auth.uid() or public.is_admin());
create policy "retiros propios" on public.withdrawals for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.wallet_entries, public.withdrawals from anon, authenticated;

-- Pagos simulados de carga de saldo
alter table public.sim_payments alter column order_id drop not null;
alter table public.sim_payments
  add column if not exists user_id uuid references public.profiles (id),
  add column if not exists purpose text not null default 'orden' check (purpose in ('orden', 'carga'));
alter table public.sim_payments add constraint sim_payments_purpose_target_check
  check ((purpose = 'orden' and order_id is not null) or (purpose = 'carga' and user_id is not null and order_id is null));

create or replace function public.wallet_available(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.wallet_entries where user_id = p_user;
$$;

-- Resumen del saldo del usuario actual.
create or replace function public.my_wallet()
returns table (available_cents bigint, pending_sales_cents bigint, pending_withdrawals_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.wallet_available(auth.uid()),
    coalesce((select sum(seller_net_cents) from public.orders
               where seller_id = auth.uid() and payment_mode = 'simulado'
                 and status in ('pago_confirmado', 'entrega_en_curso', 'entregado', 'en_reclamo', 'confirmado')), 0)::bigint,
    coalesce((select sum(amount_cents) from public.withdrawals where user_id = auth.uid() and status = 'pendiente'), 0)::bigint;
$$;

create or replace function public.pay_order_with_balance(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión' using errcode = '42501';
  end if;
  -- Serializa los movimientos de saldo del usuario.
  perform 1 from public.profiles where id = v_uid for update;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.buyer_id <> v_uid then
    raise exception 'Solo el comprador puede pagar esta orden' using errcode = '42501';
  end if;
  if v_order.status <> 'pendiente_pago' then
    raise exception 'La orden no está pendiente de pago';
  end if;
  if v_order.payment_mode <> 'simulado' then
    raise exception 'El pago con saldo solo está disponible en el entorno simulado';
  end if;
  if public.wallet_available(v_uid) < v_order.price_cents then
    raise exception 'Saldo insuficiente';
  end if;

  insert into public.wallet_entries (user_id, amount_cents, kind, order_id, note)
  values (v_uid, -v_order.price_cents, 'compra', v_order.id, format('Compra · orden #%s', v_order.code));
  insert into public.payment_transactions (order_id, provider, kind, provider_ref, status, amount_cents)
  values (v_order.id, 'saldo', 'cobro', 'saldo:' || v_order.id, 'aprobado', v_order.price_cents);
  update public.orders
     set status = 'pago_confirmado', paid_at = now(), payment_provider = 'saldo', paid_with = 'saldo',
         delivery_due_at = now() + make_interval(hours => v_order.delivery_time_hours)
   where id = v_order.id;
  perform public.log_order_event(v_order.id, v_uid, 'comprador', 'pago_confirmado', 'pendiente_pago', 'pago_confirmado',
    'Pagado con saldo de Argenpay', '{}'::jsonb);
end;
$$;

-- Reembolso de una orden pagada con saldo: vuelve al saldo del comprador.
create or replace function public.sys_refund_to_wallet(p_order_id uuid, p_actor_id uuid, p_actor_role text, p_note text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.paid_with is distinct from 'saldo' then
    raise exception 'La orden no fue pagada con saldo';
  end if;
  insert into public.wallet_entries (user_id, amount_cents, kind, order_id, note)
  values (v_order.buyer_id, v_order.price_cents, 'reembolso', v_order.id, format('Reembolso · orden #%s', v_order.code))
  on conflict do nothing;
  return public.sys_record_refund(v_order.id, 'saldo', 'saldo-reembolso:' || v_order.id, v_order.price_cents,
    '{}'::jsonb, p_actor_id, p_actor_role, p_note);
end;
$$;

-- Acreditación de una carga de saldo verificada con el procesador.
create or replace function public.sys_credit_deposit(p_user uuid, p_amount_cents bigint, p_provider text, p_ref text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_amount_cents is null or p_amount_cents < 100 then
    raise exception 'Importe de carga inválido';
  end if;
  insert into public.wallet_entries (user_id, amount_cents, kind, ref, note)
  values (p_user, p_amount_cents, 'carga', p_provider || ':' || p_ref, 'Carga de saldo')
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return case when v_rows = 0 then 'duplicado' else 'acreditado' end;
end;
$$;

-- Liquidación automática al saldo del vendedor cuando una orden simulada queda confirmada.
-- Es un trigger diferido: corre al final de la transacción, después de registrar la confirmación.
create or replace function public.settle_confirmed_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = new.id for update;
  if v_order.status <> 'confirmado' or v_order.payment_mode <> 'simulado' then
    return null;
  end if;
  insert into public.wallet_entries (user_id, amount_cents, kind, order_id, note)
  values (v_order.seller_id, v_order.seller_net_cents, 'venta', v_order.id,
          format('Venta · orden #%s (neto después de la comisión)', v_order.code))
  on conflict do nothing;
  perform public.sys_record_payout(v_order.id, 'saldo', 'saldo:' || v_order.id, v_order.seller_net_cents, '{}'::jsonb, null);
  return null;
end;
$$;

create constraint trigger orders_settle_to_wallet
  after update of status on public.orders
  deferrable initially deferred
  for each row
  when (new.status = 'confirmado' and new.payment_mode = 'simulado')
  execute function public.settle_confirmed_order();

-- Retiros
create or replace function public.request_withdrawal(p_amount_cents bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account public.seller_payout_accounts%rowtype;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents < 100 then
    raise exception 'El retiro mínimo es de $ 1,00';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  select * into v_account from public.seller_payout_accounts where seller_id = v_uid;
  if not found then
    raise exception 'Cargá tus datos de cobro (CBU/CVU o alias) en Mi cuenta antes de retirar';
  end if;
  if public.wallet_available(v_uid) < p_amount_cents then
    raise exception 'Saldo insuficiente';
  end if;
  insert into public.withdrawals (user_id, amount_cents, destination)
  values (v_uid, p_amount_cents, jsonb_build_object(
    'holder_name', v_account.holder_name, 'tax_id', v_account.tax_id, 'cbu_or_alias', v_account.cbu_or_alias))
  returning id into v_id;
  insert into public.wallet_entries (user_id, amount_cents, kind, withdrawal_id, note)
  values (v_uid, -p_amount_cents, 'retiro', v_id, 'Retiro solicitado');
  return v_id;
end;
$$;

create or replace function public.sys_process_withdrawal(
  p_withdrawal_id uuid, p_approve boolean, p_provider_ref text, p_note text, p_admin_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.withdrawals%rowtype;
begin
  select * into v_w from public.withdrawals where id = p_withdrawal_id for update;
  if not found then
    raise exception 'Retiro inexistente';
  end if;
  if v_w.status <> 'pendiente' then
    return 'ya_procesado';
  end if;
  if p_approve then
    update public.withdrawals
       set status = 'pagado', provider_ref = p_provider_ref, admin_note = p_note, processed_at = now(), processed_by = p_admin_id
     where id = v_w.id;
    return 'pagado';
  end if;
  update public.withdrawals
     set status = 'rechazado', admin_note = p_note, processed_at = now(), processed_by = p_admin_id
   where id = v_w.id;
  insert into public.wallet_entries (user_id, amount_cents, kind, withdrawal_id, note)
  values (v_w.user_id, v_w.amount_cents, 'retiro_rechazado', v_w.id, coalesce('Retiro rechazado: ' || p_note, 'Retiro rechazado'));
  return 'rechazado';
end;
$$;

-- ───────────────────────────── Permisos ──────────────────────────────
revoke execute on function public.wallet_available(uuid) from public, anon, authenticated;
revoke execute on function public.settle_confirmed_order() from public, anon, authenticated;
revoke execute on function public.sys_refund_to_wallet(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.sys_credit_deposit(uuid, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.sys_process_withdrawal(uuid, boolean, text, text, uuid) from public, anon, authenticated;
grant execute on function public.sys_refund_to_wallet(uuid, uuid, text, text) to service_role;
grant execute on function public.sys_credit_deposit(uuid, bigint, text, text) to service_role;
grant execute on function public.sys_process_withdrawal(uuid, boolean, text, text, uuid) to service_role;
grant execute on function public.wallet_available(uuid) to service_role;

revoke execute on function public.my_wallet() from public, anon;
revoke execute on function public.pay_order_with_balance(uuid) from public, anon;
revoke execute on function public.request_withdrawal(bigint) from public, anon;
revoke execute on function public.reply_review(bigint, text) from public, anon;
grant execute on function public.my_wallet() to authenticated;
grant execute on function public.pay_order_with_balance(uuid) to authenticated;
grant execute on function public.request_withdrawal(bigint) to authenticated;
grant execute on function public.reply_review(bigint, text) to authenticated;
