"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { done, fail, str } from "./helpers";

export async function updateProfile(formData: FormData) {
  const s = await requireUser("/cuenta");
  const name = str(formData, "display_name");
  if (name.length < 2 || name.length > 40) fail("/cuenta", "El nombre visible debe tener entre 2 y 40 caracteres");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", s.userId);
  if (error) fail("/cuenta", "No se pudo guardar el perfil");
  revalidatePath("/", "layout");
  done("/cuenta", "Perfil actualizado");
}

export async function activateSeller(formData: FormData) {
  await requireUser("/cuenta");
  if (formData.get("acepto_vendedor") !== "on") fail("/cuenta", "Tenés que aceptar las condiciones para vendedores");
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_seller");
  if (error) fail("/cuenta", error.message);
  revalidatePath("/", "layout");
  done("/panel/vendedor", "¡Listo! Ya podés publicar ofertas");
}

export async function savePayoutAccount(formData: FormData) {
  const s = await requireUser("/cuenta");
  const holder = str(formData, "holder_name");
  const taxId = str(formData, "tax_id").replace(/[-.\s]/g, "");
  const cbu = str(formData, "cbu_or_alias");
  if (!/^\d{11}$/.test(taxId)) fail("/cuenta", "El CUIT/CUIL debe tener 11 dígitos");
  if (holder.length < 3) fail("/cuenta", "Indicá el titular de la cuenta");
  if (!/^(\d{22}|[a-zA-Z0-9.\-]{6,20})$/.test(cbu)) fail("/cuenta", "Ingresá un CBU/CVU de 22 dígitos o un alias válido");
  const supabase = await createClient();
  const { error } = await supabase
    .from("seller_payout_accounts")
    .upsert({ seller_id: s.userId, holder_name: holder, tax_id: taxId, cbu_or_alias: cbu, updated_at: new Date().toISOString() });
  if (error) fail("/cuenta", "No se pudieron guardar los datos de cobro");
  done("/cuenta", "Datos de cobro guardados");
}
