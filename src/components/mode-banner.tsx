import Link from "next/link";
import { getPaymentsConfig } from "@/lib/config";

/** Aviso permanente del modo de pagos. Nunca promete retención de fondos que no esté verificada. */
export function ModeBanner() {
  const cfg = getPaymentsConfig();
  if (cfg.mode === "real") return null;
  if (cfg.mode === "manual") {
    return (
      <div className="border-b border-gold/20 bg-gold/5 px-4 py-1.5 text-center text-xs text-gold-2">
        <strong>Pagos por transferencia:</strong> cada pago lo verifica un administrador a mano antes de que el vendedor entregue, así que puede demorar.{" "}
        <Link href="/como-funciona" className="underline underline-offset-2">Más info</Link>
      </div>
    );
  }
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
