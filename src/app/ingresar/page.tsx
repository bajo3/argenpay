import type { Metadata } from "next";
import Link from "next/link";
import { signIn } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Flash } from "@/components/ui";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage(props: PageProps<"/ingresar">) {
  const sp = await props.searchParams;
  const next = typeof sp.siguiente === "string" ? sp.siguiente : "/";
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="h1 mb-4">Ingresar</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <form action={signIn} className="card space-y-4">
        <input type="hidden" name="siguiente" value={next} />
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Ingresando…">Ingresar</SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        ¿No tenés cuenta? <Link href="/registrarse" className="font-semibold text-brand">Creala gratis</Link>
      </p>
    </div>
  );
}
