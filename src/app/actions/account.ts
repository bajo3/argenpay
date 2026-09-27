"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { done, fail, safeNext, str } from "./helpers";

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

/** Guarda la URL pública de la foto de perfil (la base valida que sea del bucket y carpeta propios). */
export async function setAvatar(url: string): Promise<{ error?: string }> {
  const s = await requireUser("/cuenta");
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatares/${s.userId}/`;
  if (typeof url !== "string" || !url.startsWith(base) || url.length > 500) return { error: "Imagen inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", s.userId);
  if (error) return { error: "No se pudo guardar la foto" };
  revalidatePath("/", "layout");
  return {};
}

export async function removeAvatar(): Promise<void> {
  const s = await requireUser("/cuenta");
  const supabase = await createClient();
  await supabase.from("profiles").update({ avatar_url: null }).eq("id", s.userId);
  revalidatePath("/", "layout");
}

export async function activateSeller(formData: FormData) {
  const next = safeNext(formData.get("siguiente"), "/publicar");
  await requireUser(next);
  if (formData.get("acepto_vendedor") !== "on") fail(next, "Tenés que aceptar las condiciones para vendedores");
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_seller");
  if (error) fail(next, error.message);
  revalidatePath("/", "layout");
  done(next, "¡Listo! Ya podés publicar ofertas");
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
