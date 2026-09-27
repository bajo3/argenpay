import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatBox } from "@/components/chat-box";
import { InboxList } from "@/components/inbox-list";
import { Avatar } from "@/components/seller-badge";
import { Flash, formatDate, shortId, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getMessages, listConversations } from "@/lib/conversations";
import { isOnline, lastSeenLabel } from "@/lib/lu4";
import type { OrderStatus } from "@/lib/orders/state-machine";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Chat" };

export default async function ConversationPage(props: PageProps<"/mensajes/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await requireUser(`/mensajes/${id}`);

  const conversations = await listConversations(s.userId);
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, user_low, user_high, listing_id")
    .eq("id", id)
    .maybeSingle();
  if (!conv) notFound(); // RLS: solo participantes o admins

  const participantIds = [conv.user_low, conv.user_high];
  const otherId = conv.user_low === s.userId ? conv.user_high : conv.user_low;
  const loteParam = typeof sp.lote === "string" && /^[0-9a-f-]{36}$/i.test(sp.lote) ? sp.lote : null;

  const [messages, profilesRes, ordersRes, listingRes] = await Promise.all([
    getMessages(id),
    supabase.from("profiles").select("id, display_name, last_seen_at").in("id", participantIds),
    supabase
      .from("orders")
      .select("id, status, price_cents, quantity, listing_snapshot, created_at")
      .in("buyer_id", participantIds)
      .in("seller_id", participantIds)
      .order("created_at", { ascending: false })
      .limit(5),
    loteParam || conv.listing_id
      ? supabase.from("listings").select("id, title").eq("id", loteParam ?? conv.listing_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const profiles = profilesRes.data ?? [];
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.display_name]));
  const other = profiles.find((p) => p.id === otherId);
  const orders = (ordersRes.data ?? []) as { id: string; status: OrderStatus; quantity: number; listing_snapshot: { title?: string; unit_plural?: string }; created_at: string }[];
  const online = isOnline(other?.last_seen_at);

  return (
    <div className="space-y-4">
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="hidden max-h-[75vh] overflow-y-auto rounded-2xl border border-line bg-surface/80 lg:block">
          <p className="border-b border-line px-4 py-3 font-display font-semibold">Conversaciones</p>
          <InboxList conversations={conversations} activeId={id} />
        </aside>

        <section className="min-w-0 space-y-3">
          <div className="flex items-center gap-3">
            <Link href="/mensajes" className="btn-ghost px-3 py-2 lg:hidden" aria-label="Volver">←</Link>
            {other && (
              <Link href={`/vendedores/${other.id}`} className="flex min-w-0 items-center gap-3 hover:text-gold-2">
                <Avatar name={other.display_name} size={42} online={online} />
                <span className="min-w-0">
                  <span className="block truncate font-display text-lg font-bold">{other.display_name}</span>
                  <span className={`text-xs ${online ? "text-ok" : "text-muted"}`}>{lastSeenLabel(other.last_seen_at)}</span>
                </span>
              </Link>
            )}
          </div>

          {orders.length > 0 && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {orders.map((o) => (
                <Link key={o.id} href={`/ordenes/${o.id}`} className="card card-hover flex shrink-0 items-center gap-3 px-3 py-2">
                  <span className="font-mono text-xs text-muted">{shortId(o.id)}</span>
                  <span className="max-w-40 truncate text-sm">{o.listing_snapshot.title}</span>
                  <StatusBadge status={o.status} />
                  <span className="hidden text-xs text-muted sm:inline">{formatDate(o.created_at)}</span>
                </Link>
              ))}
            </div>
          )}

          <ChatBox
            conversationId={id}
            me={s.userId}
            names={names}
            initial={messages}
            listingHint={listingRes.data ? { id: listingRes.data.id, title: listingRes.data.title } : null}
          />
        </section>
      </div>
    </div>
  );
}
