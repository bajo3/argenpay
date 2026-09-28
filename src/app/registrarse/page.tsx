import type { Metadata } from "next";
import Link from "next/link";
import { signUp } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth-shell";
import { SubmitButton } from "@/components/submit-button";
import { Flash } from "@/components/ui";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function SignUpPage(props: PageProps<"/registrarse">) {
  const sp = await props.searchParams;
  return (
    <AuthShell title="Sumate al mercado de LU4" subtitle="Comprá y vendé adena, cuentas e ítems entre jugadores.">
      <div className="mx-auto max-w-sm">
      <h1 className="h1 mb-4">Crear cuenta</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <form action={signUp} className="space-y-4">
        <div>
          <label className="label" htmlFor="display_name">Nombre visible</label>
          <input id="display_name" name="display_name" required minLength={2} maxLength={40} className="input" />
          <p className="hint">Es lo que ven otros usuarios. No uses tu nombre real si no querés.</p>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input" />
          <p className="hint">Mínimo 8 caracteres.</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acepto" className="mt-1" required />
          <span>
            Soy mayor de 18 años y acepto los <Link href="/terminos" className="text-brand underline">términos</Link>.
          </span>
        </label>
        <SubmitButton className="btn-primary w-full" pendingText="Creando…">Crear cuenta</SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        ¿Ya tenés cuenta? <Link href="/ingresar" className="font-semibold text-brand">Ingresá</Link>
      </p>
    </div>
      </AuthShell>
  );
}
