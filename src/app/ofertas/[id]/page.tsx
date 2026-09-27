import Link from "next/link";
import { notFound } from "next/navigation";
import { startChat } from "@/app/actions/social";
import { BuyBox } from "@/components/buy-box";
import { deliveryLabel } from "@/components/lot-list";
import { PurchaseSteps } from "@/components/purchase-copy";
import { Avatar, Stars } from "@/components/seller-badge";
import { SubmitButton } from "@/components/submit-button";
import { Flash, formatDate } from "@/components/ui";
import { getSessionProfile } from "@/lib/auth";
import { getRatings } from "@/lib/catalog";
import { getPaymentsConfig } from "@/lib/config";
import { formatQty, isOnline, lastSeenLabel, raceLabel } from "@/lib/lu4";
import { formatARS } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

interface Listing {
  id: string; seller_id: string; title: string; description: string; conditions: string;
  price_cents: number; stock: number; min_quantity: number; delivery_time_hours: number; status: string; created_at: string;
  char_race: string | null; char_class: string | null; char_level: number | null;
  seller: { id: string; display_name: string; created_at: string; last_seen_at: string | null } | null;
  category: { name: string; slug: string; unit_label: string; unit_label_plural: string } | null;
  server: { name: string } | null;
}

export async function generateMetadata(props: PageProps<"/ofertas/[id]">) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {};
  const supabase = await createClient();
  const { data } = await supabase.from("listings").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ?? "Lote" };
}

