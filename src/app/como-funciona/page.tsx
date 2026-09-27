import type { Metadata } from "next";
import { PurchaseSteps } from "@/components/purchase-copy";
import { getPaymentsConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Cómo funciona" };

export default function HowItWorks() {
  const cfg = getPaymentsConfig();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="h1 animate-fade-up">Cómo funciona Argenpay LU4</h1>
      {cfg.mode === "simulado" && (
        <div className="rounded-xl border border-gold/25 bg-warn-bg p-4 text-sm text-warn-ink">
          Estás en un <strong>entorno simulado</strong>. Todo el circuito (pago, entrega, reclamo, reembolso y liquidación) se
          puede probar de punta a punta, pero ningún importe es real.
        </div>
      )}
      <div className="card animate-fade-up space-y-3 text-sm leading-relaxed">
        <h2 className="h2">Para compradores</h2>
        <p>Elegí un lote por servidor (Carmine, Gamma, Black o White). En adena el precio es por <strong>kk</strong> (1.000.000 de adena) y podés elegir cuántos kk comprar.</p>
        <p>Antes de comprar podés escribirle al vendedor por el chat. Cada orden publica sus avisos en ese mismo chat y guarda un registro de todo lo que pasa.</p>
        <p>Cuando el vendedor marca la entrega, revisá en el juego lo recibido y confirmá la recepción. Si algo no coincide, abrí un reclamo y un administrador lo resuelve. Si no confirmás ni reclamás dentro del plazo indicado, la operación se confirma sola.</p>
      </div>
      <div className="card animate-fade-up space-y-3 text-sm leading-relaxed" style={{ "--i": 1 } as React.CSSProperties}>
        <h2 className="h2">Para vendedores</h2>
        <p>Activá tu perfil de vendedor y publicá con precio por unidad, disponibilidad, compra mínima, tiempo de entrega y condiciones. Para cuentas podés indicar raza, clase y nivel.</p>
        <p>Cuando una orden tiene el pago confirmado, coordiná por el chat y entregá por trade, correo o tienda privada. Marcá la entrega con evidencia (captura). Argenpay cobra una comisión del 10% sobre cada operación concretada.</p>
      </div>
      <div className="card animate-fade-up space-y-3 text-sm leading-relaxed" style={{ "--i": 2 } as React.CSSProperties}>
        <h2 className="h2">Seguridad</h2>
        <p>Nunca compartas tu contraseña de cuenta ni códigos de verificación por el chat. Hacé las entregas solo después de ver la orden como <strong>Pago confirmado</strong>.</p>
      </div>
      <PurchaseSteps />
    </div>
  );
}
