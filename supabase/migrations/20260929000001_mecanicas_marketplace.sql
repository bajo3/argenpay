-- Argenpay · mecánicas de marketplace entre jugadores:
-- entrega automática, subir ofertas, categorías Coins y Otros, equipo del personaje e imágenes en el chat.

-- ───────────────────────────── Categorías ──────────────────────────────
insert into public.categories (slug, name, sort_order, unit_label, unit_label_plural, description) values
  ('coins', 'Coins', 15, 'coin', 'coins', 'Moneda de donación del servidor.'),
  ('otros', 'Otros', 50, 'unidad', 'unidades', 'Todo lo que no entra en las demás categorías.')
on conflict (slug) do update set
  name = excluded.name, sort_order = excluded.sort_order, unit_label = excluded.unit_label,
  unit_label_plural = excluded.unit_label_plural, description = excluded.description;
update public.categories set name = 'Boosting y servicios' where slug = 'servicios';

-- ─────────────────────────── Publicaciones ───────────────────────────
alter table public.listings
  add column if not exists char_equipment text check (char_equipment in ('desnudo', 'equipado')),
  add column if not exists auto_delivery boolean not null default false,
  add column if not exists bumped_at timestamptz not null default now();
create index if not exists listings_bumped_idx on public.listings (category_id, bumped_at desc) where status = 'activa';

-- Nadie cambia bumped_at editando la fila: solo "Subir ofertas" (con límite de tiempo).
create or replace function public.guard_listing_bump()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.bumped_at := now();
    elsif new.bumped_at is distinct from old.bumped_at then
      raise exception 'Usá "Subir ofertas" para destacar tus publicaciones' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger listings_guard_bump before insert or update on public.listings
  for each row execute function public.guard_listing_bump();

