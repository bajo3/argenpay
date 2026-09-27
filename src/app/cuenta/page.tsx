import type { Metadata } from "next";
import { activateSeller, savePayoutAccount, updateProfile } from "@/app/actions/account";
import { SubmitButton } from "@/components/submit-button";
import { Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function AccountPage(props: PageProps<"/cuenta">) {
  const sp = await props.searchParams;
  const s = await requireUser("/cuenta");
  const supabase = await createClient();
  const { data: payout } = await supabase
    .from("seller_payout_accounts")
    .select("holder_name, tax_id, cbu_or_alias")
    .eq("seller_id", s.userId)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="h1">Mi cuenta</h1>
      <Flash error={sp.error} ok={sp.ok} />

      <form action={updateProfile} className="card space-y-4">
        <h2 className="h2">Perfil</h2>
        <p className="text-sm text-muted">{s.email}</p>
        <div>
          <label className="label" htmlFor="display_name">Nombre visible</label>
          <input id="display_name" name="display_name" defaultValue={s.profile.display_name} className="input" />
        </div>
        <SubmitButton>Guardar</SubmitButton>
      </form>

      {!s.profile.is_seller ? (
        <form action={activateSeller} className="card space-y-4">
          <h2 className="h2">Perfil de vendedor</h2>
          <p className="text-sm text-muted">
            Para publicar ofertas necesitás activar tu perfil de vendedor. Argenpay cobra una comisión del 10% sobre
            cada venta concretada.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="acepto_vendedor" className="mt-1" required />
            <span>
              Declaro que tengo derecho a vender lo que publique, que cumpliré lo ofrecido y que respeto los términos de
              cada juego.
            </span>
          </label>
          <SubmitButton>Activar perfil de vendedor</SubmitButton>
        </form>
      ) : (
        <form action={savePayoutAccount} className="card space-y-4">
          <h2 className="h2">Datos de cobro</h2>
          <p className="text-sm text-muted">
            Solo vos y el equipo de administración pueden ver estos datos. Se usan para liquidar tus ventas.
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
