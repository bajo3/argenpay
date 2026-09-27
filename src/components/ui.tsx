import Link from "next/link";
import { STATUS_LABELS, STATUS_TONE, type OrderStatus } from "@/lib/orders/state-machine";

const toneClass = {
  neutral: "border-muted/30 bg-muted/10 text-muted",
  info: "border-info/30 bg-info/10 text-info",
  warn: "border-gold/40 bg-gold/10 text-gold-2",
  ok: "border-ok/30 bg-ok/10 text-ok",
  bad: "border-bad/30 bg-bad/10 text-bad",
} as const;

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneClass[STATUS_TONE[status]]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Flash({ error, ok }: { error?: string | string[]; ok?: string | string[] }) {
  const e = Array.isArray(error) ? error[0] : error;
  const o = Array.isArray(ok) ? ok[0] : ok;
  if (!e && !o) return null;
  return (
    <div
      role={e ? "alert" : "status"}
      className={`mb-4 animate-fade-up rounded-xl border px-4 py-3 text-sm ${
        e ? "border-bad/30 bg-bad/10 text-bad" : "border-ok/30 bg-ok/10 text-ok"
      }`}
    >
      {e ?? o}
    </div>
  );
}

export function EmptyState({ title, children, href, cta }: { title: string; children?: React.ReactNode; href?: string; cta?: string }) {
  return (
    <div className="card flex flex-col items-center py-10 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-full border border-gold/30 bg-gold/10 text-xl text-gold-2">◈</span>
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {href && cta && (
        <Link href={href} className="btn-primary shine mt-5">
          {cta}
        </Link>
      )}
    </div>
  );
}

export function shortId(id: string) {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

export function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));
}
