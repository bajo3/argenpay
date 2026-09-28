import "server-only";

/**
 * Aviso al titular fuera del sitio, cuando pasa algo que requiere una acción manual (por ejemplo,
 * un comprador avisó que transfirió). Canales opcionales, se activan con variables de entorno:
 *  · Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (crear el bot con @BotFather).
 *  · ntfy.sh:  NTFY_TOPIC (+ NTFY_SERVER, NTFY_TOKEN si es propio); llega como notificación push al celular.
 * Nunca lanza errores ni demora la operación más de unos segundos: si no hay canal configurado, no hace nada.
 * No incluir en el texto datos sensibles (referencias completas, credenciales).
 */
export interface AdminNotice {
  title: string;
  body: string;
  /** Ruta interna (ej: "/admin") o URL absoluta a la que lleva el aviso. */
  link?: string;
}

const TIMEOUT_MS = 4000;

function absolute(link: string | undefined): string | undefined {
  if (!link) return undefined;
  if (/^https?:\/\//i.test(link)) return link;
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${link.startsWith("/") ? "" : "/"}${link}` : undefined;
}

export function configuredChannels(): string[] {
  const c: string[] = [];
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) c.push("telegram");
  if (process.env.NTFY_TOPIC) c.push("ntfy");
  return c;
}

export async function notifyAdmin(n: AdminNotice): Promise<string[]> {
  const url = absolute(n.link);
  const sent: string[] = [];
  const jobs: Promise<void>[] = [];

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (token && chat) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: `${n.title}\n${n.body}${url ? `\n${url}` : ""}`, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
        .then((r) => {
          if (r.ok) sent.push("telegram");
        })
        .catch(() => {}),
    );
  }

  const topic = process.env.NTFY_TOPIC;
  if (topic) {
    const server = (process.env.NTFY_SERVER ?? "https://ntfy.sh").replace(/\/$/, "");
    // Los encabezados HTTP no admiten UTF-8 directo: ntfy acepta el título en formato RFC 2047 (base64).
    const headers: Record<string, string> = {
      Title: `=?UTF-8?B?${Buffer.from(n.title, "utf8").toString("base64")}?=`,
      Priority: "high",
      Tags: "moneybag",
    };
    if (url) headers.Click = url;
    if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
    jobs.push(
      fetch(`${server}/${encodeURIComponent(topic)}`, { method: "POST", headers, body: n.body, signal: AbortSignal.timeout(TIMEOUT_MS) })
        .then((r) => {
          if (r.ok) sent.push("ntfy");
        })
        .catch(() => {}),
    );
  }

  await Promise.all(jobs);
  return sent;
}
