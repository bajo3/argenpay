-- Ingresos detectados en Binance (lectura con API key de solo lectura). Sirven para avisar al titular
-- en cuanto entra dinero y para marcar qué aviso de pago de un comprador coincide. NO confirman órdenes:
-- la confirmación sigue siendo una acción del administrador.

create table public.incoming_deposits (
  id bigint generated always as identity primary key,
  source_key text not null unique,
  source text not null check (source in ('cripto', 'pesos', 'binance_pay')),
  asset text not null,
  amount numeric(30, 8) not null check (amount > 0),
  network text,
  tx_id text,
  payer text,
  occurred_at timestamptz not null,
  matched_payment_id bigint unique references public.manual_payments (id),
  raw jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now()
);
create index incoming_deposits_occurred_idx on public.incoming_deposits (occurred_at desc);

alter table public.incoming_deposits enable row level security;
create policy "ingresos solo admin" on public.incoming_deposits for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.incoming_deposits from anon, authenticated;
revoke select on public.incoming_deposits from anon;
create trigger incoming_deposits_no_delete before delete on public.incoming_deposits
  for each row execute function public.forbid_delete();

-- Estado del lector (última lectura correcta / último error), para mostrarlo en Administración.
create table public.deposit_watch_state (
  id boolean primary key default true check (id),
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text
);
insert into public.deposit_watch_state (id) values (true);
alter table public.deposit_watch_state enable row level security;
create policy "estado lector solo admin" on public.deposit_watch_state for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.deposit_watch_state from anon, authenticated;

-- Registra un ingreso (idempotente por source_key) y lo cruza con un aviso de pago pendiente.
-- Devuelve: nuevo (si recién se detectó) y el aviso que coincide (si hay).
create or replace function public.sys_record_deposit(
  p_source_key text, p_source text, p_asset text, p_amount numeric, p_network text,
  p_tx_id text, p_payer text, p_occurred_at timestamptz, p_raw jsonb)
returns table (is_new boolean, deposit_id bigint, matched_payment_id bigint, matched_order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_match bigint;
  v_order uuid;
  v_n integer;
begin
  insert into public.incoming_deposits (source_key, source, asset, amount, network, tx_id, payer, occurred_at, raw)
  values (p_source_key, p_source, upper(p_asset), p_amount, p_network, nullif(trim(p_tx_id), ''), p_payer, p_occurred_at, coalesce(p_raw, '{}'::jsonb))
  on conflict (source_key) do nothing
  returning id into v_id;

  if v_id is null then
    return query select false, d.id, d.matched_payment_id, m.order_id
      from public.incoming_deposits d left join public.manual_payments m on m.id = d.matched_payment_id
     where d.source_key = p_source_key;
    return;
  end if;

  -- Cripto / Binance Pay: el TXID o ID de operación que informó el comprador coincide exactamente.
  if p_source = 'cripto' and nullif(trim(p_tx_id), '') is not null then
    select m.id, m.order_id into v_match, v_order from public.manual_payments m
     where m.status = 'pendiente' and m.method in ('usdt', 'usdc', 'btc', 'otro')
       and lower(trim(m.reference)) = lower(trim(p_tx_id))
       and not exists (select 1 from public.incoming_deposits d where d.matched_payment_id = m.id)
     order by m.id limit 1;
  elsif p_source = 'binance_pay' then
    select m.id, m.order_id into v_match, v_order from public.manual_payments m
     where m.status = 'pendiente' and m.method in ('binance_pay', 'otro')
       and lower(trim(m.reference)) in (lower(trim(coalesce(p_tx_id, ''))), lower(coalesce(p_raw ->> 'orderId', '')))
       and not exists (select 1 from public.incoming_deposits d where d.matched_payment_id = m.id)
     order by m.id limit 1;
  elsif p_source = 'pesos' and upper(p_asset) = 'ARS' then
    -- En pesos Binance no dice quién transfirió: solo se cruza si hay UN único aviso pendiente por ese importe exacto.
    select count(*) into v_n from public.manual_payments m join public.orders o on o.id = m.order_id
     where m.status = 'pendiente' and m.method in ('cvu', 'otro')
       and o.price_cents = round(p_amount * 100)
       and m.created_at between p_occurred_at - interval '3 days' and p_occurred_at + interval '3 days'
       and not exists (select 1 from public.incoming_deposits d where d.matched_payment_id = m.id);
    if v_n = 1 then
      select m.id, m.order_id into v_match, v_order from public.manual_payments m join public.orders o on o.id = m.order_id
       where m.status = 'pendiente' and m.method in ('cvu', 'otro')
         and o.price_cents = round(p_amount * 100)
         and m.created_at between p_occurred_at - interval '3 days' and p_occurred_at + interval '3 days'
         and not exists (select 1 from public.incoming_deposits d where d.matched_payment_id = m.id);
    end if;
  end if;

  if v_match is not null then
    update public.incoming_deposits set matched_payment_id = v_match where id = v_id;
  end if;
  return query select true, v_id, v_match, v_order;
end;
$$;

-- Si el comprador avisa DESPUÉS de que el dinero ya entró, el cruce se hace al avisar.
create or replace function public.match_deposit_on_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dep bigint;
  v_price bigint;
  v_n integer;
begin
  if new.method in ('usdt', 'usdc', 'btc', 'binance_pay', 'otro') then
    select d.id into v_dep from public.incoming_deposits d
     where d.matched_payment_id is null and d.source in ('cripto', 'binance_pay')
       and (lower(trim(d.tx_id)) = lower(trim(new.reference)) or lower(coalesce(d.raw ->> 'orderId', '')) = lower(trim(new.reference)))
     order by d.id limit 1;
  end if;
  if v_dep is null and new.method in ('cvu', 'otro') then
    select price_cents into v_price from public.orders where id = new.order_id;
    select count(*) into v_n from public.incoming_deposits d
     where d.matched_payment_id is null and d.source = 'pesos' and d.asset = 'ARS'
       and round(d.amount * 100) = v_price and d.occurred_at > now() - interval '3 days';
    if v_n = 1 then
      select d.id into v_dep from public.incoming_deposits d
       where d.matched_payment_id is null and d.source = 'pesos' and d.asset = 'ARS'
         and round(d.amount * 100) = v_price and d.occurred_at > now() - interval '3 days';
    end if;
  end if;
  if v_dep is not null then
    update public.incoming_deposits set matched_payment_id = new.id where id = v_dep;
  end if;
  return new;
end;
$$;

create trigger manual_payments_match_deposit after insert on public.manual_payments
  for each row execute function public.match_deposit_on_report();

create or replace function public.sys_deposit_watch_status(p_ok boolean, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.deposit_watch_state
     set last_run_at = now(),
         -- p_ok null = solo marca el inicio de una lectura (evita lecturas superpuestas).
         last_ok_at = case when p_ok then now() else last_ok_at end,
         last_error = case when p_ok is null then last_error when p_ok then null else left(p_error, 500) end
   where id;
$$;

revoke execute on function public.sys_record_deposit(text, text, text, numeric, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.sys_record_deposit(text, text, text, numeric, text, text, text, timestamptz, jsonb) to service_role;
revoke execute on function public.sys_deposit_watch_status(boolean, text) from public, anon, authenticated;
grant execute on function public.sys_deposit_watch_status(boolean, text) to service_role;
revoke execute on function public.match_deposit_on_report() from public, anon, authenticated;

-- Los administradores reciben cada ingreso al instante (alarma en pantalla).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'incoming_deposits') then
    alter publication supabase_realtime add table public.incoming_deposits;
  end if;
end;
$$;
