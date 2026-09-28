import { getPaymentsConfig } from "@/lib/config";

/**
 * Explicación del proceso de compra. En modo real solo describe capacidades verificadas:
 * no se usan términos como "escrow", "dinero protegido" ni "fondos retenidos".
 */
export function PurchaseSteps() {
  const cfg = getPaymentsConfig();
  const simulated = cfg.mode === "simulado";
  const steps = cfg.mode === "manual"
    ? [
        "Transferís el importe a los datos de cobro de Argenpay (CVU/QR, Binance o cripto).",
        "Avisás el pago con el comprobante: un administrador lo verifica a mano.",
        "Con el pago confirmado, el vendedor te entrega en el juego.",
        "Confirmás la recepción o abrís un reclamo. Cerrada la operación, le transferimos el neto al vendedor.",
      ]
    : simulated || cfg.holdAndPayoutVerified
    ? [
        "Pagás el precio total en Argenpay.",
        "El vendedor recibe la orden pagada y te entrega en el juego.",
        "Confirmás la recepción o abrís un reclamo.",
        "Cerrada la operación, se liquida el neto al vendedor.",
      ]
    : [
        "Pagás el precio total a través del procesador de pagos.",
        "El vendedor recibe la orden y te entrega en el juego.",
        "Confirmás la recepción o abrís un reclamo, que revisa nuestro equipo.",
      ];
  return (
    <div className="card text-sm">
      <p className="mb-3 font-display font-semibold">Cómo sigue la compra{simulated ? " (simulación)" : ""}</p>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3 text-muted">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-gold/40 text-[10px] font-bold text-gold-2">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}
