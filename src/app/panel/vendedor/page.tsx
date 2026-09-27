import type { Metadata } from "next";
import Link from "next/link";
import { setListingStatus } from "@/app/actions/listings";
import { OrdersTable, type OrderListRow } from "@/components/orders-table";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState, Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatARS } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Panel de vendedor" };

export default async function SellerPanel(props: PageProps<"/panel/vendedor">) {
  const sp = await props.searchParams;
  const s = await requireUser("/panel/vendedor");

  if (!s.profile.is_seller) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState title="Todavía no sos vendedor" href="/cuenta" cta="Activar perfil de vendedor">
          Activá tu perfil de vendedor para publicar ofertas y recibir órdenes.
        </EmptyState>
      </div>
    );
  }

  const supabase = await createClient();
  const [listingsRes, ordersRes, payoutRes] = await Promise.all([
    supabase
      .from("listings")
      .select("id, title, price_cents, stock, status, server:game_servers(name), category:categories(name, unit_label_plural)")
      .eq("seller_id", s.userId)
      .neq("status", "eliminada")
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("id, status, price_cents, seller_net_cents, commission_cents, quantity, created_at, listing_snapshot, buyer:profiles!orders_buyer_id_fkey(display_name)")
      .eq("seller_id", s.userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("seller_payout_accounts").select("seller_id").eq("seller_id", s.userId).maybeSingle(),
  ]);

  const listings = (listingsRes.data ?? []) as unknown as {
    id: string; title: string; price_cents: number; stock: number; status: string; server: { name: string } | null; category: { name: string; unit_label_plural: string } | null;
  }[];
  const orders = (ordersRes.data ?? []).map((o) => ({
    ...o,
    counterpart: (o.buyer as unknown as { display_name: string } | null)?.display_name ?? null,
  })) as unknown as OrderListRow[];

  const sum = (st: string[]) => orders.filter((o) => st.includes(o.status)).reduce((a, o) => a + Number(o.seller_net_cents), 0);
  const toDeliver = orders.filter((o) => ["pago_confirmado", "entrega_en_curso"].includes(o.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">Panel de vendedor</h1>
        <Link href="/panel/vendedor/publicaciones/nueva" className="btn-primary shine">+ Publicar lote</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      {!payoutRes.data && (
        <div className="rounded-xl border border-amber-500/30 bg-warn-bg px-4 py-3 text-sm text-warn-ink">
          Cargá tus <Link href="/cuenta" className="font-semibold underline">datos de cobro</Link> para poder recibir liquidaciones.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card"><p className="text-sm text-muted">Para entregar</p><p className="text-2xl font-bold">{toDeliver}</p></div>
        <div className="card"><p className="text-sm text-muted">En curso (neto)</p><p className="text-xl font-bold">{formatARS(sum(["pago_confirmado", "entrega_en_curso", "entregado", "en_reclamo"]))}</p></div>
        <div className="card"><p className="text-sm text-muted">A liquidar</p><p className="text-xl font-bold">{formatARS(sum(["confirmado"]))}</p></div>
        <div className="card"><p className="text-sm text-muted">Liquidado</p><p className="text-xl font-bold text-ok">{formatARS(sum(["liquidado"]))}</p></div>
      </div>

      <section className="space-y-3">
        <h2 className="h2">Ventas</h2>
        {orders.length ? <OrdersTable rows={orders} amount="net" /> : <EmptyState title="Todavía no tenés ventas" />}
      </section>

      <section className="space-y-3">
        <h2 className="h2">Mis publicaciones</h2>
        {listings.length ? (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface/80">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="px-4 py-3">Título</th><th className="px-4 py-3">Precio</th><th className="px-4 py-3">Disp.</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3" /></tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <Link href={`/ofertas/${l.id}`} className="font-medium hover:text-brand">{l.title}</Link>
                      <p className="text-xs text-muted">{l.server?.name ?? "Todos"} · {l.category?.name}</p>
                    </td>
                    <td className="px-4 py-3">{formatARS(Number(l.price_cents))}</td>
                    <td className="px-4 py-3">{new Intl.NumberFormat("es-AR").format(l.stock)} {l.category?.unit_label_plural}</td>
                    <td className="px-4 py-3 capitalize">{l.status}</td>
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
                          <SubmitButton className="btn-danger px-3 py-1.5" confirm="¿Eliminar esta publicación?">Eliminar</SubmitButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No tenés publicaciones" href="/panel/vendedor/publicaciones/nueva" cta="Crear publicación" />
        )}
      </section>
    </div>
  );
}
