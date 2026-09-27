import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createListing } from "@/app/actions/listings";
import { ListingForm } from "@/components/listing-form";
import { SellerGate } from "@/components/seller-gate";
import { Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getCatalog } from "@/lib/catalog";
import { getPlatformSettings } from "@/lib/settings";

const TIPOS: Record<string, { slug: string; title: string }> = {
  cuenta: { slug: "cuentas", title: "Publicar cuenta" },
  adena: { slug: "adena", title: "Publicar adena" },
  item: { slug: "items", title: "Publicar ítem" },
  servicio: { slug: "servicios", title: "Publicar servicio" },
};

export async function generateMetadata(props: PageProps<"/publicar/[tipo]">): Promise<Metadata> {
  const { tipo } = await props.params;
  return { title: TIPOS[tipo]?.title ?? "Publicar" };
}

export default async function PublishPage(props: PageProps<"/publicar/[tipo]">) {
  const { tipo } = await props.params;
  const sp = await props.searchParams;
  const def = TIPOS[tipo];
  if (!def) notFound();
  const s = await requireUser(`/publicar/${tipo}`);
  const [catalog, settings] = await Promise.all([getCatalog(), getPlatformSettings()]);
  const category = catalog.categories.find((c) => c.slug === def.slug);
  if (!category) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="animate-fade-up">
        <Link href="/publicar" className="text-sm text-muted hover:text-gold-2">← Qué querés vender</Link>
        <h1 className="h1 mt-2">{def.title}</h1>
        <p className="mt-1 text-sm text-muted">{category.description}</p>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {Object.entries(TIPOS).map(([k, v]) => (
          <Link key={k} href={`/publicar/${k}`} className={`chip shrink-0 ${k === tipo ? "chip-active" : ""}`}>{v.title}</Link>
        ))}
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      {s.profile.is_seller ? (
        <ListingForm
          key={category.id}
          action={createListing}
          servers={catalog.servers}
          categories={catalog.categories}
          fees={settings}
          fixedCategoryId={category.id}
          backPath={`/publicar/${tipo}`}
        />
      ) : (
        <SellerGate next={`/publicar/${tipo}`} />
      )}
    </div>
  );
}
