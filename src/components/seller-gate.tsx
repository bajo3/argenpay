import { activateSeller } from "@/app/actions/account";
import { SubmitButton } from "./submit-button";

/** Aparece la primera vez que alguien quiere publicar: acepta las condiciones y sigue. */
export function SellerGate({ next }: { next: string }) {
  return (
    <form action={activateSeller} className="card animate-fade-up space-y-4 border-gold/30">
      <input type="hidden" name="siguiente" value={next} />
      <h2 className="h2">Antes de publicar</h2>
      <p className="text-sm text-muted">
        Para vender en Argenpay aceptá las condiciones para vendedores. Cobramos una comisión del 10% sobre cada venta
        concretada; el resto se libera a tu saldo cuando el comprador confirma que recibió lo acordado.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>Solo publico lo que tengo derecho a vender y obtuve por medios legales.</li>
        <li>Entrego lo acordado en el tiempo estimado y dejo evidencia en la orden.</li>
        <li>No pido pagos por fuera de Argenpay ni datos sensibles por el chat.</li>
      </ul>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acepto_vendedor" className="mt-1 accent-[var(--gold)]" required />
        <span>Acepto las condiciones para vendedores.</span>
      </label>
      <SubmitButton className="btn-primary shine">Activar y seguir</SubmitButton>
    </form>
  );
}
