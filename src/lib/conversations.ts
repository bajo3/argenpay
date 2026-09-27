import "server-only";
import type { ChatMessage } from "@/components/chat-box";
import { createClient } from "@/lib/supabase/server";

export interface ConversationRow {
  id: string;
  user_low: string;
  user_high: string;
  listing_id: string | null;
  last_message_at: string;
  last_message_preview: string;
  low_last_read_at: string;
  high_last_read_at: string;
}

export interface ConversationView extends ConversationRow {
  other: { id: string; display_name: string; last_seen_at: string | null; avatar_url: string | null; created_at: string } | null;
  unread: boolean;
}

/** Conversaciones del usuario (RLS), con el otro participante y estado de lectura. */
export async function listConversations(me: string): Promise<ConversationView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("id, user_low, user_high, listing_id, last_message_at, last_message_preview, low_last_read_at, high_last_read_at")
    .or(`user_low.eq.${me},user_high.eq.${me}`)
    .order("last_message_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as ConversationRow[];
  const otherIds = rows.map((c) => (c.user_low === me ? c.user_high : c.user_low));
  const { data: profiles } = otherIds.length
    ? await supabase.from("profiles").select("id, display_name, last_seen_at, avatar_url, created_at").in("id", otherIds)
    : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return rows.map((c) => {
    const otherId = c.user_low === me ? c.user_high : c.user_low;
    const myRead = c.user_low === me ? c.low_last_read_at : c.high_last_read_at;
    return { ...c, other: byId.get(otherId) ?? null, unread: new Date(c.last_message_at) > new Date(myRead) };
  });
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversation_messages")
    .select("id, sender_id, kind, body, order_id, listing_id, created_at")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: false })
    .limit(200);
  return ((data ?? []) as ChatMessage[]).reverse();
}

/** Conversación entre dos usuarios (si existe). */
export async function findConversation(a: string, b: string): Promise<string | null> {
  const [low, high] = a < b ? [a, b] : [b, a];
  const supabase = await createClient();
  const { data } = await supabase.from("conversations").select("id").eq("user_low", low).eq("user_high", high).maybeSingle();
  return data?.id ?? null;
}
