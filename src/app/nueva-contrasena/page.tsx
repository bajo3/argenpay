import type { Metadata } from "next";
import { PasswordForm } from "@/components/password-form";
import { Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default async function NewPasswordPage(props: PageProps<"/nueva-contrasena">) {
  const sp = await props.searchParams;
  const s = await requireUser("/nueva-contrasena");
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="h1 mb-2 animate-fade-up">Elegí una contraseña nueva</h1>
      <p className="mb-4 text-sm text-muted">Para la cuenta {s.email}.</p>
      <Flash error={sp.error} ok={sp.ok} />
      <PasswordForm />
    </div>
  );
}
