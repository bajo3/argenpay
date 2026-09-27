import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addDeliveryItems, removeDeliveryItem, updateListing } from "@/app/actions/listings";
import { ListingForm } from "@/components/listing-form";
import { SubmitButton } from "@/components/submit-button";
import { Flash, formatDate } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getCatalog } from "@/lib/catalog";
import { centsToInput } from "@/lib/money";
import { getPlatformSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar oferta" };

export default async function EditListingPage(props: PageProps<"/panel/vendedor/publicaciones/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const s = await requireUser(`/panel/vendedor/publicaciones/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: l } = await supabase.from("listings").select("*").eq("id", id).eq("seller_id", s.userId).maybeSingle();
  if (!l) notFound();
  const [catalog, settings, itemsRes] = await Promise.all([
    getCatalog(),
    getPlatformSettings(),
    supabase
      .from("listing_delivery_items")
      .select("id, content, order_id, delivered_at, created_at")
      .eq("listing_id", id)
      .order("id", { ascending: false })
      .limit(200),
  ]);
  const items = itemsRes.data ?? [];
  const available = items.filter((i) => !i.order_id);
  const delivered = items.filter((i) => i.order_id);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-2">
        <h1 className="h1">Editar oferta</h1>
        <Link href={`/ofertas/${id}`} className="text-sm text-gold hover:text-gold-2">Ver publicación →</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <ListingForm
        action={updateListing}
        servers={catalog.servers}
        categories={catalog.categories}
        fees={settings}
        initial={{
          id: l.id,
          title: l.title,
          description: l.description,
          conditions: l.conditions,
          price: centsToInput(Number(l.price_cents)),
          stock: l.stock,
          min_quantity: l.min_quantity,
          delivery_time_hours: l.delivery_time_hours,
          server_id: l.server_id,
          category_id: l.category_id,
          char_race: l.char_race,
          char_class: l.char_class,
          char_level: l.char_level,
          char_equipment: l.char_equipment,
          auto_delivery: l.auto_delivery,
        }}
      />

      <section className="card space-y-4">
        <div>
          <h2 className="h2">⚡ Entrega automática</h2>
          <p className="mt-1 text-sm text-muted">
            {l.auto_delivery
              ? `Activa · ${available.length} ítem${available.length === 1 ? "" : "s"} disponible${available.length === 1 ? "" : "s"}. Cada línea se entrega a un comprador apenas se confirma su pago.`
              : "Cargá ítems (uno por línea) y el comprador los recibe al instante cuando paga. Al cargarlos, la entrega automática se activa y el stock pasa a ser la cantidad de ítems."}
          </p>
        </div>
        <form action={addDeliveryItems} className="space-y-2">
          <input type="hidden" name="listing_id" value={id} />
          <textarea name="items" rows={4} required className="input font-mono text-xs" placeholder={"Un ítem por línea"} />
          <SubmitButton className="btn-ghost">Agregar ítems</SubmitButton>
        </form>
        {available.length > 0 && (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {available.map((i) => (
              <li key={i.id} className="flex items-center gap-2 rounded-lg border border-line bg-bg-2/60 px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-xs">{i.content}</code>
                <form action={removeDeliveryItem}>
                  <input type="hidden" name="listing_id" value={id} />
                  <input type="hidden" name="item_id" value={i.id} />
                  <SubmitButton className="text-xs text-bad hover:underline" pendingText="…">Quitar</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        {delivered.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Entregados ({delivered.length})</summary>
            <ul className="mt-2 space-y-1">
              {delivered.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-xs text-muted">
                  <code className="truncate">{i.content}</code>
                  <Link href={`/ordenes/${i.order_id}`} className="shrink-0 text-gold">{formatDate(i.delivered_at)}</Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <p className="text-xs text-muted">Los cambios no afectan órdenes ya creadas: cada orden guarda sus importes y datos al momento de la compra.</p>
    </div>
  );
}
