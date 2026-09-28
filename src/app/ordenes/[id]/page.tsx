import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orderAction, payOrder, requestRefund } from "@/app/actions/orders";
import { leaveReview, replyReview } from "@/app/actions/social";
import { payWithBalance } from "@/app/actions/wallet";
import { ChatBox } from "@/components/chat-box";
import { DeliveryForm } from "@/components/delivery-form";
import { ManualPaymentPanel, type ManualReport } from "@/components/manual-payment-panel";
import { Stars, UserCell } from "@/components/seller-badge";
import { SubmitButton } from "@/components/submit-button";
import { Flash, formatDate, shortId, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getPaymentsConfig } from "@/lib/config";
import { findConversation, getMessages } from "@/lib/conversations";
import { getManualPaymentSettings } from "@/lib/manual-payments";
import { formatQty, raceLabel } from "@/lib/lu4";
import {
  availableUserActions,
  isAllowed,
  STATUS_LABELS,
  SYSTEM_TRANSITIONS,
  type Actor,
  type OrderStatus,
} from "@/lib/orders/state-machine";
import { createClient } from "@/lib/supabase/server";
import { getMyWallet } from "@/lib/wallet";
import { Money } from "@/components/money";

export const metadata: Metadata = { title: "Orden" };

interface Snapshot {
  title: string; server: string | null; category: string; unit?: string; unit_plural?: string;
  race?: string | null; class?: string | null; level?: number | null;
}
interface Order {
  id: string; buyer_id: string; seller_id: string; status: OrderStatus; quantity: number;
  unit_price_cents: number; price_cents: number; commission_bps: number; commission_cents: number;
  processor_fee_bps: number; processor_fee_cents: number; processor_fee_policy: string;
  seller_net_cents: number; platform_net_cents: number; payment_mode: string; payment_provider: string | null;
  listing_id: string; listing_snapshot: Snapshot;
  delivery_time_hours: number; paid_at: string | null; delivery_due_at: string | null; delivered_at: string | null;
  auto_confirm_at: string | null; confirmed_at: string | null; created_at: string;
  paid_with: string | null;
  buyer: { id: string; display_name: string; last_seen_at: string | null; avatar_url: string | null } | null;
  seller: { id: string; display_name: string; last_seen_at: string | null; avatar_url: string | null } | null;
}

const ROLE_LABEL: Record<string, string> = { comprador: "Comprador", vendedor: "Vendedor", admin: "Admin", sistema: "Sistema" };
const STEPS: { key: OrderStatus; label: string }[] = [
  { key: "pendiente_pago", label: "Pago" },
  { key: "pago_confirmado", label: "Pagado" },
  { key: "entregado", label: "Entregado" },
  { key: "confirmado", label: "Confirmado" },
  { key: "liquidado", label: "Liquidado" },
];
const STEP_INDEX: Partial<Record<OrderStatus, number>> = {
  pendiente_pago: 0, pago_confirmado: 1, entrega_en_curso: 1, entregado: 2, en_reclamo: 2, confirmado: 3, liquidado: 4,
};

