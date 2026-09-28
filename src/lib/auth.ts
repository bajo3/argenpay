import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface Profile {
  id: string;
  display_name: string;
  is_seller: boolean;
  is_admin: boolean;
  avatar_url: string | null;
  created_at: string;
}

/**
 * Sesión + perfil, una sola vez por request (el encabezado y la página comparten el resultado).
 * getClaims verifica el JWT localmente con la clave pública del proyecto (sin ida y vuelta a Auth).
 */
export const getSessionProfile = cache(async (): Promise<{ userId: string; email: string | null; profile: Profile } | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, is_seller, is_admin, avatar_url, created_at")
    .eq("id", claims.sub)
    .single();
  if (!profile) return null;
  return { userId: claims.sub, email: typeof claims.email === "string" ? claims.email : null, profile: profile as Profile };
});

export async function requireUser(next = "/") {
  const s = await getSessionProfile();
  if (!s) redirect(`/ingresar?siguiente=${encodeURIComponent(next)}`);
  return s;
}

export async function requireAdmin() {
  const s = await requireUser("/admin");
  if (!s.profile.is_admin) redirect("/");
  return s;
}
