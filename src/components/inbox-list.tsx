import Link from "next/link";
import type { ConversationView } from "@/lib/conversations";
import { isOnline } from "@/lib/lu4";
import { Avatar } from "./seller-badge";

const fmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

export function InboxList({ conversations, activeId }: { conversations: ConversationView[]; activeId?: string }) {
  if (!conversations.length) {
    return (
      <div className="p-6 text-center text-sm text-muted">
        No tenés conversaciones todavía. Abrí un lote y tocá <strong className="text-ink">Escribir al vendedor</strong>.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line/70">
      {conversations.map((c) => {
        const name = c.other?.display_name ?? "Usuario";
        const active = c.id === activeId;
        return (
          <li key={c.id}>
            <Link
              href={`/mensajes/${c.id}`}
              className={`flex items-center gap-3 px-4 py-3 transition hover:bg-white/5 ${active ? "bg-gold/10" : ""}`}
            >
              <Avatar name={name} size={40} online={isOnline(c.other?.last_seen_at)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${c.unread ? "font-bold text-ink" : "font-medium"}`}>{name}</span>
                  <span className="shrink-0 text-[11px] text-muted">{fmt.format(new Date(c.last_message_at))}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`truncate text-xs ${c.unread ? "text-ink" : "text-muted"}`}>{c.last_message_preview || "Sin mensajes"}</span>
                  {c.unread && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-crimson" />}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
