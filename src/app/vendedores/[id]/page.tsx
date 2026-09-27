import Link from "next/link";
import { notFound } from "next/navigation";
import { startChat } from "@/app/actions/social";
import { LotList } from "@/components/lot-list";
import { Avatar, Stars } from "@/components/seller-badge";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState, formatDate } from "@/components/ui";
import { getSessionProfile } from "@/lib/auth";
import { getRatings, LOT_SELECT, type LotRow } from "@/lib/catalog";
import { isOnline, lastSeenLabel } from "@/lib/lu4";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(props: PageProps<"/vendedores/[id]">) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {};
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("display_name").eq("id", id).maybeSingle();
  return { title: data?.display_name ?? "Vendedor" };
}

export default async function SellerProfilePage(props: PageProps<"/vendedores/[id]">) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("id, display_name, created_at, last_seen_at, is_seller").eq("id", id).maybeSingle();
  if (!profile) notFound();

  const [session, ratings, lotsRes, reviewsRes] = await Promise.all([
    getSessionProfile(),
    getRatings([id]),
    supabase.from("listings").select(LOT_SELECT).eq("seller_id", id).eq("status", "activa").gt("stock", 0).order("created_at", { ascending: false }).limit(50),
    supabase.from("reviews").select("id, rating, body, created_at, buyer:profiles!reviews_buyer_id_fkey(display_name)").eq("seller_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  const rating = ratings[id];
  const lots = (lotsRes.data ?? []) as unknown as LotRow[];
  const reviews = (reviewsRes.data ?? []) as unknown as { id: number; rating: number; body: string; created_at: string; buyer: { display_name: string } | null }[];
  const online = isOnline(profile.last_seen_at);

  return (
    <div className="space-y-8">
      <section className="card animate-fade-up relative overflow-hidden">
        <span className="absolute -top-20 -right-10 h-48 w-48 rounded-full bg-gold/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <Avatar name={profile.display_name} size={72} online={online} />
          <div className="min-w-0 flex-1">
            <h1 className="h1 truncate">{profile.display_name}</h1>
            <p className={`text-sm ${online ? "text-ok" : "text-muted"}`}>{lastSeenLabel(profile.last_seen_at)}</p>
            <p className="mt-1 text-sm text-muted">
              {rating ? <><Stars value={rating.rating_avg} /> {rating.rating_avg.toFixed(1)} · {rating.reviews_count} reseñas</> : "Sin reseñas todavía"}
              {" · "}En Argenpay desde {formatDate(profile.created_at).split(" ")[0]}
            </p>
          </div>
          {session && session.userId !== id && (
            <form action={startChat}>
              <input type="hidden" name="user_id" value={id} />
              <SubmitButton className="btn-primary shine" pendingText="Abriendo…">💬 Enviar mensaje</SubmitButton>
            </form>
          )}
          {!session && <Link href={`/ingresar?siguiente=/vendedores/${id}`} className="btn-ghost">Ingresá para escribirle</Link>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="h2 text-xl">Lotes activos</h2>
        {lots.length ? <LotList lots={lots} ratings={ratings} /> : <EmptyState title="No tiene lotes activos" />}
      </section>

      <section className="space-y-3">
        <h2 className="h2 text-xl">Reseñas</h2>
        {reviews.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {reviews.map((r, i) => (
              <li key={r.id} className="card animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.buyer?.display_name}</span>
                  <Stars value={r.rating} />
                </div>
                {r.body && <p className="mt-2 text-sm text-ink/90">{r.body}</p>}
                <p className="mt-2 text-xs text-muted">{formatDate(r.created_at)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Todavía no tiene reseñas.</p>
        )}
      </section>
    </div>
  );
}
