import type { Metadata } from "next";
import Link from "next/link";
import { savePayoutAccount, updateProfile } from "@/app/actions/account";
import { AvatarUploader } from "@/components/avatar-uploader";
import { SellerGate } from "@/components/seller-gate";
import { Stars } from "@/components/seller-badge";
import { SubmitButton } from "@/components/submit-button";
import { Flash, formatDate } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getRatings } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function AccountPage(props: PageProps<"/cuenta">) {
  const sp = await props.searchParams;
  const s = await requireUser("/cuenta");
  const supabase = await createClient();
  const [{ data: payout }, ratings] = await Promise.all([
    supabase.from("seller_payout_accounts").select("holder_name, tax_id, cbu_or_alias").eq("seller_id", s.userId).maybeSingle(),
    getRatings([s.userId]),
  ]);
  const rating = ratings[s.userId];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="h1 animate-fade-up">Mi cuenta</h1>
      <Flash error={sp.error} ok={sp.ok} />

      <section className="card animate-fade-up space-y-6">
        <AvatarUploader userId={s.userId} name={s.profile.display_name} url={s.profile.avatar_url} />
        <div className="grid gap-3 rounded-xl border border-line bg-bg-2/60 p-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">Email</p>
            <p className="truncate font-medium">{s.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Miembro desde</p>
            <p className="font-medium">{formatDate(s.profile.created_at).split(" ")[0]}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Reputación</p>
            <p className="font-medium">
              {rating ? <><Stars value={rating.rating_avg} size="text-xs" /> {rating.rating_avg.toFixed(1)} ({rating.reviews_count})</> : "Sin reseñas"}
            </p>
          </div>
        </div>
        <form action={updateProfile} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="label" htmlFor="display_name">Nombre visible</label>
            <input id="display_name" name="display_name" defaultValue={s.profile.display_name} minLength={2} maxLength={40} className="input" />
          </div>
          <SubmitButton>Guardar</SubmitButton>
        </form>
        <Link href={`/vendedores/${s.userId}`} className="inline-block text-sm text-gold hover:text-gold-2">Ver mi perfil público y reseñas →</Link>
      </section>

      {!s.profile.is_seller ? (
        <SellerGate next="/cuenta" />
      ) : (
        <form action={savePayoutAccount} className="card animate-fade-up space-y-4" style={{ "--i": 1 } as React.CSSProperties}>
          <h2 className="h2">Datos de cobro</h2>
          <p className="text-sm text-muted">
            Solo vos y el equipo de administración pueden ver estos datos. Se usan para enviarte los retiros de tu saldo.
          </p>
          <div>
            <label className="label" htmlFor="holder_name">Titular</label>
            <input id="holder_name" name="holder_name" defaultValue={payout?.holder_name ?? ""} className="input" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="tax_id">CUIT / CUIL</label>
              <input id="tax_id" name="tax_id" defaultValue={payout?.tax_id ?? ""} className="input" inputMode="numeric" required />
            </div>
            <div>
              <label className="label" htmlFor="cbu_or_alias">CBU / CVU o alias</label>
              <input id="cbu_or_alias" name="cbu_or_alias" defaultValue={payout?.cbu_or_alias ?? ""} className="input" required />
            </div>
          </div>
          <SubmitButton>Guardar datos de cobro</SubmitButton>
        </form>
      )}
    </div>
  );
}
