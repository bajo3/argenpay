"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fail } from "./helpers";

/** Abre un chat con el equipo de soporte (el primer administrador de la plataforma). */
export async function contactSupport() {
  const s = await requireUser("/soporte");
  const db = createAdminClient();
  const { data: admins } = await db
    .from("profiles")
    .select("id")
    .eq("is_admin", true)
    .neq("id", s.userId)
    .order("created_at")
    .limit(1);
  const admin = admins?.[0];
  if (!admin) fail("/soporte", s.profile.is_admin ? "Sos administrador: las consultas de soporte te llegan a Mensajes." : "El soporte no está disponible en este momento");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_conversation", { p_other: admin.id });
  if (error) fail("/soporte", error.message);
  redirect(`/mensajes/${data}`);
}
