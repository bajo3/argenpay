import type { Metadata } from "next";
import Link from "next/link";
import { Flash } from "@/components/ui";

export const metadata: Metadata = { title: "Publicar" };

const OPTIONS = [
  { href: "/publicar/cuenta", title: "Publicar cuenta", desc: "Personajes con raza, clase, nivel y equipo.", icon: "♜" },
  { href: "/publicar/adena", title: "Publicar adena", desc: "Vendé por kk, con compra mínima y entrega por servidor.", icon: "◈" },
  { href: "/publicar/item", title: "Publicar ítem", desc: "Armas, armaduras, joyas, recetas y materiales.", icon: "⚔" },
  { href: "/publicar/coins", title: "Publicar coins", desc: "Moneda de donación del servidor.", icon: "◉" },
  { href: "/publicar/servicio", title: "Publicar servicio", desc: "Boosting, leveo, quests de profesión, farm o acompañamiento.", icon: "✦" },
  { href: "/publicar/otro", title: "Publicar otro", desc: "Todo lo que no entra en las demás categorías.", icon: "✚" },
];

export default async function PublishIndex(props: PageProps<"/publicar">) {
  const sp = await props.searchParams;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="animate-fade-up">
        <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">Lineage 2 LU4</p>
        <h1 className="h1 mt-1">¿Qué querés vender?</h1>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OPTIONS.map((o, i) => (
          <Link key={o.href} href={o.href} className="card card-hover animate-fade-up group flex items-start gap-4 p-6" style={{ "--i": i } as React.CSSProperties}>
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-gold/30 bg-gold/10 text-2xl text-gold-2 transition group-hover:scale-110 group-hover:rotate-6">
              {o.icon}
            </span>
            <span>
              <span className="block font-display text-xl font-bold group-hover:text-gold-2">{o.title}</span>
              <span className="mt-1 block text-sm text-muted">{o.desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
