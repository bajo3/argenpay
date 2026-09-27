import Link from "next/link";
import type { LotRow, Rating } from "@/lib/catalog";
import { accountAge, formatQty, isOnline, raceLabel } from "@/lib/lu4";
import { formatARS } from "@/lib/money";
import { Avatar, Stars } from "./seller-badge";

export function deliveryLabel(hours: number) {
  if (hours < 24) return `${hours} h`;
  const d = Math.round(hours / 24);
  return `${d} día${d === 1 ? "" : "s"}`;
}

function charLine(l: LotRow) {
  return [
    l.char_level ? `nivel ${l.char_level}` : null,
    raceLabel(l.char_race),
    l.char_class,
    l.char_equipment === "equipado" ? "Equipado" : l.char_equipment === "desnudo" ? "Desnudo" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Vendedor en la fila: avatar con estado, estrellas, cantidad de reseñas y antigüedad. */
function SellerCell({ l, rating }: { l: LotRow; rating?: Rating }) {
  return (
    <Link href={`/vendedores/${l.seller.id}`} className="relative z-10 flex min-w-0 items-center gap-2.5 hover:text-gold-2">
      <Avatar name={l.seller.display_name} url={l.seller.avatar_url} size={36} online={isOnline(l.seller.last_seen_at)} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{l.seller.display_name}</span>
        <span className="flex items-center gap-1 text-xs text-muted">
          {rating ? <><Stars value={rating.rating_avg} size="text-[11px]" />{rating.reviews_count}</> : <span>Sin reseñas</span>}
        </span>
        <span className="block text-[11px] text-muted">{accountAge(l.seller.created_at)}</span>
      </span>
    </Link>
  );
}

/**
 * Lista de ofertas: servidor, descripción, vendedor y precio (como en los mercados entre jugadores).
 * En escritorio es una tabla; en móvil cada fila es una tarjeta.
 */
export function LotList({
  lots,
  ratings,
  priceSort,
}: {
  lots: LotRow[];
  ratings: Record<string, Rating>;
  priceSort?: { href: string; dir: "asc" | "desc" | null };
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface/70">
      <div className="hidden grid-cols-[110px_1fr_200px_120px_130px] gap-4 border-b border-line bg-surface-2/60 px-5 py-3 text-xs font-semibold tracking-wider text-muted uppercase md:grid">
        <span>Servidor</span>
        <span>Descripción</span>
        <span>Vendedor</span>
        <span className="text-right">Disponible</span>
        {priceSort ? (
          <Link href={priceSort.href} className="flex items-center justify-end gap-1 hover:text-gold-2" title="Ordenar por precio">
            Precio <span className="text-[10px]">{priceSort.dir === "asc" ? "▲" : priceSort.dir === "desc" ? "▼" : "▲▼"}</span>
          </Link>
        ) : (
          <span className="text-right">Precio</span>
        )}
      </div>
      <ul>
        {lots.map((l, i) => {
          const unit = l.category?.unit_label ?? "u.";
          const plural = l.category?.unit_label_plural ?? "u.";
          const char = charLine(l);
          return (
            <li
              key={l.id}
              className="group relative animate-fade-up border-b border-line/70 last:border-0"
              style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
            >
              <Link href={`/ofertas/${l.id}`} className="absolute inset-0 z-0" aria-label={l.title} />
              <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-gold opacity-0 transition group-hover:opacity-100" />
              <div className="pointer-events-none grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 px-4 py-4 transition group-hover:bg-gold/[0.04] md:grid-cols-[110px_1fr_200px_120px_130px] md:items-center md:gap-4 md:px-5">
                <span className="col-span-2 flex items-center gap-2 md:col-span-1 md:block">
                  <span className="text-sm font-semibold text-gold-2">{l.server?.name ?? "Todos"}</span>
                  <span className="text-xs text-muted md:block">Lu4 · {l.category?.name}</span>
                </span>
                <span className="col-span-2 min-w-0 md:col-span-1">
                  <span className="line-clamp-2 text-sm group-hover:text-gold-2">
                    {l.auto_delivery && <span className="mr-1 text-gold-2" title="Entrega automática">⚡</span>}
                    {l.title}
                    {char && <span className="text-muted">, {char}</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {l.auto_delivery ? "Entrega automática" : `Entrega ~${deliveryLabel(l.delivery_time_hours)}`}
                    {l.min_quantity > 1 && <> · Mín. {formatQty(l.min_quantity, unit, plural)}</>}
                  </span>
                </span>
                <span className="pointer-events-auto">
                  <SellerCell l={l} rating={ratings[l.seller_id]} />
                </span>
                <span className="hidden text-right text-sm md:block">{formatQty(l.stock, unit, plural)}</span>
                <span className="self-center text-right">
                  <span className="block font-display text-lg font-bold text-gold-2">{formatARS(Number(l.price_cents))}</span>
                  <span className="text-xs text-muted">por {unit}<span className="md:hidden"> · {formatQty(l.stock, unit, plural)}</span></span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
