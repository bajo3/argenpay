import { updatePassword } from "@/app/actions/auth";
import { SubmitButton } from "./submit-button";

export function PasswordForm({ back = "/nueva-contrasena" }: { back?: string }) {
  return (
    <form action={updatePassword} className="card animate-fade-up space-y-4">
      <input type="hidden" name="back" value={back} />
      <div>
        <label className="label" htmlFor="password">Contraseña nueva</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input" />
        <p className="hint">Mínimo 8 caracteres.</p>
      </div>
      <div>
        <label className="label" htmlFor="password2">Repetila</label>
        <input id="password2" name="password2" type="password" required minLength={8} autoComplete="new-password" className="input" />
      </div>
      <SubmitButton className="btn-primary shine w-full" pendingText="Guardando…">Guardar contraseña</SubmitButton>
    </form>
  );
}
