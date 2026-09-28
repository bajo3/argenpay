"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compressImage, ImageError } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";
import { COUNTERS_EVENT } from "./header-live";

export interface ChatMessage {
  id: number;
  sender_id: string | null;
  kind: "usuario" | "sistema";
  body: string;
  order_id: string | null;
  listing_id: string | null;
  attachment_path?: string | null;
  created_at: string;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Imagen adjunta: se pide una URL firmada temporal (el bucket es privado). */
function Attachment({ supabase, path }: { supabase: SupabaseClient; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.storage
      .from("chat")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (alive) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      alive = false;
    };
  }, [supabase, path]);
  if (!url) return <span className="block h-40 w-56 skeleton" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal de Storage */}
      <img src={url} alt="Imagen adjunta" className="max-h-64 max-w-full rounded-lg object-contain" loading="lazy" />
    </a>
  );
}

const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const dayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });

/**
 * Chat en tiempo real (Supabase Realtime, respetando RLS) con respaldo por consulta periódica.
 * Los mensajes de sistema (eventos de órdenes) se muestran centrados con enlace a la orden.
 */
export function ChatBox({
  conversationId,
  me,
  names,
  initial,
  height = "h-[60vh] min-h-[380px]",
  listingHint,
  fill = false,
}: {
  conversationId: string;
  me: string;
  names: Record<string, string>;
  initial: ChatMessage[];
  height?: string;
  listingHint?: { id: string; title: string } | null;
  /** Ocupa todo el alto del contenedor (página de mensajes), sin marco propio. */
  fill?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastId = useRef(initial.at(-1)?.id ?? 0);

  const add = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = [...prev, ...incoming.filter((m) => !seen.has(m.id))].sort((a, b) => a.id - b.id);
      lastId.current = merged.at(-1)?.id ?? lastId.current;
      return merged;
    });
  }, []);

  // Marca leída y avisa al encabezado para que baje el contador de no leídos al instante.
  const markRead = useCallback(async () => {
    await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
    window.dispatchEvent(new Event(COUNTERS_EVENT));
  }, [supabase, conversationId]);

  // Tiempo real + respaldo
  useEffect(() => {
    let cancelled = false;
    const channel = supabase
      .channel(`conv:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          add([payload.new as ChatMessage]);
          void markRead();
        },
      );
    let isLive = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (!cancelled)
        channel.subscribe((status) => {
          isLive = status === "SUBSCRIBED";
          setLive(isLive);
        });
    })();

    const fetchNew = async () => {
      const { data } = await supabase
        .from("conversation_messages")
        .select("id, sender_id, kind, body, order_id, listing_id, attachment_path, created_at")
        .eq("conversation_id", conversationId)
        .gt("id", lastId.current)
        .order("id");
      if (data?.length) {
        add(data as ChatMessage[]);
        void markRead();
      }
    };
    // Respaldo: cada 3 s si el tiempo real no conectó, cada 15 s si está conectado.
    let ticks = 0;
    const poll = setInterval(() => {
      ticks++;
      if (document.visibilityState !== "visible") return;
      if (!isLive || ticks % 5 === 0) void fetchNew();
    }, 3000);
    const onVisible = () => document.visibilityState === "visible" && void fetchNew();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    void markRead();
    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [supabase, conversationId, add, markRead]);

  // Auto-scroll al último mensaje
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function sendImage(original: File) {
    setSending(true);
    setError(null);
    let file: File;
    try {
      // Las fotos pesadas se achican solas (máx. 1600 px y 2 MB) antes de subirlas.
      file = await compressImage(original, { maxSide: 1600, maxBytes: 2 * 1024 * 1024 });
    } catch (e) {
      setSending(false);
      return setError(e instanceof ImageError ? e.message : "No pudimos procesar la imagen.");
    }
    if (!IMAGE_TYPES.includes(file.type)) {
      setSending(false);
      return setError("Formato de imagen no soportado.");
    }
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("chat").upload(path, file, { contentType: file.type });
    if (upErr) {
      setSending(false);
      return setError("No se pudo subir la imagen.");
    }
    const { data, error: err } = await supabase
      .from("conversation_messages")
      .insert({ conversation_id: conversationId, sender_id: me, body: text.trim(), attachment_path: path, listing_id: listingHint?.id ?? null })
      .select("id, sender_id, kind, body, order_id, listing_id, attachment_path, created_at")
      .single();
    setSending(false);
    if (err) return setError("No se pudo enviar la imagen.");
    setText("");
    add([data as ChatMessage]);
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    if (body.length > 2000) return setError("El mensaje es demasiado largo (máx. 2000 caracteres)");
    setSending(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("conversation_messages")
      .insert({ conversation_id: conversationId, sender_id: me, body, listing_id: listingHint?.id ?? null })
      .select("id, sender_id, kind, body, order_id, listing_id, attachment_path, created_at")
      .single();
    setSending(false);
    if (err) return setError("No se pudo enviar el mensaje. Probá de nuevo.");
    setText("");
    add([data as ChatMessage]);
  }

  return (
    <div className={fill ? "flex h-full min-h-0 flex-col" : "flex flex-col overflow-hidden rounded-2xl border border-line bg-surface/80"}>
      <div ref={listRef} className={`${fill ? "min-h-0 flex-1" : height} space-y-2 overflow-y-auto px-3 py-4 sm:px-6`}>
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">Todavía no hay mensajes. ¡Escribí el primero!</p>
        )}
        {messages.map((m, i) => {
          const day = dayFmt.format(new Date(m.created_at));
          const showDay = i === 0 || day !== dayFmt.format(new Date(messages[i - 1].created_at));
          const mine = m.sender_id === me;
          return (
            <div key={m.id}>
              {showDay && (
                <p className="my-3 text-center text-[11px] font-medium tracking-wide text-muted uppercase">{day}</p>
              )}
              {m.kind === "sistema" ? (
                <div className="my-3 animate-fade-up">
                  <p className="mb-1 flex items-center gap-2 text-xs">
                    <span className="font-semibold text-ink">Argenpay</span>
                    <span className="rounded bg-gold px-1.5 py-px text-[10px] font-bold text-gold-ink uppercase">aviso</span>
                    <span className="ml-auto text-muted">{timeFmt.format(new Date(m.created_at))}</span>
                  </p>
                  <Link
                    href={m.order_id ? `/ordenes/${m.order_id}` : "#"}
                    className="flex gap-2.5 rounded-xl border border-gold/25 bg-gold/[0.07] px-3.5 py-2.5 text-sm text-ink/90 transition hover:border-gold/50 hover:bg-gold/10"
                  >
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-gold/80 text-[10px] font-bold text-gold-ink">i</span>
                    <span>{m.body}</span>
                  </Link>
                </div>
              ) : (
                <div className={`flex animate-fade-up ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                      mine
                        ? "rounded-br-md bg-gradient-to-b from-gold-2 to-gold text-gold-ink"
                        : "rounded-bl-md border border-line bg-surface-2"
                    }`}
                  >
                    {!mine && <p className="mb-0.5 text-[11px] font-semibold text-gold">{names[m.sender_id ?? ""] ?? "Administración"}</p>}
                    {m.attachment_path && (
                      <div className="mb-1">
                        <Attachment supabase={supabase} path={m.attachment_path} />
                      </div>
                    )}
                    {m.body && <p className="break-words whitespace-pre-line">{m.body}</p>}
                    <p className={`mt-0.5 text-right text-[10px] ${mine ? "text-gold-ink/60" : "text-muted"}`}>
                      {timeFmt.format(new Date(m.created_at))}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-line bg-bg-2/70 p-3">
        {listingHint && (
          <p className="mb-2 truncate text-xs text-muted">
            Consultando por: <Link href={`/ofertas/${listingHint.id}`} className="text-gold hover:text-gold-2">{listingHint.title}</Link>
          </p>
        )}
        {error && <p className="mb-2 text-xs text-bad">{error}</p>}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sending}
            className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-line text-muted transition hover:border-gold/50 hover:text-gold-2"
            aria-label="Adjuntar imagen"
            title="Adjuntar imagen"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M21 11.5l-8.6 8.6a5 5 0 01-7.1-7.1l8.6-8.6a3.3 3.3 0 014.7 4.7l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9" strokeLinecap="round" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void sendImage(f);
              e.target.value = "";
            }}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
              if (img) {
                e.preventDefault();
                void sendImage(img);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Escribí un mensaje… (Enter envía · pegá una imagen con Ctrl+V)"
            className="input max-h-40 min-h-[42px] resize-none"
            aria-label="Mensaje"
          />
          <button onClick={() => void send()} disabled={sending || !text.trim()} className="btn-primary h-[42px] px-4" aria-label="Enviar">
            {sending ? "…" : "Enviar"}
          </button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
          <span className={live ? "online-dot" : "offline-dot"} />
          {live ? "Conectado en tiempo real" : "Actualizando cada pocos segundos"} · Nunca compartas tu contraseña de cuenta por el chat.
        </p>
      </div>
    </div>
  );
}
