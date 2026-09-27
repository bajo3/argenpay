import Link from "next/link";
import type { Rating } from "@/lib/catalog";
import { isOnline, lastSeenLabel } from "@/lib/lu4";

export function Avatar({
  name,
  url,
  size = 36,
  online,
}: {
  name: string;
  url?: string | null;
  size?: number;
  online?: boolean;
}) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatares del Storage público de Supabase
        <img src={url} alt={name} width={size} height={size} className="h-full w-full rounded-full object-cover ring-1 ring-white/10" loading="lazy" />
      ) : (
        <span
          className="grid h-full w-full place-items-center rounded-full font-display font-bold text-white ring-1 ring-white/10"
          style={{
            background: `linear-gradient(135deg, hsl(${hue} 45% 38%), hsl(${(hue + 40) % 360} 55% 22%))`,
            fontSize: Math.max(11, size * 0.38),
          }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
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

export interface PublicUser {
  id: string;
  display_name: string;
  last_seen_at: string | null;
  avatar_url?: string | null;
}

export function SellerBadge({ seller, rating, link = true }: { seller: PublicUser; rating?: Rating; link?: boolean }) {
  const online = isOnline(seller.last_seen_at);
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={seller.display_name} url={seller.avatar_url} online={online} />
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

/** Usuario con avatar y "visto hace…", como en las listas de compras, ventas y mensajes. */
export function UserCell({ user, href = true }: { user: PublicUser | null; href?: boolean }) {
  if (!user) return <span className="text-muted">—</span>;
  const online = isOnline(user.last_seen_at);
  const inner = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={user.display_name} url={user.avatar_url} size={34} online={online} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{user.display_name}</span>
        <span className={`block truncate text-xs ${online ? "text-ok" : "text-muted"}`}>{lastSeenLabel(user.last_seen_at)}</span>
      </span>
    </span>
  );
  return href ? <Link href={`/vendedores/${user.id}`} className="hover:text-gold-2">{inner}</Link> : inner;
}
