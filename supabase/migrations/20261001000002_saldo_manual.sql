-- Saldo en modo manual: el usuario carga saldo transfiriendo (pesos al CVU, USDT/USDC, Binance Pay),
-- avisa con el comprobante y un administrador lo acredita. Con ese saldo paga órdenes; al confirmarse
-- la orden, el neto va al saldo del vendedor, que lo retira. Todo se contabiliza en pesos (centavos):
-- el USD es solo una forma de mostrar los importes con la cotización del dólar cripto.

alter table public.orders drop constraint if exists orders_paid_with_check;
alter table public.orders add constraint orders_paid_with_check check (paid_with in ('saldo', 'procesador', 'transferencia'));

-- ── Cotización ──
alter table public.manual_payment_settings
  add column if not exists usd_rate_auto boolean not null default true,
  add column if not exists usd_rate_updated_at timestamptz;

-- ── Avisos de carga de saldo (misma tabla que los avisos de pago de órdenes) ──
alter table public.manual_payments
  alter column order_id drop not null,
  add column purpose text not null default 'orden' check (purpose in ('orden', 'carga')),
  -- Carga: lo que el usuario dice que envió, y los pesos a acreditar (estimados al avisar; el admin los ajusta).
  add column declared_amount numeric(30, 8) check (declared_amount is null or declared_amount > 0),
  add column declared_currency text check (declared_currency is null or declared_currency in ('ARS', 'USDT', 'USDC', 'BTC')),
  add column amount_cents bigint check (amount_cents is null or amount_cents > 0),
  add column usd_rate_cents bigint,
  add column credited_cents bigint;
alter table public.manual_payments add constraint manual_payments_purpose_target_check
  check ((purpose = 'orden' and order_id is not null) or (purpose = 'carga' and order_id is null and declared_amount is not null and declared_currency is not null));

