-- Vista previa de conversaciones: los mensajes que solo tienen una imagen muestran "📷 Imagen".
create or replace function public.on_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = left(coalesce(nullif(trim(new.body), ''), '📷 Imagen'), 140),
         low_last_read_at = case when new.sender_id = user_low then new.created_at else low_last_read_at end,
         high_last_read_at = case when new.sender_id = user_high then new.created_at else high_last_read_at end,
         listing_id = coalesce(new.listing_id, listing_id)
   where id = new.conversation_id;
  return new;
end;
$$;
