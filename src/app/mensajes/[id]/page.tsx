import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatBox } from "@/components/chat-box";
import { InboxList } from "@/components/inbox-list";
import { Avatar, Stars } from "@/components/seller-badge";
import { Flash, formatDate, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getRatings } from "@/lib/catalog";
import { getMessages, listConversations } from "@/lib/conversations";
import { isOnline, lastSeenLabel } from "@/lib/lu4";

import { relativeTime } from "@/lib/orders/list";
import type { OrderStatus } from "@/lib/orders/state-machine";
import { createClient } from "@/lib/supabase/server";
import { Money } from "@/components/money";

export const metadata: Metadata = { title: "Mensajes" };

export default async function ConversationPage(props: PageProps<"/mensajes/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await requireUser(`/mensajes/${id}`);

  const supabase = await createClient();
  const [conversations, convRes] = await Promise.all([
    listConversations(s.userId),
    supabase.from("conversations").select("id, user_low, user_high, listing_id").eq("id", id).maybeSingle(),
  ]);
  const conv = convRes.data;
  if (!conv) notFound(); // RLS: solo participantes o admins

  const participantIds = [conv.user_low, conv.user_high];
  const otherId = conv.user_low === s.userId ? conv.user_high : conv.user_low;
  const loteParam = typeof sp.lote === "string" && /^[0-9a-f-]{36}$/i.test(sp.lote) ? sp.lote : null;

  const [messages, profilesRes, ordersRes, listingRes, ratings] = await Promise.all([
    getMessages(id),
    supabase.from("profiles").select("id, display_name, last_seen_at, avatar_url, created_at").in("id", participantIds),
    supabase
      .from("orders")
      .select("id, code, status, price_cents, listing_snapshot, created_at")
      .in("buyer_id", participantIds)
      .in("seller_id", participantIds)
      .order("created_at", { ascending: false })
      .limit(6),
    loteParam || conv.listing_id
      ? supabase.from("listings").select("id, title").eq("id", loteParam ?? conv.listing_id).maybeSingle()
      : Promise.resolve({ data: null }),
    getRatings([otherId]),
  ]);
  const profiles = profilesRes.data ?? [];
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.display_name]));
  const other = profiles.find((p) => p.id === otherId);
  const orders = (ordersRes.data ?? []) as { id: string; code: string; status: OrderStatus; price_cents: number; listing_snapshot: { title?: string }; created_at: string }[];
  const online = isOnline(other?.last_seen_at);
  const rating = ratings[otherId];

  return (
    <div className="space-y-4">
      <Flash error={sp.error} ok={sp.ok} />
      <div className="relative left-1/2 grid h-[calc(100dvh-11rem)] min-h-[500px] w-[min(calc(100vw-2rem),90rem)] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface/80 lg:h-[calc(100dvh-9rem)] lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_270px]">
        {/* Conversaciones */}
        <aside className="hidden min-h-0 overflow-y-auto border-r border-line lg:block">
          <p className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-4 font-display text-xl font-bold backdrop-blur">Mensajes</p>
          <InboxList conversations={conversations} activeId={id} />
        </aside>

        {/* Chat */}
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Link href="/mensajes" className="btn-ghost px-3 py-2 lg:hidden" aria-label="Volver">←</Link>
            {other && (
              <Link href={`/vendedores/${other.id}`} className="flex min-w-0 items-center gap-3 hover:text-gold-2">
                <Avatar name={other.display_name} url={other.avatar_url} size={44} online={online} />
                <span className="min-w-0">
                  <span className="block truncate font-display text-lg font-bold">{other.display_name}</span>
                  <span className={`text-xs ${online ? "text-ok" : "text-muted"}`}>{lastSeenLabel(other.last_seen_at)}</span>
                </span>
              </Link>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <ChatBox
              fill
              conversationId={id}
              me={s.userId}
              names={names}
              initial={messages}
              listingHint={listingRes.data ? { id: listingRes.data.id, title: listingRes.data.title } : null}
            />
          </div>
        </section>

        {/* Info del otro usuario */}
        <aside className="hidden min-h-0 space-y-5 overflow-y-auto border-l border-line p-5 text-sm xl:block">
          {other && (
            <>
              <div>
                <p className="text-[11px] font-semibold tracking-widest text-muted uppercase">Registro</p>
                <p className="mt-1">{formatDate(other.created_at).split(" ")[0]}</p>
                <p className="text-xs text-muted">{relativeTime(other.created_at)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold tracking-widest text-muted uppercase">Reputación</p>
                {rating ? (
                  <p className="mt-1"><Stars value={rating.rating_avg} /> {rating.rating_avg.toFixed(1)} <span className="text-muted">({rating.reviews_count})</span></p>
                ) : (
                  <p className="mt-1 text-muted">Sin reseñas</p>
                )}
                <Link href={`/vendedores/${other.id}`} className="mt-1 inline-block text-xs text-gold hover:text-gold-2">Ver perfil y reseñas →</Link>
              </div>
            </>
          )}
          {orders.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold tracking-widest text-muted uppercase">Órdenes entre ustedes</p>
              <ul className="mt-2 space-y-2">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/ordenes/${o.id}`} className="block rounded-xl border border-line bg-bg-2/60 p-2.5 transition hover:border-gold/40">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-gold">#{o.code}</span>
                        <span className="text-xs font-semibold"><Money cents={Number(o.price_cents)} /></span>
                      </span>
                      <span className="mt-1 block truncate text-xs">{o.listing_snapshot.title}</span>
                      <span className="mt-1.5 block"><StatusBadge status={o.status} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
