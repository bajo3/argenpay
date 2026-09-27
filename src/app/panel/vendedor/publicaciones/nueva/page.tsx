import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createListing } from "@/app/actions/listings";
import { ListingForm } from "@/components/listing-form";
import { Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getCatalog } from "@/lib/catalog";
import { getPlatformSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Publicar lote" };

export default async function NewListingPage(props: PageProps<"/panel/vendedor/publicaciones/nueva">) {
  const sp = await props.searchParams;
  const s = await requireUser("/panel/vendedor/publicaciones/nueva");
  if (!s.profile.is_seller) redirect("/cuenta?error=" + encodeURIComponent("Activá tu perfil de vendedor para publicar"));
  const [catalog, settings] = await Promise.all([getCatalog(), getPlatformSettings()]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="animate-fade-up">
        <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">Lineage 2 LU4</p>
        <h1 className="h1 mt-1">Publicar un lote</h1>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <ListingForm action={createListing} servers={catalog.servers} categories={catalog.categories} fees={settings} />
    </div>
  );
}