export default async function OrderPage(props: PageProps<"/ordenes/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const s = await requireUser(`/ordenes/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("*, buyer:profiles!orders_buyer_id_fkey(id, display_name, last_seen_at, avatar_url), seller:profiles!orders_seller_id_fkey(id, display_name, last_seen_at, avatar_url)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound(); // RLS: solo participantes y admins
  const o = data as unknown as Order;

  const [events, evidence, dispute, review, conversationId, autoItems] = await Promise.all([
    supabase.from("order_events").select("id, actor_role, event_type, from_status, to_status, note, created_at").eq("order_id", id).order("id"),
    supabase.from("delivery_evidence").select("id, description, file_path, created_at").eq("order_id", id).order("id"),
    supabase.from("disputes").select("reason, status, resolution, resolution_note, created_at, resolved_at").eq("order_id", id).maybeSingle(),
    supabase.from("reviews").select("id, rating, body, created_at, seller_reply").eq("order_id", id).maybeSingle(),
    findConversation(o.buyer_id, o.seller_id),
    supabase.from("listing_delivery_items").select("id, content, delivered_at").eq("order_id", id).order("id"),
  ]);
  const showManual = o.buyer_id === s.userId && o.status === "pendiente_pago" && o.payment_mode === "manual" && getPaymentsConfig().mode === "manual";
  const [messages, wallet, manualSettings, manualReports] = await Promise.all([
    conversationId ? getMessages(conversationId) : Promise.resolve([]),
    o.buyer_id === s.userId && o.status === "pendiente_pago" && (o.payment_mode === "simulado" || o.payment_mode === "manual") ? getMyWallet() : Promise.resolve(null),
    showManual ? getManualPaymentSettings() : Promise.resolve(null),
    showManual
      ? supabase.from("manual_payments").select("id, method, reference, status, admin_note, created_at").eq("order_id", id).order("id", { ascending: false })
      : Promise.resolve(null),
  ]);

  const evidenceWithUrls = await Promise.all(
    (evidence.data ?? []).map(async (e) => {
      if (!e.file_path) return { ...e, url: null as string | null };
      const { data: signed } = await supabase.storage.from("evidencias").createSignedUrl(e.file_path, 600);
      return { ...e, url: signed?.signedUrl ?? null };
    }),
  );

  const role: Actor = o.buyer_id === s.userId ? "comprador" : o.seller_id === s.userId ? "vendedor" : "admin";
  const actions = availableUserActions(o, role);
  const cfg = getPaymentsConfig();
  const canRefund = isAllowed(SYSTEM_TRANSITIONS, "reembolsar", o.status, role);
  const names: Record<string, string> = { [o.buyer_id]: o.buyer?.display_name ?? "Comprador", [o.seller_id]: o.seller?.display_name ?? "Vendedor" };
  const snap = o.listing_snapshot;
  const unit = snap.unit ?? "u.";
  const plural = snap.unit_plural ?? "u.";
  const stepIdx = STEP_INDEX[o.status];
  const closedBad = o.status === "cancelado" || o.status === "reembolsado";
  const canReview = role === "comprador" && (o.status === "confirmado" || o.status === "liquidado") && !review.data;
  const charLine = [raceLabel(snap.race), snap.class, snap.level ? `Nv. ${snap.level}` : null].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />

      <header className="animate-fade-up flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">Orden {shortId(o.id)} · {formatDate(o.created_at)}</p>
          <h1 className="h1 mt-1">{snap.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {snap.server ?? "Todos los servidores"} · {snap.category} · {formatQty(o.quantity, unit, plural)}
            {charLine && ` · ${charLine}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={o.status} />
          {o.payment_mode === "simulado" && (
            <span className="rounded border border-gold/30 bg-warn-bg px-2 py-0.5 text-[10px] font-bold tracking-wider text-warn-ink">SIMULADA</span>
          )}
          {o.payment_mode === "manual" && (
            <span className="rounded border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-gold-2">TRANSFERENCIA</span>
          )}
        </div>
      </header>

      {/* Progreso */}
      {closedBad ? (
        <div className="card border-bad/30 text-sm text-bad">Esta orden terminó como <strong>{STATUS_LABELS[o.status]}</strong>.</div>
      ) : (
        <ol className="card animate-fade-up grid grid-cols-5 gap-1 p-4">
          {STEPS.map((st, i) => {
            const done = stepIdx !== undefined && i <= stepIdx;
            const current = stepIdx === i;
            return (
              <li key={st.key} className="flex flex-col items-center gap-2 text-center">
                <span className="relative flex w-full items-center">
                  <span className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : done ? "bg-gold" : "bg-line"}`} />
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-bold transition ${
                      done ? "border-gold bg-gold text-gold-ink shadow-[0_0_16px_rgb(217_171_82/0.6)]" : "border-line bg-bg-2 text-muted"
                    } ${current && o.status === "en_reclamo" ? "!border-crimson !bg-crimson !text-white" : ""}`}
                  >
                    {done && !current ? "✓" : i + 1}
                  </span>
                  <span className={`h-0.5 flex-1 ${i === STEPS.length - 1 ? "opacity-0" : stepIdx !== undefined && i < stepIdx ? "bg-gold" : "bg-line"}`} />
                </span>
                <span className={`text-[11px] sm:text-xs ${done ? "text-ink" : "text-muted"}`}>
                  {current && o.status === "en_reclamo" ? "En reclamo" : current && o.status === "entrega_en_curso" ? "Entregando" : st.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {/* Acciones */}
          <section className="card animate-fade-up space-y-4 border-gold/20">
            <h2 className="h2">Próximo paso</h2>
            <NextStepText o={o} role={role} />

            {showManual && wallet && (
              <form action={payWithBalance} className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold/5 p-4">
                <input type="hidden" name="order_id" value={o.id} />
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-semibold">Pagar con tu saldo (al instante)</p>
                  <p className="text-xs text-muted">Disponible: <Money cents={wallet.available} /></p>
                </div>
                {wallet.available >= Number(o.price_cents) ? (
                  <SubmitButton className="btn-primary shine" pendingText="Pagando…">Pagar <Money cents={Number(o.price_cents)} /></SubmitButton>
                ) : (
                  <Link href="/saldo" className="btn-ghost">Cargar saldo</Link>
                )}
              </form>
            )}
            {showManual && wallet && <p className="text-center text-xs tracking-wide text-muted uppercase">o transferí directo para esta orden</p>}

            {showManual && manualSettings && (
              <ManualPaymentPanel
                orderId={o.id}
                userId={s.userId}
                priceCents={Number(o.price_cents)}
                settings={manualSettings}
                reports={(manualReports?.data ?? []) as ManualReport[]}
              />
            )}

            {o.status === "pendiente_pago" && role === "comprador" && o.payment_mode !== "manual" && cfg.mode !== "bloqueado" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {wallet && (
                  <form action={payWithBalance} className="rounded-xl border border-gold/30 bg-gold/5 p-4">
                    <input type="hidden" name="order_id" value={o.id} />
                    <p className="text-sm font-semibold">Pagar con saldo</p>
                    <p className="mb-3 text-xs text-muted">Disponible: <Money cents={wallet.available} /></p>
                    {wallet.available >= Number(o.price_cents) ? (
                      <SubmitButton className="btn-primary shine w-full" pendingText="Pagando…">Pagar <Money cents={Number(o.price_cents)} /></SubmitButton>
                    ) : (
                      <Link href="/saldo" className="btn-ghost w-full">Cargar saldo</Link>
                    )}
                  </form>
                )}
                <form action={payOrder} className="rounded-xl border border-line bg-bg-2/60 p-4">
                  <input type="hidden" name="order_id" value={o.id} />
                  <p className="text-sm font-semibold">Pagar con el procesador</p>
                  <p className="mb-3 text-xs text-muted">{o.payment_mode === "simulado" ? "Checkout de prueba (simulado)" : "Tarjeta, débito o dinero en cuenta"}</p>
                  <SubmitButton className={wallet ? "btn-ghost w-full" : "btn-primary shine w-full"} pendingText="Redirigiendo…">
                    Pagar <Money cents={Number(o.price_cents)} />
                  </SubmitButton>
                </form>
              </div>
            )}

            {actions.map((t) => {
              if (t.action === "marcar_entregado") return <DeliveryForm key={t.action} orderId={o.id} />;
              return (
                <form key={t.action} action={orderAction} className="space-y-2">
                  <input type="hidden" name="order_id" value={o.id} />
                  <input type="hidden" name="action" value={t.action} />
                  {t.requiresNote && (
                    <textarea
                      name="note" required minLength={t.action === "abrir_reclamo" ? 10 : 1} rows={3} className="input"
                      placeholder={t.action === "abrir_reclamo" ? "Contá qué pasó (ej: recibí 500 kk de 1000). Un administrador va a revisar el caso y el chat." : "Nota de resolución"}
                    />
                  )}
                  <SubmitButton
                    className={t.action === "abrir_reclamo" || t.action === "cancelar" ? "btn-danger" : "btn-primary shine"}
                    confirm={t.action === "confirmar_recepcion" ? "Confirmá solo si ya recibiste en el juego todo lo acordado. Se libera el pago al vendedor y no se puede deshacer." : undefined}
                    confirmTitle="¿Recibiste todo?"
                    confirmLabel="Sí, recibí todo"
                  >
                    {t.action === "confirmar_recepcion" ? "Recibí todo · liberar pago al vendedor" : t.label}
                  </SubmitButton>
                </form>
              );
            })}

            {canRefund && (
              <form action={requestRefund} className="space-y-2 border-t border-line pt-4">
                <input type="hidden" name="order_id" value={o.id} />
                <p className="text-sm font-medium">
                  {role === "vendedor" ? "¿No podés entregar? Devolvé el dinero al comprador." : "Reembolso total al comprador"}
                </p>
                <textarea name="note" required rows={2} className="input" placeholder="Motivo del reembolso" />
                <SubmitButton className="btn-danger" danger confirmTitle="Reembolsar la orden" confirmLabel="Sí, reembolsar" confirm="Se devuelve el total al comprador. No se puede deshacer.">
                  Reembolsar <Money cents={Number(o.price_cents)} />
                </SubmitButton>
              </form>
            )}

            {canReview && (
              <form action={leaveReview} className="space-y-3 border-t border-line pt-4">
                <input type="hidden" name="order_id" value={o.id} />
                <p className="text-sm font-medium">¿Cómo fue tu experiencia con {o.seller?.display_name}?</p>
                <div className="star-input flex flex-row-reverse justify-end gap-1 text-3xl">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <label key={n} className="cursor-pointer text-muted/40 transition" title={`${n} estrella${n === 1 ? "" : "s"}`}>
                      <input type="radio" name="rating" value={n} required className="sr-only" />★
                    </label>
                  ))}
                </div>
                <textarea name="body" rows={2} maxLength={1000} className="input" placeholder="Contá cómo fue la entrega (opcional)" />
                <SubmitButton>Publicar reseña</SubmitButton>
              </form>
            )}
            {review.data && (
              <div className="rounded-xl border border-line bg-bg-2/60 p-3 text-sm">
                <p className="text-muted">Reseña del comprador</p>
                <Stars value={review.data.rating} /> {review.data.body && <p className="mt-1">{review.data.body}</p>}
                {review.data.seller_reply ? (
                  <p className="mt-2 border-l-2 border-gold/50 pl-3 text-muted"><span className="font-semibold text-gold-2">Respuesta del vendedor:</span> {review.data.seller_reply}</p>
                ) : role === "vendedor" ? (
                  <form action={replyReview} className="mt-3 flex gap-2">
                    <input type="hidden" name="review_id" value={review.data.id} />
                    <input type="hidden" name="back" value={`/ordenes/${o.id}`} />
                    <input name="body" required maxLength={1000} className="input" placeholder="Respondé la reseña (opcional)" />
                    <SubmitButton className="btn-ghost shrink-0">Responder</SubmitButton>
                  </form>
                ) : null}
              </div>
            )}
          </section>

          {(autoItems.data ?? []).length > 0 && (
            <section className="card animate-fade-up border-gold/40">
              <h2 className="h2">⚡ Contenido entregado</h2>
              <p className="mt-1 text-sm text-muted">
                {role === "comprador" ? "Esto es lo que compraste. Cambiá las contraseñas apenas ingreses y confirmá la recepción si todo está bien." : "Entregado automáticamente al comprador."}
              </p>
              <ul className="mt-3 space-y-2">
                {(autoItems.data ?? []).map((it) => (
                  <li key={it.id} className="rounded-xl border border-line bg-bg-2 p-3">
                    <pre className="font-mono text-sm break-all whitespace-pre-wrap text-gold-2 select-all">{it.content}</pre>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {dispute.data && (
            <section className="card border-crimson/40">
              <h2 className="h2">Reclamo {dispute.data.status === "abierto" ? "abierto" : "resuelto"}</h2>
              <p className="mt-2 text-sm whitespace-pre-line">{dispute.data.reason}</p>
              <p className="mt-1 text-xs text-muted">Abierto el {formatDate(dispute.data.created_at)}</p>
              {dispute.data.status === "resuelto" && (
                <p className="mt-3 rounded-lg bg-bg-2 p-3 text-sm">
                  <strong>{dispute.data.resolution === "a_favor_vendedor" ? "Resuelto a favor del vendedor" : "Reembolso al comprador"}</strong>
                  {dispute.data.resolution_note ? ` — ${dispute.data.resolution_note}` : ""}
                </p>
              )}
            </section>
          )}

          {evidenceWithUrls.length > 0 && (
            <section className="card">
              <h2 className="h2 mb-2">Evidencia de entrega</h2>
              <ul className="space-y-3 text-sm">
                {evidenceWithUrls.map((e) => (
                  <li key={e.id} className="rounded-lg bg-bg-2 p-3">
                    <p className="whitespace-pre-line">{e.description}</p>
                    <p className="mt-1 text-xs text-muted">
                      {formatDate(e.created_at)}
                      {e.url && <> · <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-gold underline">Ver archivo</a></>}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="mensajes" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="h2">Chat con {role === "vendedor" ? o.buyer?.display_name : o.seller?.display_name}</h2>
              {conversationId && <Link href={`/mensajes/${conversationId}`} className="text-sm text-gold hover:text-gold-2">Abrir en Mensajes →</Link>}
            </div>
            {conversationId ? (
              <ChatBox conversationId={conversationId} me={s.userId} names={names} initial={messages} height="h-[55vh] min-h-[420px]" />
            ) : (
              <p className="card text-sm text-muted">El chat no está disponible para esta orden.</p>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card text-sm">
            <h2 className="h2 mb-3">Importes</h2>
            <dl className="space-y-1.5">
              <Row label={<>{formatQty(o.quantity, unit, plural)} × <Money cents={Number(o.unit_price_cents)} /></>} value={<Money cents={Number(o.price_cents)} />} strong />
              {role !== "comprador" && (
                <>
                  <Row label={`Comisión Argenpay (${o.commission_bps / 100}%)`} value={<>−<Money cents={Number(o.commission_cents)} /></>} />
                  {o.processor_fee_policy === "vendedor_absorbe" ? (
                    <Row label={`Cargo procesador (${o.processor_fee_bps / 100}%)`} value={<>−<Money cents={Number(o.processor_fee_cents)} /></>} />
                  ) : role === "admin" ? (
                    <Row label={`Cargo procesador (${o.processor_fee_bps / 100}%, absorbe plataforma)`} value={<Money cents={Number(o.processor_fee_cents)} />} />
                  ) : null}
                  <Row label="Neto vendedor" value={<Money cents={Number(o.seller_net_cents)} />} strong />
                  {role === "admin" && <Row label="Neto plataforma" value={<Money cents={Number(o.platform_net_cents)} />} />}
                </>
              )}
            </dl>
            <p className="hint mt-3">Importes fijados al crear la orden. Redondeo al centavo, mitad hacia arriba.</p>
          </section>

          <section className="card text-sm">
            <h2 className="h2 mb-3">Datos</h2>
            <dl className="space-y-1.5">
              <div className="grid grid-cols-2 gap-3 pb-2">
                <div><p className="mb-1 text-xs text-muted">Comprador</p><UserCell user={o.buyer} /></div>
                <div><p className="mb-1 text-xs text-muted">Vendedor</p><UserCell user={o.seller} /></div>
              </div>
              {o.payment_provider === "manual" ? (
                <Row label="Medio de pago" value="Transferencia (verificada a mano)" />
              ) : (
                o.paid_with && <Row label="Medio de pago" value={o.paid_with === "saldo" ? "Saldo de Argenpay" : "Procesador"} />
              )}
              <Row label="Pago confirmado" value={formatDate(o.paid_at)} />
              <Row label="Entrega estimada hasta" value={formatDate(o.delivery_due_at)} />
              <Row label="Entregado" value={formatDate(o.delivered_at)} />
              {o.auto_confirm_at && o.status === "entregado" && <Row label="Confirmación automática" value={formatDate(o.auto_confirm_at)} />}
              <Row label="Confirmado" value={formatDate(o.confirmed_at)} />
            </dl>
            <Link href={`/ofertas/${o.listing_id}`} className="mt-3 inline-block text-gold hover:text-gold-2">Ver publicación →</Link>
          </section>

          <section className="card text-sm">
            <h2 className="h2 mb-3">Registro de eventos</h2>
            <ol className="space-y-3 border-l border-gold/30 pl-4">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full bg-gold shadow-[0_0_8px_rgb(217_171_82/0.8)]" />
                  <p className="font-medium">
                    {e.to_status && e.to_status !== e.from_status ? STATUS_LABELS[e.to_status as OrderStatus] : e.event_type.replaceAll("_", " ")}
                  </p>
                  <p className="text-xs text-muted">{ROLE_LABEL[e.actor_role]} · {formatDate(e.created_at)}</p>
                  {e.note && <p className="mt-0.5 text-xs whitespace-pre-line">{e.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "font-semibold text-gold-2" : ""}>{value}</dd>
    </div>
  );
}

function NextStepText({ o, role }: { o: Order; role: Actor }) {
  const t: Partial<Record<OrderStatus, Partial<Record<Actor, string>>>> = {
    pendiente_pago: { comprador: "Pagá la orden para que el vendedor pueda entregar.", vendedor: "Esperando el pago del comprador. No entregues nada todavía." },
    pago_confirmado: { comprador: "El pago está confirmado. Coordiná la entrega en el juego por el chat (nick, horario, ciudad).", vendedor: "Pago confirmado: coordiná la entrega por el chat (trade, correo o tienda privada)." },
    entrega_en_curso: { comprador: "El vendedor está haciendo la entrega en el juego.", vendedor: "Cuando termines, marcá la orden como entregada con evidencia (captura del trade o del correo)." },
    entregado: { comprador: "Revisá en el juego lo recibido. Cuando confirmes, se libera el pago al vendedor. Si algo no coincide, abrí un reclamo antes de la confirmación automática.", vendedor: "Esperando que el comprador confirme la recepción para liberar tu pago." },
    confirmado: { comprador: "Operación confirmada. ¡Gracias!", vendedor: "Operación confirmada. Tu neto se está liberando." },
    en_reclamo: { comprador: "Un administrador está revisando el reclamo y el chat.", vendedor: "El comprador abrió un reclamo. Respondé por el chat con toda la información." },
    reembolsado: { comprador: "Se registró el reembolso total.", vendedor: "La orden fue reembolsada al comprador." },
    cancelado: { comprador: "La orden fue cancelada.", vendedor: "La orden fue cancelada." },
    liquidado: { comprador: "Operación cerrada. ¡Gracias por comprar en Argenpay!", vendedor: "El pago se liberó: tu neto ya está en tu saldo." },
  };
  if (o.payment_mode === "manual" && o.status === "pendiente_pago" && role === "comprador") {
    return <p className="text-sm text-muted">Pagá con tu saldo al instante, o transferí el importe a los datos de abajo y avisá el pago con el comprobante (un administrador lo verifica). Hasta que el pago esté confirmado el vendedor no entrega.</p>;
  }
  const text = t[o.status]?.[role] ?? `Estado: ${STATUS_LABELS[o.status]}.`;
  return <p className="text-sm text-muted">{text}</p>;
}
