import Link from "next/link";
import type { LotRow, Rating } from "@/lib/catalog";
import { formatQty, raceLabel } from "@/lib/lu4";
import { formatARS } from "@/lib/money";
import { SellerBadge } from "./seller-badge";

export function deliveryLabel(hours: number) {
  if (hours < 24) return `${hours} h`;
  const d = Math.round(hours / 24);
  return `${d} día${d === 1 ? "" : "s"}`;
}

function charLine(l: LotRow) {
  return [raceLabel(l.char_race), l.char_class, l.char_level ? `Nv. ${l.char_level}` : null].filter(Boolean).join(" · ");
}

/**
 * Lista de lotes: servidor, descripción, vendedor (en línea + reseñas), disponibilidad y precio.
 * En escritorio se ve como tabla; en móvil cada fila es una tarjeta.
 */
export function LotList({ lots, ratings }: { lots: LotRow[]; ratings: Record<string, Rating> }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface/70">
      <div className="hidden grid-cols-[110px_1fr_210px_130px_140px] gap-4 border-b border-line bg-surface-2/60 px-5 py-3 text-xs font-semibold tracking-wider text-muted uppercase md:grid">
        <span>Servidor</span>
        <span>Descripción</span>
        <span>Vendedor</span>
        <span className="text-right">Disponible</span>
        <span className="text-right">Precio</span>
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
              <div className="pointer-events-none grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 px-4 py-4 transition group-hover:bg-gold/[0.04] md:grid-cols-[110px_1fr_210px_130px_140px] md:items-center md:gap-4 md:px-5">
                <span className="order-1 col-span-2 flex items-center gap-2 md:order-none md:col-span-1">
                  <span className="rounded-md border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs font-semibold text-gold-2">
                    {l.server?.name ?? "Todos"}
                  </span>
                  <span className="text-xs text-muted md:hidden">{l.category?.name}</span>
                </span>
                <span className="order-2 col-span-2 min-w-0 md:order-none md:col-span-1">
                  <span className="line-clamp-2 font-medium group-hover:text-gold-2">{l.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {char && <>{char} · </>}Entrega ~{deliveryLabel(l.delivery_time_hours)}
                    {l.min_quantity > 1 && <> · Mín. {formatQty(l.min_quantity, unit, plural)}</>}
                  </span>
                </span>
                <span className="pointer-events-auto order-4 md:order-none">
                  <SellerBadge seller={l.seller} rating={ratings[l.seller_id]} />
                </span>
                <span className="order-3 col-span-2 text-sm text-muted md:order-none md:col-span-1 md:text-right md:text-ink">
                  {formatQty(l.stock, unit, plural)}
                </span>
                <span className="order-5 self-center text-right md:order-none">
                  <span className="block font-display text-lg font-bold text-gold-2">{formatARS(Number(l.price_cents))}</span>
                  <span className="text-xs text-muted">por {unit}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
