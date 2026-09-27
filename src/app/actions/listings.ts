"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { LU4_SLUG } from "@/lib/catalog";
import { EQUIPMENT, RACES } from "@/lib/lu4";
import { parseARSToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { done, fail, safeNext, str } from "./helpers";

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
  const autoDelivery = formData.get("auto_delivery") === "on";
  const stock = autoDelivery ? 0 : Number(str(formData, "stock") || "0");
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
  const equipment = str(formData, "char_equipment");
  const levelRaw = str(formData, "char_level");
  const level = levelRaw ? Number(levelRaw) : null;
  if (isAccount && race && !RACES.some((r) => r.value === race)) fail(back, "Raza inválida");
  if (isAccount && equipment && !EQUIPMENT.some((e) => e.value === equipment)) fail(back, "Equipo inválido");
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
    char_equipment: isAccount && equipment ? equipment : null,
  };
}

function dbError(msg: string) {
  if (msg.includes("foreign key") && msg.includes("server")) return "El servidor elegido no corresponde a LU4";
  if (msg.includes("vendedor")) return msg;
  return "No se pudo guardar la publicación";
}

export async function createListing(formData: FormData) {
  const s = await requireUser("/panel/vendedor");
  const back = safeNext(formData.get("back"), "/publicar");
  const values = await parseListing(formData, back);
  const autoDelivery = formData.get("auto_delivery") === "on";
  const items = str(formData, "delivery_items").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (autoDelivery && !items.length) fail(back, "Cargá al menos un ítem para la entrega automática (uno por línea)");
  if (items.some((i) => i.length > 2000)) fail(back, "Cada ítem de entrega puede tener hasta 2000 caracteres");
  const supabase = await createClient();
  const { data, error } = await supabase.from("listings").insert({ ...values, seller_id: s.userId }).select("id").single();
  if (error) fail(back, dbError(error.message));
  if (autoDelivery) {
    const { error: itemsError } = await supabase.rpc("add_delivery_items", { p_listing_id: data.id, p_items: items });
    if (itemsError) {
      await supabase.from("listings").update({ status: "eliminada" }).eq("id", data.id);
      fail(back, itemsError.message);
    }
  }
  revalidatePath("/", "layout");
  redirect(`/ofertas/${data.id}?ok=${encodeURIComponent("¡Publicado! Ya está visible en el mercado.")}`);
}

export async function updateListing(formData: FormData) {
  await requireUser("/panel/vendedor");
  const id = str(formData, "id");
  const back = `/panel/vendedor/publicaciones/${id}`;
  const values = await parseListing(formData, back);
  const supabase = await createClient();
  const { data: current } = await supabase.from("listings").select("auto_delivery").eq("id", id).maybeSingle();
  // Con entrega automática, el stock lo determinan los ítems cargados.
  const update: Partial<typeof values> = { ...values };
  if (current?.auto_delivery) delete update.stock;
  // RLS garantiza que solo el dueño pueda editar.
  const { data, error } = await supabase.from("listings").update(update).eq("id", id).select("id");
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
  if (error) fail("/panel/vendedor?tab=ofertas", "No se pudo actualizar la oferta");
  revalidatePath("/panel/vendedor");
  done("/panel/vendedor?tab=ofertas", status === "activa" ? "Oferta activada" : status === "pausada" ? "Oferta pausada" : "Oferta eliminada");
}

export async function addDeliveryItems(formData: FormData) {
  await requireUser("/panel/vendedor");
  const id = str(formData, "listing_id");
  const back = `/panel/vendedor/publicaciones/${id}`;
  const items = str(formData, "items").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!items.length) fail(back, "Escribí al menos un ítem (uno por línea)");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_delivery_items", { p_listing_id: id, p_items: items });
  if (error) fail(back, error.message);
  revalidatePath(back);
  done(back, `Se agregaron ${data} ítems a la entrega automática`);
}

export async function removeDeliveryItem(formData: FormData) {
  await requireUser("/panel/vendedor");
  const id = str(formData, "listing_id");
  const back = `/panel/vendedor/publicaciones/${id}`;
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_delivery_item", { p_item_id: Number(str(formData, "item_id")) });
  if (error) fail(back, error.message);
  revalidatePath(back);
  done(back, "Ítem quitado");
}

/** "Subir ofertas": pone primeras todas las ofertas activas del vendedor en una categoría (cada 4 horas). */
export async function bumpListings(formData: FormData) {
  await requireUser("/panel/vendedor");
  const back = "/panel/vendedor?tab=ofertas";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bump_listings", { p_category_id: str(formData, "category_id") });
  if (error) fail(back, error.message);
  revalidatePath("/", "layout");
  done(back, `¡Listo! Subiste ${data} oferta${data === 1 ? "" : "s"} al principio del listado`);
}
