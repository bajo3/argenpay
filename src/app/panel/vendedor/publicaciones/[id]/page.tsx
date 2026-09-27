import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { updateListing } from "@/app/actions/listings";
import { ListingForm } from "@/components/listing-form";
import { Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getCatalog } from "@/lib/catalog";
import { centsToInput } from "@/lib/money";
import { getPlatformSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar lote" };

export default async function EditListingPage(props: PageProps<"/panel/vendedor/publicaciones/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const s = await requireUser(`/panel/vendedor/publicaciones/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: l } = await supabase.from("listings").select("*").eq("id", id).eq("seller_id", s.userId).maybeSingle();
  if (!l) notFound();
  const [catalog, settings] = await Promise.all([getCatalog(), getPlatformSettings()]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="h1 animate-fade-up">Editar lote</h1>
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
        }}
      />
      <p className="text-xs text-muted">Los cambios no afectan órdenes ya creadas: cada orden guarda sus importes y datos al momento de la compra.</p>
    </div>
  );
}
