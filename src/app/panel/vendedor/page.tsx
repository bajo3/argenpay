import type { Metadata } from "next";
import Link from "next/link";
import { bumpListings, setListingStatus } from "@/app/actions/listings";
import { PUBLISH_OPTIONS } from "@/components/header";
import { OrdersFilters, OrdersHistory } from "@/components/orders-history";
import { SellerGate } from "@/components/seller-gate";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState, Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatARS } from "@/lib/money";
import { listMyOrders } from "@/lib/orders/list";
import { createClient } from "@/lib/supabase/server";
import { getMyWallet } from "@/lib/wallet";

export const metadata: Metadata = { title: "Mis ventas" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUS_LABEL: Record<string, string> = { activa: "Activa", pausada: "Pausada" };

export default async function SellerPanel(props: PageProps<"/panel/vendedor">) {
  const sp = await props.searchParams;
  const s = await requireUser("/panel/vendedor");
  const tab = one(sp.tab) === "ofertas" ? "ofertas" : "ventas";

  if (!s.profile.is_seller) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="h1">Vender en Argenpay</h1>
        <Flash error={sp.error} ok={sp.ok} />
        <SellerGate next="/publicar" />
      </div>
    );
  }

  const values = { code: one(sp.orden), user: one(sp.usuario), status: one(sp.estado) };
  const supabase = await createClient();
  const [orders, listingsRes, wallet, payoutRes] = await Promise.all([
    listMyOrders(s.userId, "vendedor", values),
    supabase
      .from("listings")
      .select("id, title, price_cents, stock, status, auto_delivery, bumped_at, category_id, server:game_servers(name), category:categories(name, unit_label, unit_label_plural)")
      .eq("seller_id", s.userId)
      .neq("status", "eliminada")
      .order("created_at", { ascending: false }),
    getMyWallet(),
    supabase.from("seller_payout_accounts").select("seller_id").eq("seller_id", s.userId).maybeSingle(),
  ]);
  const listings = (listingsRes.data ?? []) as unknown as {
    id: string; title: string; price_cents: number; stock: number; status: string; auto_delivery: boolean; bumped_at: string; category_id: string;
    server: { name: string } | null; category: { name: string; unit_label: string; unit_label_plural: string } | null;
  }[];
  const toDeliver = orders.filter((o) => ["pago_confirmado", "entrega_en_curso"].includes(o.status)).length;
  const exportQuery = new URLSearchParams({ rol: "ventas", orden: values.code, usuario: values.user, estado: values.status }).toString();

  return (
    <div className="space-y-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-3">
        <h1 className="h1">Mis ventas</h1>
        <div className="flex flex-wrap gap-2">
          {PUBLISH_OPTIONS.map((o) => (
            <Link key={o.href} href={o.href} className="btn-ghost px-3 py-2 text-xs sm:text-sm">
              <span className="text-gold-2">{o.icon}</span> {o.label}
            </Link>
          ))}
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      {!payoutRes.data && (
        <div className="rounded-xl border border-gold/30 bg-warn-bg px-4 py-3 text-sm text-warn-ink">
          Cargá tus <Link href="/cuenta" className="font-semibold underline">datos de cobro</Link> para poder retirar tu saldo.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card animate-fade-up">
          <p className="text-sm text-muted">Para entregar</p>
          <p className={`font-display text-2xl font-bold ${toDeliver ? "text-gold-2" : ""}`}>{toDeliver}</p>
        </div>
        <div className="card animate-fade-up" style={{ "--i": 1 } as React.CSSProperties}>
          <p className="text-sm text-muted">Esperando confirmación</p>
          <p className="font-display text-xl font-bold">{formatARS(wallet?.pendingSales ?? 0)}</p>
        </div>
        <Link href="/saldo" className="card card-hover animate-fade-up border-gold/30" style={{ "--i": 2 } as React.CSSProperties}>
          <p className="text-sm text-muted">Saldo disponible</p>
          <p className="font-display text-xl font-bold text-gold-2">{formatARS(wallet?.available ?? 0)}</p>
        </Link>
        <div className="card animate-fade-up" style={{ "--i": 3 } as React.CSSProperties}>
          <p className="text-sm text-muted">Ofertas activas</p>
          <p className="font-display text-2xl font-bold">{listings.filter((l) => l.status === "activa").length}</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-line">
        {[
          ["ventas", `Ventas (${orders.length})`],
          ["ofertas", `Mis ofertas (${listings.length})`],
        ].map(([k, label]) => (
          <Link
            key={k}
            href={k === "ventas" ? "/panel/vendedor" : "/panel/vendedor?tab=ofertas"}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition ${tab === k ? "border-gold text-gold-2" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "ventas" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <OrdersFilters base="/panel/vendedor" role="vendedor" values={values} />
            <a href={`/api/exportar-ordenes?${exportQuery}`} className="btn-ghost">⤓ Exportar</a>
          </div>
          <OrdersHistory rows={orders} role="vendedor" />
        </section>
      ) : listings.length ? (
        <div className="space-y-4">
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <div className="mr-auto">
            <p className="font-semibold">Subir ofertas</p>
            <p className="text-xs text-muted">Pone tus ofertas activas primeras en el listado de esa categoría. Podés hacerlo cada 4 horas.</p>
          </div>
          {[...new Map(listings.filter((l) => l.status === "activa").map((l) => [l.category_id, l])).values()].map((l) => (
            <form key={l.category_id} action={bumpListings}>
              <input type="hidden" name="category_id" value={l.category_id} />
              <SubmitButton className="btn-ghost px-3 py-2 text-sm" pendingText="Subiendo…">↑ {l.category?.name}</SubmitButton>
            </form>
          ))}
        </div>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface/80">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-2/60 text-left text-xs tracking-wide text-muted uppercase">
              <tr><th className="px-4 py-3">Oferta</th><th className="px-4 py-3">Precio</th><th className="px-4 py-3">Disponible</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.id} className="border-t border-line hover:bg-gold/[0.04]">
                  <td className="px-4 py-3">
                    <Link href={`/ofertas/${l.id}`} className="font-medium hover:text-gold-2">{l.auto_delivery && <span className="mr-1 text-gold-2" title="Entrega automática">⚡</span>}{l.title}</Link>
                    <p className="text-xs text-muted">{l.server?.name ?? "Todos"} · {l.category?.name}</p>
                  </td>
                  <td className="px-4 py-3">{formatARS(Number(l.price_cents))}<span className="text-xs text-muted">/{l.category?.unit_label}</span></td>
                  <td className="px-4 py-3">{new Intl.NumberFormat("es-AR").format(l.stock)} {l.category?.unit_label_plural}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${l.status === "activa" ? "border-ok/30 bg-ok/10 text-ok" : "border-muted/30 text-muted"}`}>
                      {STATUS_LABEL[l.status] ?? l.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link href={`/panel/vendedor/publicaciones/${l.id}`} className="btn-ghost px-3 py-1.5">Editar</Link>
                      <form action={setListingStatus}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="status" value={l.status === "activa" ? "pausada" : "activa"} />
                        <SubmitButton className="btn-ghost px-3 py-1.5">{l.status === "activa" ? "Pausar" : "Activar"}</SubmitButton>
                      </form>
                      <form action={setListingStatus}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="status" value="eliminada" />
                        <SubmitButton className="btn-danger px-3 py-1.5" danger confirmTitle="¿Eliminar esta oferta?" confirmLabel="Sí, eliminar" confirm="La oferta deja de verse en el mercado.">Eliminar</SubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      ) : (
        <EmptyState title="Todavía no publicaste ofertas" href="/publicar" cta="Publicar ahora" />
      )}
    </div>
  );
}
