import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Flash } from "@/components/ui";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default async function RecoverPage(props: PageProps<"/recuperar">) {
  const sp = await props.searchParams;
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="h1 mb-2 animate-fade-up">Recuperar contraseña</h1>
      <p className="mb-4 text-sm text-muted">Te enviamos un enlace para que elijas una contraseña nueva.</p>
      <Flash error={sp.error} ok={sp.ok} />
      <form action={requestPasswordReset} className="card animate-fade-up space-y-4">
        <div>
          <label className="label" htmlFor="email">Email de tu cuenta</label>
          <input id="email" name="email" type="email" required autoComplete="email" className="input" />
        </div>
        <SubmitButton className="btn-primary shine w-full" pendingText="Enviando…">Enviar enlace</SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        ¿Te acordaste? <Link href="/ingresar" className="font-semibold text-gold">Ingresá</Link>
      </p>
    </div>
  );
}