create or replace function public.bump_listings(p_category_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_last timestamptz;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión' using errcode = '42501';
  end if;
  select max(bumped_at) into v_last from public.listings
   where seller_id = v_uid and category_id = p_category_id and status = 'activa';
  if v_last is null then
    raise exception 'No tenés ofertas activas en esa categoría';
  end if;
  if v_last > now() - interval '4 hours' then
    raise exception 'Podés volver a subir estas ofertas a las % (hora de Argentina)',
      to_char((v_last + interval '4 hours') at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI');
  end if;
  update public.listings set bumped_at = now()
   where seller_id = v_uid and category_id = p_category_id and status = 'activa';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─────────────────────────── Entrega automática ───────────────────────────
-- El vendedor carga ítems (códigos, datos de cuenta, etc.). Al confirmarse el pago, se asignan a la
-- orden y el comprador los ve en ella. Solo el vendedor ve los que no se entregaron.
create table public.listing_delivery_items (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings (id) on delete cascade,
  seller_id uuid not null references public.profiles (id),
  content text not null check (char_length(content) between 1 and 2000),
  order_id uuid references public.orders (id),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index listing_delivery_items_available_idx on public.listing_delivery_items (listing_id, id) where order_id is null;
create index listing_delivery_items_order_idx on public.listing_delivery_items (order_id) where order_id is not null;

alter table public.listing_delivery_items enable row level security;
create policy "entrega automatica lectura" on public.listing_delivery_items for select using (
  seller_id = auth.uid()
  or public.is_admin()
  or (order_id is not null and exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid()))
);
revoke insert, update, delete on public.listing_delivery_items from anon, authenticated;

create or replace function public.add_delivery_items(p_listing_id uuid, p_items text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.listings%rowtype;
  v_count integer;
begin
  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found or v_listing.seller_id is distinct from auth.uid() then
    raise exception 'Solo el vendedor puede cargar la entrega automática' using errcode = '42501';
  end if;
  insert into public.listing_delivery_items (listing_id, seller_id, content)
  select v_listing.id, v_listing.seller_id, trim(item)
    from unnest(coalesce(p_items, '{}')) as item
   where char_length(trim(item)) between 1 and 2000;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Cargá al menos un ítem para entregar (uno por línea)';
  end if;
  update public.listings set stock = stock + v_count, auto_delivery = true where id = v_listing.id;
  return v_count;
end;
$$;

create or replace function public.remove_delivery_item(p_item_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.listing_delivery_items%rowtype;
begin
  select * into v_item from public.listing_delivery_items where id = p_item_id for update;
  if not found or v_item.seller_id is distinct from auth.uid() then
    raise exception 'Ítem inexistente' using errcode = '42501';
  end if;
  if v_item.order_id is not null then
    raise exception 'Ese ítem ya fue entregado';
  end if;
  delete from public.listing_delivery_items where id = p_item_id;
  update public.listings set stock = greatest(stock - 1, 0) where id = v_item.listing_id;
end;
$$;

-- Al quedar pagada, la orden se entrega sola si la publicación tiene entrega automática.
create or replace function public.auto_deliver_paid_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_auto boolean;
  v_count integer;
  v_hours integer;
begin
  select * into v_order from public.orders where id = new.id for update;
  if v_order.status <> 'pago_confirmado' then
    return null;
  end if;
  select auto_delivery into v_auto from public.listings where id = v_order.listing_id;
  if not coalesce(v_auto, false) then
    return null;
  end if;

  update public.listing_delivery_items
     set order_id = v_order.id, delivered_at = now()
   where id in (
     select id from public.listing_delivery_items
      where listing_id = v_order.listing_id and order_id is null
      order by id
      limit v_order.quantity
      for update skip locked);
  get diagnostics v_count = row_count;

  if v_count < v_order.quantity then
    perform public.log_order_event(v_order.id, null, 'sistema', 'entrega_automatica_incompleta', v_order.status, v_order.status,
      format('Se entregaron automáticamente %s de %s. El vendedor debe completar la entrega.', v_count, v_order.quantity), '{}'::jsonb);
    return null;
  end if;

  insert into public.delivery_evidence (order_id, seller_id, description)
  values (v_order.id, v_order.seller_id, 'Entrega automática: el contenido está disponible para el comprador en esta orden.');
  select auto_confirm_hours into v_hours from public.platform_settings where id;
  update public.orders
     set status = 'entregado', delivered_at = now(), auto_confirm_at = now() + make_interval(hours => v_hours)
   where id = v_order.id;
  perform public.log_order_event(v_order.id, null, 'sistema', 'marcar_entregado', 'pago_confirmado', 'entregado',
    'Entrega automática', '{}'::jsonb);
  return null;
end;
$$;

create constraint trigger orders_auto_deliver
  after update of status on public.orders
  deferrable initially deferred
  for each row
  when (new.status = 'pago_confirmado')
  execute function public.auto_deliver_paid_order();

-- ───────────────────────── Imágenes en el chat ─────────────────────────
alter table public.conversation_messages add column if not exists attachment_path text;
alter table public.conversation_messages drop constraint if exists conversation_messages_body_check;
alter table public.conversation_messages add constraint conversation_messages_body_check check (
  char_length(body) <= 2000
  and (char_length(trim(body)) >= 1 or attachment_path is not null)
);
alter table public.conversation_messages add constraint conversation_messages_attachment_check check (
  attachment_path is null or split_part(attachment_path, '/', 1) = conversation_id::text
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "chat adjuntos alta" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat'
    and exists (select 1 from public.conversations c
                 where c.id::text = (storage.foldername(name))[1]
                   and auth.uid() in (c.user_low, c.user_high)));

create policy "chat adjuntos lectura" on storage.objects for select to authenticated
  using (
    bucket_id = 'chat'
    and (public.is_admin() or exists (select 1 from public.conversations c
                 where c.id::text = (storage.foldername(name))[1]
                   and auth.uid() in (c.user_low, c.user_high))));

-- ───────────────────────────── Permisos ──────────────────────────────
revoke execute on function public.auto_deliver_paid_order() from public, anon, authenticated;
revoke execute on function public.bump_listings(uuid) from public, anon;
revoke execute on function public.add_delivery_items(uuid, text[]) from public, anon;
revoke execute on function public.remove_delivery_item(bigint) from public, anon;
grant execute on function public.bump_listings(uuid) to authenticated;
grant execute on function public.add_delivery_items(uuid, text[]) to authenticated;
grant execute on function public.remove_delivery_item(bigint) to authenticated;
