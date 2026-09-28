"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatARS } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./seller-badge";

/** Evento que dispara el chat al marcar una conversación como leída. */
export const COUNTERS_EVENT = "argenpay:contadores";

interface InboxItem {
  id: string;
  preview: string;
  at: string;
  unread: boolean;
  other: { id: string; name: string; avatar: string | null } | null;
}

interface Toast {
  key: number;
  href: string;
  title: string;
  body: string;
  avatar?: { name: string; url: string | null };
  system: boolean;
}

interface IncomingMessage {
  id: number;
  conversation_id: string;
  sender_id: string | null;
  kind: "usuario" | "sistema";
  body: string;
  order_id: string | null;
  attachment_path?: string | null;
}

const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
function when(iso: string) {
  const d = new Date(iso);
  return Date.now() - d.getTime() < 86_400_000 ? timeFmt.format(d) : dateFmt.format(d);
}

/**
 * Parte "en vivo" del encabezado: campana de mensajes con panel desplegable, saldo y avisos en pantalla.
 * Escucha por Supabase Realtime (con RLS: cada usuario recibe solo lo suyo) y, por las dudas, consulta
 * cada 20 s. Así los mensajes, el saldo y los estados de las órdenes aparecen sin recargar la página.
 */
export function HeaderLive({
  userId,
  initialUnread,
  initialBalance,
  initialAdminPending = null,
}: {
  userId: string;
  initialUnread: number;
  /** null = el saldo no está habilitado (modo real). */
  initialBalance: number | null;
  /** Solo administradores: pagos manuales por verificar (null = no es admin). */
  initialAdminPending?: number | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const [unread, setUnread] = useState(initialUnread);
  const unreadRef = useRef(initialUnread);
  const [balance, setBalance] = useState(initialBalance);
  const [adminPending, setAdminPending] = useState(initialAdminPending);
  const isAdmin = initialAdminPending !== null;
  const [bump, setBump] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const names = useRef(new Map<string, { name: string; avatar: string | null }>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletOn = initialBalance !== null;

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const lastRealtime = useRef(0);

  /** Actualiza no leídos y saldo. Devuelve true si aumentaron los no leídos. */
  const refreshCounters = useCallback(async (): Promise<boolean> => {
    const [u, w, pend] = await Promise.all([
      supabase.rpc("unread_conversations"),
      walletOn ? supabase.rpc("my_wallet") : Promise.resolve({ data: null }),
      isAdmin ? supabase.from("manual_payments").select("id", { count: "exact", head: true }).eq("status", "pendiente") : Promise.resolve(null),
    ]);
    if (pend && typeof pend.count === "number") setAdminPending(pend.count);
    let increased = false;
    if (typeof u.data === "number") {
      increased = u.data > unreadRef.current;
      if (increased) setBump(true);
      unreadRef.current = u.data;
      setUnread(u.data);
    }
    const row = Array.isArray(w.data) ? w.data[0] : w.data;
    if (row) setBalance(Number(row.available_cents ?? 0));
    return increased;
  }, [supabase, walletOn, isAdmin]);

  const loadInbox = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, user_low, user_high, last_message_at, last_message_preview, low_last_read_at, high_last_read_at")
      .or(`user_low.eq.${userId},user_high.eq.${userId}`)
      .order("last_message_at", { ascending: false })
      .limit(10);
    const rows = data ?? [];
    const others = rows.map((c) => (c.user_low === userId ? c.user_high : c.user_low));
    const missing = others.filter((id) => !names.current.has(id));
    if (missing.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, display_name, avatar_url").in("id", missing);
      for (const p of profiles ?? []) names.current.set(p.id, { name: p.display_name, avatar: p.avatar_url });
    }
    setItems(
      rows.map((c, i) => {
        const other = names.current.get(others[i]);
        const myRead = c.user_low === userId ? c.low_last_read_at : c.high_last_read_at;
        return {
          id: c.id,
          preview: c.last_message_preview,
          at: c.last_message_at,
          unread: new Date(c.last_message_at) > new Date(myRead),
          other: other ? { id: others[i], name: other.name, avatar: other.avatar } : null,
        };
      }),
    );
  }, [supabase, userId]);

  /** Re-renderiza la página actual (datos del servidor) si muestra algo que acaba de cambiar. */
  const softRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 700);
  }, [router]);

  const pushToast = useCallback((t: Omit<Toast, "key">) => {
    const key = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { ...t, key }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.key !== key)), 7000);
  }, []);

  const onMessage = useCallback(
    async (m: IncomingMessage) => {
      if (m.sender_id === userId) return;
      lastRealtime.current = Date.now();
      const path = pathRef.current;
      const inThisChat = path === `/mensajes/${m.conversation_id}`;
      if (!inThisChat) void refreshCounters();
      if (open) void loadInbox();

      // La página actual muestra datos que este mensaje cambia: la refrescamos.
      if (
        (m.order_id && path === `/ordenes/${m.order_id}`) ||
        path === "/mensajes" ||
        (path.startsWith("/mensajes/") && !inThisChat) ||
        (m.kind === "sistema" && (path.startsWith("/panel") || path === "/saldo"))
      ) {
        softRefresh();
      }
      if (inThisChat) return;

      let sender: { name: string; avatar: string | null } | undefined;
      if (m.sender_id) {
        sender = names.current.get(m.sender_id);
        if (!sender) {
          const { data } = await supabase.from("profiles").select("id, display_name, avatar_url").eq("id", m.sender_id).maybeSingle();
          if (data) {
            sender = { name: data.display_name, avatar: data.avatar_url };
            names.current.set(data.id, sender);
          }
        }
      }
      pushToast({
        href: m.kind === "sistema" && m.order_id ? `/ordenes/${m.order_id}` : `/mensajes/${m.conversation_id}`,
        title: m.kind === "sistema" ? "Argenpay · aviso" : (sender?.name ?? "Nuevo mensaje"),
        body: m.body?.trim() || (m.attachment_path ? "📷 Imagen" : ""),
        avatar: sender ? { name: sender.name, url: sender.avatar } : undefined,
        system: m.kind === "sistema",
      });
    },
    [userId, open, supabase, refreshCounters, loadInbox, softRefresh, pushToast],
  );
  const pushToastRef = useRef(pushToast);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
    pushToastRef.current = pushToast;
  }, [onMessage, pushToast]);

  // Tiempo real + respaldo por consulta periódica + presencia "en línea".
  useEffect(() => {
    let cancelled = false;
    const channel = supabase
      .channel(`live:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_messages" }, (payload) =>
        void onMessageRef.current(payload.new as IncomingMessage),
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wallet_entries", filter: `user_id=eq.${userId}` }, () => {
        void refreshCounters();
        if (pathRef.current === "/saldo") softRefresh();
      });
    if (isAdmin) {
      // Pagos manuales: el aviso de un comprador te llega al instante (RLS: solo lo reciben los administradores).
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "manual_payments" }, () => {
          void refreshCounters();
          if (pathRef.current.startsWith("/admin")) softRefresh();
          pushToastRef.current({ href: "/admin#pagos-manuales", title: "💸 Pago para verificar", body: "Un comprador avisó que transfirió. Revisá y confirmá.", system: true });
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "manual_payments" }, () => {
          void refreshCounters();
          if (pathRef.current.startsWith("/admin")) softRefresh();
        });
    }
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (!cancelled) channel.subscribe();
    })();

    const visible = () => document.visibilityState === "visible";
    void supabase.rpc("touch_presence");
    // Respaldo si el tiempo real no llega (red que bloquea websockets, pestaña dormida, etc.).
    const poll = setInterval(async () => {
      if (!visible()) return;
      const increased = await refreshCounters();
      if (increased && Date.now() - lastRealtime.current > 25_000) {
        const path = pathRef.current;
        if (path.startsWith("/mensajes") || path.startsWith("/ordenes") || path.startsWith("/panel")) softRefresh();
        if (!path.startsWith("/mensajes/")) {
          pushToastRef.current({ href: "/mensajes", title: "Mensajes nuevos", body: "Tenés mensajes sin leer.", system: false });
        }
      }
    }, 15_000);
    const presence = setInterval(() => visible() && void supabase.rpc("touch_presence"), 120_000);
    const onFocus = () => void refreshCounters();
    const onCounters = () => void refreshCounters();
    window.addEventListener("focus", onFocus);
    window.addEventListener(COUNTERS_EVENT, onCounters);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(presence);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(COUNTERS_EVENT, onCounters);
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId, isAdmin, refreshCounters, softRefresh]);

  // Al navegar: panel cerrado y contadores al día (acciones propias como pagar con saldo).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    const t = setTimeout(() => void refreshCounters(), 300);
    return () => clearTimeout(t);
  }, [pathname, refreshCounters]);

  // Cerrar el panel con clic afuera o Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Contador en el título de la pestaña.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, "");
    const total = unread + (adminPending ?? 0);
    document.title = total > 0 ? `(${total > 9 ? "9+" : total}) ${base}` : base;
  }, [unread, adminPending, pathname]);

  useEffect(() => {
    if (!bump) return;
    const t = setTimeout(() => setBump(false), 900);
    return () => clearTimeout(t);
  }, [bump]);

  return (
    <>
      <div ref={panelRef} className="relative">
        <button
          type="button"
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) void loadInbox();
          }}
          className={`relative rounded-lg p-2 transition hover:bg-white/5 hover:text-gold-2 ${open ? "bg-white/5 text-gold-2" : "text-muted"}`}
          aria-label={unread ? `Mensajes (${unread} sin leer)` : "Mensajes"}
          aria-expanded={open}
        >
          <svg viewBox="0 0 24 24" className={`h-5 w-5 ${bump ? "animate-[ring_0.8s_ease-in-out]" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 5h16v11H8l-4 4V5z" strokeLinejoin="round" />
          </svg>
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-crimson px-1 text-[10px] font-bold text-white shadow-[0_0_10px_rgb(220_38_38/0.7)]">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="fixed inset-x-2 top-[62px] z-50 animate-fade-up overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[380px]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-display text-base font-bold">Mensajes</p>
              {unread > 0 && <span className="rounded-full bg-crimson/15 px-2 py-0.5 text-xs font-semibold text-crimson">{unread} sin leer</span>}
            </div>
            <div className="max-h-[min(70vh,480px)] overflow-y-auto">
              {items === null ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 rounded-xl" />)}
                </div>
              ) : items.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted">Todavía no tenés conversaciones.</p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {items.map((c) => {
                    const name = c.other?.name ?? "Usuario";
                    return (
                      <li key={c.id}>
                        <Link href={`/mensajes/${c.id}`} className={`flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/5 ${c.unread ? "bg-gold/[0.05]" : ""}`}>
                          <Avatar name={name} url={c.other?.avatar} size={38} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className={`truncate text-sm ${c.unread ? "font-bold text-ink" : "font-medium"}`}>{name}</span>
                              <span className="shrink-0 text-[11px] text-muted">{when(c.at)}</span>
                            </span>
                            <span className="flex items-center gap-2">
                              <span className={`truncate text-xs ${c.unread ? "text-ink" : "text-muted"}`}>{c.preview || "Sin mensajes"}</span>
                              {c.unread && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-crimson" />}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <Link href="/mensajes" className="block border-t border-line px-4 py-3 text-center text-sm font-semibold text-gold hover:bg-white/5 hover:text-gold-2">
              Ver todos los mensajes
            </Link>
          </div>
        )}
      </div>

      {!!adminPending && (
        <Link
          href="/admin#pagos-manuales"
          className="rounded-lg border border-crimson/40 bg-crimson/10 px-2.5 py-1.5 text-sm font-semibold text-crimson tabular-nums transition hover:bg-crimson/20"
          title="Pagos por transferencia esperando tu verificación"
        >
          💸 {adminPending}
        </Link>
      )}

      {balance !== null && (
        <Link href="/saldo" className="hidden rounded-lg border border-gold/25 bg-gold/5 px-2.5 py-1.5 text-sm font-semibold text-gold-2 tabular-nums transition hover:bg-gold/15 sm:block" title="Tu saldo (simulado)">
          {formatARS(balance)}
        </Link>
      )}

      {/* Avisos en pantalla */}
      <div className="pointer-events-none fixed right-3 bottom-3 z-[60] flex w-[min(92vw,360px)] flex-col gap-2 sm:right-5 sm:bottom-5" aria-live="polite">
        {toasts.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            onClick={() => setToasts((prev) => prev.filter((x) => x.key !== t.key))}
            className="pointer-events-auto flex animate-fade-up items-start gap-3 rounded-2xl border border-gold/30 bg-surface/95 p-3.5 shadow-[0_20px_50px_-15px_rgb(0_0_0/0.9)] backdrop-blur transition hover:border-gold/60"
          >
            {t.avatar ? (
              <Avatar name={t.avatar.name} url={t.avatar.url} size={38} />
            ) : (
              <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-gold/15 text-sm font-bold text-gold-2">{t.system ? "i" : "💬"}</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{t.title}</span>
              <span className="line-clamp-2 text-xs text-muted">{t.body}</span>
            </span>
            <span className="shrink-0 text-[10px] font-semibold tracking-wide text-gold uppercase">Ver</span>
          </Link>
        ))}
      </div>
    </>
  );
}