create or replace function public.report_topup(
  p_method text, p_currency text, p_amount numeric, p_reference text,
  p_payer_name text default null, p_note text default null, p_proof_path text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ref text := trim(coalesce(p_reference, ''));
  v_rate bigint;
  v_cents bigint;
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Ingresá el importe que enviaste';
  end if;
  if char_length(v_ref) < 4 then
    raise exception 'Ingresá el TXID o el número de comprobante (mínimo 4 caracteres)';
  end if;
  if (select count(*) from public.manual_payments where buyer_id = v_uid and purpose = 'carga' and status = 'pendiente') >= 3 then
    raise exception 'Tenés 3 cargas esperando verificación. Esperá a que las revisemos.';
  end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> v_uid::text then
    raise exception 'Comprobante inválido';
  end if;

  select usd_rate_cents into v_rate from public.manual_payment_settings where id;
  v_cents := case upper(p_currency)
    when 'ARS' then round(p_amount * 100)
    when 'USDT' then case when v_rate is not null then round(p_amount * v_rate) end
    when 'USDC' then case when v_rate is not null then round(p_amount * v_rate) end
    else null end; -- BTC: lo calcula el administrador al acreditar.
  if upper(p_currency) = 'ARS' and v_cents < 100 then
    raise exception 'La carga mínima es de $ 1,00';
  end if;

  begin
    insert into public.manual_payments (order_id, buyer_id, purpose, method, reference, payer_name, note, proof_path,
                                        declared_amount, declared_currency, amount_cents, usd_rate_cents)
    values (null, v_uid, 'carga', p_method, v_ref, nullif(trim(coalesce(p_payer_name, '')), ''),
            nullif(trim(coalesce(p_note, '')), ''), p_proof_path, p_amount, upper(p_currency), v_cents,
            case when upper(p_currency) in ('USDT', 'USDC') then v_rate end)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Esa referencia ya fue informada en otro pago';
  end;
  return v_id;
end;
$$;

-- Revisión de avisos (órdenes y cargas). En cargas el administrador puede ajustar los pesos a acreditar.
drop function if exists public.sys_review_manual_payment(bigint, boolean, uuid, text);
create or replace function public.sys_review_manual_payment(
  p_payment_id bigint, p_approve boolean, p_admin_id uuid, p_note text default null, p_credit_cents bigint default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.manual_payments%rowtype;
  v_order public.orders%rowtype;
  v_result text;
  v_credit bigint;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_pay from public.manual_payments where id = p_payment_id for update;
  if not found then
    raise exception 'Aviso de pago inexistente';
  end if;
  if v_pay.status <> 'pendiente' then
    raise exception 'Este aviso ya fue revisado';
  end if;

  -- ── Carga de saldo ──
  if v_pay.purpose = 'carga' then
    if p_approve then
      v_credit := coalesce(p_credit_cents, v_pay.amount_cents);
      if v_credit is null or v_credit < 100 then
        raise exception 'Indicá cuántos pesos acreditar';
      end if;
      v_result := public.sys_credit_deposit(v_pay.buyer_id, v_credit, 'manual', v_pay.method || ':' || lower(v_pay.reference));
      if v_result = 'duplicado' then
        raise exception 'Esa referencia ya se acreditó en otra carga';
      end if;
      update public.manual_payments
         set status = 'aprobado', credited_cents = v_credit, reviewed_by = p_admin_id, reviewed_at = now(), admin_note = v_note
       where id = p_payment_id;
      return 'acreditado';
    end if;
    if v_note is null then
      raise exception 'Indicá el motivo del rechazo';
    end if;
    update public.manual_payments
       set status = 'rechazado', reviewed_by = p_admin_id, reviewed_at = now(), admin_note = v_note
     where id = p_payment_id;
    return 'rechazado';
  end if;

  -- ── Pago directo de una orden ──
  select * into v_order from public.orders where id = v_pay.order_id for update;
  if p_approve then
    v_result := public.sys_confirm_payment(v_order.id, 'manual', v_pay.method || ':' || v_pay.reference,
      v_order.price_cents, v_order.currency, null,
      jsonb_build_object('manual', true, 'metodo', v_pay.method, 'referencia', v_pay.reference,
                         'pagador', v_pay.payer_name, 'aviso_id', v_pay.id, 'admin', p_admin_id));
    if v_result = 'duplicado' then
      raise exception 'Esa referencia ya fue usada para confirmar otro pago';
    elsif v_result <> 'confirmado' then
      raise exception 'No se pudo confirmar (%). Si la orden ya no está pendiente de pago, rechazá el aviso y acreditá el importe como carga de saldo.', v_result;
    end if;
    update public.orders set paid_with = 'transferencia' where id = v_order.id;
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

-- ── Saldo disponible también en modo manual ──
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
               where seller_id = auth.uid() and payment_mode in ('simulado', 'manual')
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
  perform 1 from public.profiles where id = v_uid for update;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.buyer_id <> v_uid then
    raise exception 'Solo el comprador puede pagar esta orden' using errcode = '42501';
  end if;
  if v_order.status <> 'pendiente_pago' then
    raise exception 'La orden no está pendiente de pago';
  end if;
  if v_order.payment_mode not in ('simulado', 'manual') then
    raise exception 'El pago con saldo no está disponible para esta orden';
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

-- Reembolso al saldo del comprador: órdenes pagadas con saldo o con transferencia verificada.
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
  if not found or not (v_order.paid_with is not distinct from 'saldo' or v_order.payment_provider = 'manual') then
    raise exception 'La orden no fue pagada con saldo ni por transferencia verificada';
  end if;
  insert into public.wallet_entries (user_id, amount_cents, kind, order_id, note)
  values (v_order.buyer_id, v_order.price_cents, 'reembolso', v_order.id, format('Reembolso · orden #%s', v_order.code))
  on conflict do nothing;
  return public.sys_record_refund(v_order.id, coalesce(v_order.payment_provider, 'saldo'), 'saldo-reembolso:' || v_order.id,
    v_order.price_cents, '{}'::jsonb, p_actor_id, p_actor_role, p_note);
end;
$$;

-- Al confirmarse una orden (simulada o manual), el neto va al saldo del vendedor.
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
  if v_order.status <> 'confirmado' or v_order.payment_mode not in ('simulado', 'manual') then
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

drop trigger if exists orders_settle_to_wallet on public.orders;
create constraint trigger orders_settle_to_wallet
  after update of status on public.orders
  deferrable initially deferred
  for each row
  when (new.status = 'confirmado' and new.payment_mode in ('simulado', 'manual'))
  execute function public.settle_confirmed_order();

-- ── Cruce de ingresos de Binance también con cargas de saldo ──
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
    -- Binance no dice quién transfirió: solo se cruza si hay UN único aviso pendiente por ese importe exacto.
    select count(*) into v_n from public.manual_payments m left join public.orders o on o.id = m.order_id
     where m.status = 'pendiente' and m.method in ('cvu', 'otro')
       and coalesce(o.price_cents, m.amount_cents) = round(p_amount * 100)
       and m.created_at between p_occurred_at - interval '3 days' and p_occurred_at + interval '3 days'
       and not exists (select 1 from public.incoming_deposits d where d.matched_payment_id = m.id);
    if v_n = 1 then
      select m.id, m.order_id into v_match, v_order from public.manual_payments m left join public.orders o on o.id = m.order_id
       where m.status = 'pendiente' and m.method in ('cvu', 'otro')
         and coalesce(o.price_cents, m.amount_cents) = round(p_amount * 100)
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
    if new.order_id is not null then
      select price_cents into v_price from public.orders where id = new.order_id;
    else
      v_price := new.amount_cents;
    end if;
    if v_price is not null then
      select count(*) into v_n from public.incoming_deposits d
       where d.matched_payment_id is null and d.source = 'pesos' and d.asset = 'ARS'
         and round(d.amount * 100) = v_price and d.occurred_at > now() - interval '3 days';
      if v_n = 1 then
        select d.id into v_dep from public.incoming_deposits d
         where d.matched_payment_id is null and d.source = 'pesos' and d.asset = 'ARS'
           and round(d.amount * 100) = v_price and d.occurred_at > now() - interval '3 days';
      end if;
    end if;
  end if;
  if v_dep is not null then
    update public.incoming_deposits set matched_payment_id = new.id where id = v_dep;
  end if;
  return new;
end;
$$;

revoke execute on function public.report_topup(text, text, numeric, text, text, text, text) from public, anon;
grant execute on function public.report_topup(text, text, numeric, text, text, text, text) to authenticated;
revoke execute on function public.sys_review_manual_payment(bigint, boolean, uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.sys_review_manual_payment(bigint, boolean, uuid, text, bigint) to service_role;
revoke execute on function public.settle_confirmed_order() from public, anon, authenticated;
revoke execute on function public.sys_refund_to_wallet(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.sys_refund_to_wallet(uuid, uuid, text, text) to service_role;
