import Link from "next/link";
import { getPaymentsConfig } from "@/lib/config";

/** Aviso permanente del modo de pagos. Nunca promete retención de fondos que no esté verificada. */
export function ModeBanner() {
  const cfg = getPaymentsConfig();
  if (cfg.mode === "real") return null;
  return (
    <div className="border-b border-gold/20 bg-warn-bg px-4 py-1.5 text-center text-xs text-warn-ink">
      {cfg.mode === "simulado" ? (
        <>
          <strong>Entorno simulado:</strong> pagos, reembolsos y liquidaciones usan un proveedor de prueba. No se mueve
          dinero real.{" "}
          <Link href="/como-funciona" className="underline underline-offset-2">Más info</Link>
        </>
      ) : (
        <>Las compras están deshabilitadas temporalmente. Podés explorar las ofertas y chatear con vendedores.</>
      )}
    </div>
  );
}
