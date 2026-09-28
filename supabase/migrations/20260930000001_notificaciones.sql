-- Notificaciones en vivo:
--  · Las reseñas (y la respuesta del vendedor) se avisan con un mensaje de sistema en el chat del par,
--    igual que los eventos de las órdenes, así llegan a la campana de mensajes y como aviso en pantalla.
--  · Los movimientos de saldo se publican por Realtime (RLS: cada usuario recibe solo los suyos),
--    para que el saldo del encabezado se actualice sin recargar la página.

create or replace function public.notify_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_buyer text;
  v_text text;
  v_conv uuid;
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select display_name into v_buyer from public.profiles where id = new.buyer_id;
    v_text := format('Orden #%s: %s dejó una reseña de %s (%s/5)%s', v_order.code, coalesce(v_buyer, 'El comprador'),
      repeat('★', new.rating), new.rating,
      case when nullif(trim(new.body), '') is null then '.' else format(': «%s»', left(trim(new.body), 300)) end);
  elsif tg_op = 'UPDATE' and old.seller_reply is null and new.seller_reply is not null then
    v_text := format('Orden #%s: el vendedor respondió tu reseña: «%s»', v_order.code, left(new.seller_reply, 300));
  else
    return new;
  end if;

  v_conv := public.ensure_conversation(v_order.buyer_id, v_order.seller_id, v_order.listing_id);
  insert into public.conversation_messages (conversation_id, sender_id, kind, body, order_id)
  values (v_conv, null, 'sistema', v_text, v_order.id);
  return new;
end;
$$;

revoke execute on function public.notify_review() from public, anon, authenticated;

create trigger reviews_notify_insert after insert on public.reviews
  for each row execute function public.notify_review();
create trigger reviews_notify_reply after update of seller_reply on public.reviews
  for each row execute function public.notify_review();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wallet_entries') then
    alter publication supabase_realtime add table public.wallet_entries;
  end if;
end;
$$;
