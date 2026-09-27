import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface Profile {
  id: string;
  display_name: string;
  is_seller: boolean;
  is_admin: boolean;
}

export async function getSessionProfile(): Promise<{ userId: string; email: string | null; profile: Profile } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, is_seller, is_admin")
    .eq("id", user.id)
    .single();
  if (!profile) return null;
  return { userId: user.id, email: user.email ?? null, profile: profile as Profile };
}

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
