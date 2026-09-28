import type { Metadata } from "next";
import Link from "next/link";
import { PurchaseSteps } from "@/components/purchase-copy";
import { getPaymentsConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Cómo funciona" };

const blocks = (manual: boolean): { title: string; items: string[] }[] => [
  {
    title: "Para compradores",
    items: [
      "Elegí una oferta por servidor (Carmine, Gamma, Black o White). La adena se vende por kk (1.000.000 de adena) y elegís cuántos kk comprar.",
      "Antes de comprar podés escribirle al vendedor. Cada orden publica sus avisos en ese mismo chat y guarda un registro de todo lo que pasa.",
      manual
        ? "Pagás por transferencia al CVU/alias o QR, Binance Pay o cripto (USDT) y avisás el pago con el comprobante. Un administrador lo verifica y recién ahí el vendedor entrega."
        : "Pagás con tu saldo de Argenpay o con el procesador. Las ofertas con ⚡ entrega automática te muestran lo comprado al instante.",
      "Revisá en el juego lo recibido y tocá “Recibí todo”: recién ahí se libera el pago al vendedor. Si algo no coincide, abrí un reclamo y un administrador lo resuelve.",
    ],
  },
  {
    title: "Para vendedores",
    items: [
      "Tocá + Publicar y elegí cuenta, adena, ítem, coins, servicio u otro. Indicá precio por unidad, disponibilidad, compra mínima y tiempo de entrega.",
      "Con entrega automática cargás lo que entregás (uno por línea) y cada comprador recibe su ítem apenas paga.",
      manual
        ? "Cuando el comprador confirma, te transferimos el 90% del precio (Argenpay cobra 10% de comisión) a la cuenta que cargues en Mi cuenta. El CBU/CVU tiene que estar a tu nombre."
        : "Cuando el comprador confirma, el 90% del precio entra a tu saldo (Argenpay cobra 10% de comisión). Después pedís el retiro a tu CBU/CVU o alias.",
      "Subí tus ofertas cada 4 horas para aparecer primero en el listado y cuidá tus reseñas: son lo primero que miran los compradores.",
    ],
  },
  {
    title: "Seguridad",
    items: [
      "Nunca compartas contraseñas de tu email ni códigos de verificación por el chat.",
      "Entregá solo cuando la orden figure como Pago confirmado. No aceptes pagos por fuera de Argenpay: fuera de la plataforma no hay reclamos.",
    ],
  },
];

export default function HowItWorks() {
  const cfg = getPaymentsConfig();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="h1 animate-fade-up">Cómo funciona Argenpay LU4</h1>
      {cfg.mode === "simulado" && (
        <div className="rounded-xl border border-gold/25 bg-warn-bg p-4 text-sm text-warn-ink">
          Estás en un <strong>entorno simulado</strong>. Todo el circuito (pago, saldo, entrega, reclamo, reembolso, liberación y
          retiro) se puede probar de punta a punta, pero ningún importe es real.
        </div>
      )}
      {blocks(cfg.mode === "manual").map((b, i) => (
        <section key={b.title} className="card animate-fade-up space-y-3" style={{ "--i": i } as React.CSSProperties}>
          <h2 className="h2">{b.title}</h2>
          <ol className="space-y-2">
            {b.items.map((t, j) => (
              <li key={t} className="flex gap-3 text-sm leading-relaxed text-muted">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-gold/40 text-xs font-bold text-gold-2">{j + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <PurchaseSteps />
      <p className="text-center text-sm text-muted">
        ¿Te quedó alguna duda? <Link href="/soporte" className="text-gold hover:text-gold-2">Escribinos a soporte</Link>
      </p>
    </div>
  );
}