export default async function OfferPage(props: PageProps<"/ofertas/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("listings")
    .select(
      "id, seller_id, title, description, conditions, price_cents, stock, min_quantity, delivery_time_hours, status, created_at, char_race, char_class, char_level, " +
        "seller:profiles!listings_seller_id_fkey(id, display_name, created_at, last_seen_at), category:categories(name, slug, unit_label, unit_label_plural), server:game_servers(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const l = data as unknown as Listing;

  const [session, ratings, reviewsRes, moreRes] = await Promise.all([
    getSessionProfile(),
    getRatings([l.seller_id]),
    supabase.from("reviews").select("id, rating, body, created_at, buyer:profiles!reviews_buyer_id_fkey(display_name)").eq("seller_id", l.seller_id).order("created_at", { ascending: false }).limit(5),
    supabase.from("listings").select("id, title, price_cents, category:categories(unit_label), server:game_servers(name)").eq("seller_id", l.seller_id).eq("status", "activa").gt("stock", 0).neq("id", l.id).limit(4),
  ]);
  const rating = ratings[l.seller_id];
  const reviews = (reviewsRes.data ?? []) as unknown as { id: number; rating: number; body: string; created_at: string; buyer: { display_name: string } | null }[];
  const more = (moreRes.data ?? []) as unknown as { id: string; title: string; price_cents: number; category: { unit_label: string } | null; server: { name: string } | null }[];

  const isOwner = session?.userId === l.seller_id;
  const cfg = getPaymentsConfig();
  const available = l.status === "activa" && l.stock > 0;
  const unit = l.category?.unit_label ?? "u.";
  const plural = l.category?.unit_label_plural ?? "u.";
  const online = isOnline(l.seller?.last_seen_at);
  const attrs = [
    ["Servidor", l.server?.name ?? "Todos"],
    ["Categoría", l.category?.name ?? "—"],
    ["Disponible", formatQty(l.stock, unit, plural)],
    ["Entrega estimada", deliveryLabel(l.delivery_time_hours)],
    ...(l.min_quantity > 1 ? [["Compra mínima", formatQty(l.min_quantity, unit, plural)]] : []),
    ...(l.char_race ? [["Raza", raceLabel(l.char_race) ?? l.char_race]] : []),
    ...(l.char_class ? [["Clase", l.char_class]] : []),
    ...(l.char_level ? [["Nivel", String(l.char_level)]] : []),
  ];

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <nav className="animate-fade-up text-sm text-muted">
        <Link href="/lotes/todos" className="hover:text-gold-2">Lotes LU4</Link>
        <span className="mx-2 text-line">/</span>
        <Link href={`/lotes/${l.category?.slug ?? "todos"}`} className="hover:text-gold-2">{l.category?.name}</Link>
        {l.server && (
          <>
            <span className="mx-2 text-line">/</span>
            <span>{l.server.name}</span>
          </>
        )}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="card animate-fade-up">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs font-semibold text-gold-2">{l.server?.name ?? "Todos los servidores"}</span>
              <span className="rounded-md border border-line px-2 py-0.5 text-xs text-muted">{l.category?.name}</span>
              {l.status !== "activa" && <span className="rounded-md border border-bad/40 px-2 py-0.5 text-xs text-bad">No disponible</span>}
            </div>
            <h1 className="h1 mt-3">{l.title}</h1>
            <p className="mt-2 font-display text-3xl font-bold text-gold-2 lg:hidden">
              {formatARS(Number(l.price_cents))} <span className="text-base font-normal text-muted">/ {unit}</span>
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {attrs.map(([k, v]) => (
                <div key={k} className="rounded-xl border border-line bg-bg-2/60 p-3">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="mt-0.5 font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card animate-fade-up" style={{ "--i": 1 } as React.CSSProperties}>
            <h2 className="h2 mb-3">Descripción</h2>
            <p className="text-sm leading-relaxed whitespace-pre-line text-ink/90">{l.description}</p>
            {l.conditions && (
              <>
                <h2 className="h2 mt-6 mb-3">Condiciones del vendedor</h2>
                <p className="text-sm leading-relaxed whitespace-pre-line text-ink/90">{l.conditions}</p>
              </>
            )}
          </section>

          <section className="card animate-fade-up" style={{ "--i": 2 } as React.CSSProperties}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="h2">Reseñas del vendedor</h2>
              {rating && <span className="text-sm text-muted"><Stars value={rating.rating_avg} /> {rating.rating_avg.toFixed(1)} · {rating.reviews_count}</span>}
            </div>
            {reviews.length ? (
              <ul className="space-y-3">
                {reviews.map((r) => (
                  <li key={r.id} className="rounded-xl border border-line bg-bg-2/60 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{r.buyer?.display_name}</span>
                      <Stars value={r.rating} size="text-xs" />
                    </div>
                    {r.body && <p className="mt-1 text-sm text-ink/90">{r.body}</p>}
                    <p className="mt-1 text-xs text-muted">{formatDate(r.created_at)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Este vendedor todavía no tiene reseñas.</p>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className="card animate-fade-up relative overflow-hidden border-gold/25">
            <span className="absolute -top-16 -right-16 h-40 w-40 rounded-full bg-gold/15 blur-3xl animate-glow" />
            <div className="relative">
              <p className="hidden font-display text-3xl font-bold text-gold-2 lg:block">
                {formatARS(Number(l.price_cents))} <span className="text-base font-normal text-muted">/ {unit}</span>
              </p>
              <div className="mt-4">
                {isOwner ? (
                  <Link href={`/panel/vendedor/publicaciones/${l.id}`} className="btn-ghost w-full">Editar publicación</Link>
                ) : !available ? (
                  <p className="text-sm text-muted">Este lote no está disponible en este momento.</p>
                ) : cfg.mode === "bloqueado" ? (
                  <p className="text-sm text-muted">Las compras están deshabilitadas por el momento.</p>
                ) : (
                  <BuyBox
                    listingId={l.id}
                    priceCents={Number(l.price_cents)}
                    stock={l.stock}
                    minQuantity={l.min_quantity}
                    unit={unit}
                    unitPlural={plural}
                    loggedIn={!!session}
                  />
                )}
              </div>
            </div>
          </section>

          {l.seller && (
            <section className="card animate-fade-up" style={{ "--i": 1 } as React.CSSProperties}>
              <Link href={`/vendedores/${l.seller.id}`} className="flex items-center gap-3 hover:text-gold-2">
                <Avatar name={l.seller.display_name} size={48} online={online} />
                <div className="min-w-0">
                  <p className="truncate font-display text-lg font-bold">{l.seller.display_name}</p>
                  <p className={`text-xs ${online ? "text-ok" : "text-muted"}`}>{lastSeenLabel(l.seller.last_seen_at)}</p>
                </div>
              </Link>
              <div className="mt-3 flex items-center gap-2 text-sm text-muted">
                {rating ? <><Stars value={rating.rating_avg} /> {rating.rating_avg.toFixed(1)} ({rating.reviews_count} reseñas)</> : "Sin reseñas todavía"}
              </div>
              <p className="mt-1 text-xs text-muted">En Argenpay desde {formatDate(l.seller.created_at).split(" ")[0]}</p>
              {!isOwner && (
                <form action={startChat} className="mt-4">
                  <input type="hidden" name="user_id" value={l.seller.id} />
                  <input type="hidden" name="listing_id" value={l.id} />
                  <SubmitButton className="btn-ghost w-full" pendingText="Abriendo chat…">💬 Escribir al vendedor</SubmitButton>
                </form>
              )}
            </section>
          )}

          <PurchaseSteps />

          {more.length > 0 && (
            <section className="card">
              <h2 className="h2 mb-3 text-base">Otros lotes de este vendedor</h2>
              <ul className="space-y-2">
                {more.map((m) => (
                  <li key={m.id}>
                    <Link href={`/ofertas/${m.id}`} className="flex items-center justify-between gap-3 rounded-lg p-2 text-sm hover:bg-white/5">
                      <span className="min-w-0">
                        <span className="block truncate hover:text-gold-2">{m.title}</span>
                        <span className="text-xs text-muted">{m.server?.name ?? "Todos"}</span>
                      </span>
                      <span className="shrink-0 font-semibold text-gold-2">{formatARS(Number(m.price_cents))}<span className="text-xs text-muted">/{m.category?.unit_label}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
