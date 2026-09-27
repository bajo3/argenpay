import Link from "next/link";
import type { Rating } from "@/lib/catalog";
import { isOnline } from "@/lib/lu4";

export function Avatar({ name, size = 36, online }: { name: string; size?: number; online?: boolean }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="grid h-full w-full place-items-center rounded-full font-display text-sm font-bold text-white ring-1 ring-white/10"
        style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 38%), hsl(${(hue + 40) % 360} 55% 22%))` }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      {online !== undefined && (
        <span className={`absolute -right-0.5 -bottom-0.5 ring-2 ring-surface ${online ? "online-dot" : "offline-dot"}`} />
      )}
    </span>
  );
}

export function Stars({ value, size = "text-sm" }: { value: number; size?: string }) {
  const full = Math.round(value);
  return (
    <span className={`${size} tracking-tight`} aria-label={`${value.toFixed(1)} de 5`}>
      <span className="text-gold">{"★".repeat(full)}</span>
      <span className="text-muted/40">{"★".repeat(5 - full)}</span>
    </span>
  );
}

export function SellerBadge({
  seller,
  rating,
  link = true,
}: {
  seller: { id: string; display_name: string; last_seen_at: string | null };
  rating?: Rating;
  link?: boolean;
}) {
  const online = isOnline(seller.last_seen_at);
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={seller.display_name} online={online} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{seller.display_name}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {rating ? (
            <>
              <Stars value={rating.rating_avg} size="text-xs" /> {rating.rating_avg.toFixed(1)} ({rating.reviews_count})
            </>
          ) : (
            "Sin reseñas"
          )}
        </span>
      </span>
    </span>
  );
  return link ? (
    <Link href={`/vendedores/${seller.id}`} className="relative z-10 hover:text-gold-2">
      {body}
    </Link>
  ) : (
    body
  );
}
