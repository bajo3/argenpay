import type { Metadata } from "next";
import { OrdersFilters, OrdersHistory } from "@/components/orders-history";
import { Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listMyOrders } from "@/lib/orders/list";

export const metadata: Metadata = { title: "Mis compras" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function BuyerPanel(props: PageProps<"/panel/comprador">) {
  const sp = await props.searchParams;
  const s = await requireUser("/panel/comprador");
  const values = { code: one(sp.orden), user: one(sp.usuario), status: one(sp.estado) };
  const [rows, all] = await Promise.all([
    listMyOrders(s.userId, "comprador", values),
    values.code || values.user || values.status ? listMyOrders(s.userId, "comprador", {}) : null,
  ]);
  const base = all ?? rows;
  const count = (st: string[]) => base.filter((o) => st.includes(o.status)).length;
  const exportQuery = new URLSearchParams({ rol: "compras", orden: values.code, usuario: values.user, estado: values.status }).toString();

  return (
    <div className="space-y-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-3">
        <h1 className="h1">Mis compras</h1>
        <a href={`/api/exportar-ordenes?${exportQuery}`} className="btn-ghost">⤓ Exportar</a>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Pendientes de pago", count(["pendiente_pago"])],
          ["En curso", count(["pago_confirmado", "entrega_en_curso"])],
          ["Para confirmar", count(["entregado"])],
          ["En reclamo", count(["en_reclamo"])],
        ].map(([label, n], i) => (
          <div key={label} className="card animate-fade-up" style={{ "--i": i } as React.CSSProperties}>
            <p className="text-sm text-muted">{label}</p>
            <p className={`font-display text-2xl font-bold ${label === "Para confirmar" && Number(n) > 0 ? "text-gold-2" : ""}`}>{n}</p>
          </div>
        ))}
      </div>
      <OrdersFilters base="/panel/comprador" role="comprador" values={values} />
      <OrdersHistory rows={rows} role="comprador" />
    </div>
  );
}
