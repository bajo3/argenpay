import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con service_role: saltea RLS. SOLO en el servidor, y solo para operaciones
 * que ya fueron autorizadas (webhooks verificados, acciones de admin validadas, cron).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
