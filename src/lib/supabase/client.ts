"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Cliente de navegador: solo lecturas bajo RLS, mensajes y subida de evidencias. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
