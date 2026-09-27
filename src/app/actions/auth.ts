"use server";
import { redirect } from "next/navigation";
import { siteUrl } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { fail, safeNext, str } from "./helpers";

export async function signIn(formData: FormData) {
  const next = safeNext(formData.get("siguiente"), "/");
  const email = str(formData, "email");
  const password = str(formData, "password");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail(`/ingresar?siguiente=${encodeURIComponent(next)}`, "Email o contraseña incorrectos");
  redirect(next);
}

export async function signUp(formData: FormData) {
  const email = str(formData, "email");
  const password = str(formData, "password");
  const displayName = str(formData, "display_name");
  if (displayName.length < 2 || displayName.length > 40) fail("/registrarse", "El nombre visible debe tener entre 2 y 40 caracteres");
  if (password.length < 8) fail("/registrarse", "La contraseña debe tener al menos 8 caracteres");
  if (formData.get("acepto") !== "on") fail("/registrarse", "Tenés que aceptar los términos para continuar");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName }, emailRedirectTo: `${siteUrl()}/auth/confirmar` },
  });
  if (error) fail("/registrarse", error.message === "User already registered" ? "Ese email ya está registrado" : "No se pudo crear la cuenta");
  if (!data.session) redirect("/ingresar?ok=" + encodeURIComponent("Te enviamos un email para confirmar tu cuenta"));
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
