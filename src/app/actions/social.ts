"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { done, fail, safeNext, str } from "./helpers";

/** Abre (o retoma) el chat con otro usuario, opcionalmente sobre un lote. */
export async function startChat(formData: FormData) {
  const other = str(formData, "user_id");
  const listing = str(formData, "listing_id") || null;
  const back = listing ? `/ofertas/${listing}` : "/mensajes";
  await requireUser(back);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_conversation", { p_other: other, p_listing: listing });
  if (error) fail(back, error.message);
  redirect(`/mensajes/${data}${listing ? `?lote=${listing}` : ""}`);
}

export async function leaveReview(formData: FormData) {
  const orderId = str(formData, "order_id");
  const back = `/ordenes/${orderId}`;
  await requireUser(back);
  const rating = Number(str(formData, "rating"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_review", { p_order_id: orderId, p_rating: rating, p_body: str(formData, "body") });
  if (error) fail(back, error.message);
  revalidatePath(back);
  done(back, "¡Gracias por tu reseña!");
}

export async function replyReview(formData: FormData) {
  const back = safeNext(formData.get("back"), "/");
  await requireUser(back);
  const supabase = await createClient();
  const { error } = await supabase.rpc("reply_review", { p_review_id: Number(str(formData, "review_id")), p_body: str(formData, "body") });
  if (error) fail(back, error.message);
  revalidatePath(back);
  done(back, "Respuesta publicada");
}
