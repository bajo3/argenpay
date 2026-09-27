import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Enlaces de los emails de Supabase Auth (plantillas en supabase/templates).
 * Soporta token_hash (recomendado: funciona aunque se abra en otro navegador) y code (PKCE).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("siguiente") ?? "";
  const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : null;
  const supabase = await createClient();

  const destination = (t: EmailOtpType | null) => {
    if (safeNext) return `${origin}${safeNext}`;
    if (t === "recovery") return `${origin}/nueva-contrasena`;
    if (t === "email_change") return `${origin}/cuenta?ok=${encodeURIComponent("Email actualizado")}`;
    return `${origin}/?ok=${encodeURIComponent("¡Cuenta confirmada!")}`;
  };

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(destination(type));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(destination(null));
  }
  return NextResponse.redirect(`${origin}/ingresar?error=${encodeURIComponent("El enlace no es válido o venció")}`);
}
