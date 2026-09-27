"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { LU4_SLUG } from "@/lib/catalog";
import { RACES } from "@/lib/lu4";
import { parseARSToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { done, fail, str } from "./helpers";

async function parseListing(formData: FormData, back: string) {
  const supabase = await createClient();
  const [{ data: game }, { data: categories }] = await Promise.all([
    supabase.from("games").select("id").eq("slug", LU4_SLUG).single(),
    supabase.from("categories").select("id, slug"),
  ]);
  if (!game) fail(back, "El catálogo LU4 no está configurado");

  const title = str(formData, "title");
  const description = str(formData, "description");
  const conditions = str(formData, "conditions");
  const price = parseARSToCents(str(formData, "price"));
  const stock = Number(str(formData, "stock"));
  const minQuantity = Number(str(formData, "min_quantity") || "1");
  const hours = Number(str(formData, "delivery_time_hours"));
  const serverId = str(formData, "server_id") || null;
  const categoryId = str(formData, "category_id");
  const category = (categories ?? []).find((c) => c.id === categoryId);

  if (!category) fail(back, "Elegí una categoría");
  if (title.length < 5 || title.length > 120) fail(back, "El título debe tener entre 5 y 120 caracteres");
  if (description.length < 10) fail(back, "La descripción debe tener al menos 10 caracteres");
  if (price === null || price < 100) fail(back, "Ingresá un precio válido (mínimo $ 1,00)");
  if (!Number.isInteger(stock) || stock < 0 || stock > 10_000_000) fail(back, "La disponibilidad debe ser un número entero");
  if (!Number.isInteger(minQuantity) || minQuantity < 1 || minQuantity > 1_000_000) fail(back, "La compra mínima debe ser un número entero mayor a 0");
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) fail(back, "El tiempo de entrega debe estar entre 1 y 720 horas");
  if (category.slug === "adena" && !serverId) fail(back, "La adena tiene que ser de un servidor");

  const isAccount = category.slug === "cuentas";
  const race = str(formData, "char_race");
  const charClass = str(formData, "char_class");
  const levelRaw = str(formData, "char_level");
  const level = levelRaw ? Number(levelRaw) : null;
  if (isAccount && race && !RACES.some((r) => r.value === race)) fail(back, "Raza inválida");
  if (isAccount && level !== null && (!Number.isInteger(level) || level < 1 || level > 99)) fail(back, "El nivel debe estar entre 1 y 99");
  if (isAccount && charClass && (charClass.length < 2 || charClass.length > 40)) fail(back, "La clase debe tener entre 2 y 40 caracteres");

  return {
    title,
    description,
    conditions,
    price_cents: price,
    stock,
    min_quantity: minQuantity,
    delivery_time_hours: hours,
    game_id: game.id,
    server_id: serverId,
    region_id: null,
    category_id: category.id,
    char_race: isAccount && race ? race : null,
    char_class: isAccount && charClass ? charClass : null,
    char_level: isAccount ? level : null,
  };
}

function dbError(msg: string) {
  if (msg.includes("foreign key") && msg.includes("server")) return "El servidor elegido no corresponde a LU4";
  if (msg.includes("vendedor")) return msg;
  return "No se pudo guardar la publicación";
}

export async function createListing(formData: FormData) {
  const s = await requireUser("/panel/vendedor");
  const back = "/panel/vendedor/publicaciones/nueva";
  const values = await parseListing(formData, back);
  const supabase = await createClient();
  const { data, error } = await supabase.from("listings").insert({ ...values, seller_id: s.userId }).select("id").single();
  if (error) fail(back, dbError(error.message));
  revalidatePath("/", "layout");
  redirect(`/ofertas/${data.id}?ok=${encodeURIComponent("¡Lote publicado!")}`);
}

export async function updateListing(formData: FormData) {
  await requireUser("/panel/vendedor");
  const id = str(formData, "id");
  const back = `/panel/vendedor/publicaciones/${id}`;
  const values = await parseListing(formData, back);
  const supabase = await createClient();
  // RLS garantiza que solo el dueño pueda editar.
  const { data, error } = await supabase.from("listings").update(values).eq("id", id).select("id");
  if (error) fail(back, dbError(error.message));
  if (!data?.length) fail(back, "No encontramos la publicación");
  revalidatePath(`/ofertas/${id}`);
  done(back, "Cambios guardados");
}

export async function setListingStatus(formData: FormData) {
  await requireUser("/panel/vendedor");
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!["activa", "pausada", "eliminada"].includes(status)) fail("/panel/vendedor", "Estado inválido");
  const supabase = await createClient();
  const { error } = await supabase.from("listings").update({ status }).eq("id", id);
  if (error) fail("/panel/vendedor", "No se pudo actualizar la publicación");
  revalidatePath("/panel/vendedor");
  done("/panel/vendedor", status === "activa" ? "Publicación activada" : status === "pausada" ? "Publicación pausada" : "Publicación eliminada");
}
