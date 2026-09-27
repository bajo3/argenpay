import Link from "next/link";
import { notFound } from "next/navigation";
import { replyReview, startChat } from "@/app/actions/social";
import { LotList } from "@/components/lot-list";
import { Avatar, Stars } from "@/components/seller-badge";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState, Flash, formatDate } from "@/components/ui";
import { getSessionProfile } from "@/lib/auth";
import { getRatings, LOT_SELECT, type LotRow } from "@/lib/catalog";
import { isOnline, lastSeenLabel } from "@/lib/lu4";
import { relativeTime } from "@/lib/orders/list";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(props: PageProps<"/vendedores/[id]">) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {};
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("display_name").eq("id", id).maybeSingle();
  return { title: data?.display_name ?? "Vendedor" };
}

interface ReviewRow {
  id: number; rating: number; body: string; created_at: string; seller_reply: string | null; seller_reply_at: string | null;
  buyer: { display_name: string; avatar_url: string | null } | null;
  order: { listing_snapshot: { title?: string; server?: string | null; category?: string } } | null;
}

export default async function SellerProfilePage(props: PageProps<"/vendedores/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const stars = Number(sp.estrellas) || null;
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("id, display_name, created_at, last_seen_at, is_seller, avatar_url").eq("id", id).maybeSingle();
  if (!profile) notFound();

  let reviewsQ = supabase
    .from("reviews")
    .select("id, rating, body, created_at, seller_reply, seller_reply_at, buyer:profiles!reviews_buyer_id_fkey(display_name, avatar_url), order:orders(listing_snapshot)")
    .eq("seller_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (stars && stars >= 1 && stars <= 5) reviewsQ = reviewsQ.eq("rating", stars);

  const [session, ratings, lotsRes, reviewsRes] = await Promise.all([
    getSessionProfile(),
    getRatings([id]),
    supabase.from("listings").select(LOT_SELECT).eq("seller_id", id).eq("status", "activa").gt("stock", 0).order("created_at", { ascending: false }).limit(50),
    reviewsQ,
  ]);
  const rating = ratings[id];
  const lots = (lotsRes.data ?? []) as unknown as LotRow[];
  const reviews = (reviewsRes.data ?? []) as unknown as ReviewRow[];
  const online = isOnline(profile.last_seen_at);
  const isMe = session?.userId === id;
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: Number(rating?.[`r${n}` as "r5"] ?? 0) }));
  const max = Math.max(1, ...dist.map((d) => d.count));

  return (
    <div className="space-y-8">
      <Flash error={sp.error} ok={sp.ok} />
      <section className="card animate-fade-up relative overflow-hidden p-6">
        <span className="absolute -top-20 -right-10 h-56 w-56 rounded-full bg-gold/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <Avatar name={profile.display_name} url={profile.avatar_url} size={88} online={online} />
          <div className="min-w-0 flex-1">
            <h1 className="h1 truncate">{profile.display_name}</h1>
            <p className={`text-sm ${online ? "text-ok" : "text-muted"}`}>{lastSeenLabel(profile.last_seen_at)}</p>
            <p className="mt-1 text-sm text-muted">En Argenpay desde {formatDate(profile.created_at).split(" ")[0]} ({relativeTime(profile.created_at)})</p>
          </div>
          {session && !isMe && (
            <form action={startChat}>
              <input type="hidden" name="user_id" value={id} />
              <SubmitButton className="btn-primary shine" pendingText="Abriendo…">💬 Enviar mensaje</SubmitButton>
            </form>
          )}
          {isMe && <Link href="/cuenta" className="btn-ghost">Editar perfil</Link>}
          {!session && <Link href={`/ingresar?siguiente=/vendedores/${id}`} className="btn-ghost">Ingresá para escribirle</Link>}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="card animate-fade-up h-fit">
          <p className="text-sm text-muted">Calificación</p>
          <p className="font-display text-5xl font-bold text-gold-2">{rating ? rating.rating_avg.toFixed(1) : "—"}</p>
          {rating && <Stars value={rating.rating_avg} size="text-lg" />}
          <p className="mt-1 text-sm text-muted">{rating?.reviews_count ?? 0} reseñas</p>
          <ul className="mt-4 space-y-1.5">
            {dist.map((d) => (
              <li key={d.n}>
                <Link href={stars === d.n ? `/vendedores/${id}` : `/vendedores/${id}?estrellas=${d.n}#resenas`} className={`flex items-center gap-2 rounded-lg px-1 text-sm hover:bg-white/5 ${stars === d.n ? "bg-gold/10" : ""}`}>
                  <span className="w-6 text-muted">{d.n}★</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg-2">
                    <span className="block h-full rounded-full bg-gradient-to-r from-gold to-gold-2 transition-all" style={{ width: `${(d.count / max) * 100}%` }} />
                  </span>
                  <span className="w-8 text-right text-xs text-muted">{d.count}</span>
                </Link>
              </li>
            ))}
          </ul>
          {stars && <Link href={`/vendedores/${id}`} className="mt-3 inline-block text-xs text-gold">Ver todas</Link>}
        </div>

        <div id="resenas" className="space-y-3">
          <h2 className="h2 text-xl">Reseñas{stars ? ` de ${stars} estrellas` : ""}</h2>
          {reviews.length ? (
            <ul className="space-y-3">
              {reviews.map((r, i) => (
                <li key={r.id} className="card animate-fade-up" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
                  <div className="flex items-start gap-3">
                    <Avatar name={r.buyer?.display_name ?? "?"} url={r.buyer?.avatar_url} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{r.buyer?.display_name}</span>
                        <span className="text-xs text-muted">{relativeTime(r.created_at)}</span>
                      </div>
                      <Stars value={r.rating} />
                      {r.order?.listing_snapshot && (
                        <p className="text-xs text-muted">{r.order.listing_snapshot.server ?? "Todos"} · {r.order.listing_snapshot.category} · {r.order.listing_snapshot.title}</p>
                      )}
                      {r.body && <p className="mt-2 text-sm text-ink/90">{r.body}</p>}
                      {r.seller_reply ? (
                        <div className="mt-3 rounded-xl border-l-2 border-gold/60 bg-bg-2/60 p-3 text-sm">
                          <p className="text-xs font-semibold text-gold-2">Respuesta de {profile.display_name}</p>
                          <p className="mt-1 text-ink/90">{r.seller_reply}</p>
                        </div>
                      ) : isMe ? (
                        <form action={replyReview} className="mt-3 flex gap-2">
                          <input type="hidden" name="review_id" value={r.id} />
                          <input type="hidden" name="back" value={`/vendedores/${id}`} />
                          <input name="body" required maxLength={1000} className="input" placeholder="Responder esta reseña" />
                          <SubmitButton className="btn-ghost shrink-0">Responder</SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card text-sm text-muted">{stars ? "No hay reseñas con esa calificación." : "Todavía no tiene reseñas."}</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="h2 text-xl">Ofertas activas</h2>
        {lots.length ? <LotList lots={lots} ratings={ratings} /> : <EmptyState title="No tiene ofertas activas" />}
      </section>
    </div>
  );
}
