import type { Metadata } from "next";
import Link from "next/link";
import { contactSupport } from "@/app/actions/support";
import { SubmitButton } from "@/components/submit-button";
import { Flash } from "@/components/ui";
import { getSessionProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Soporte" };

const FAQ: { q: string; a: string }[] = [
  {
    q: "¿Cómo compro?",
    a: "Elegí una oferta, indicá la cantidad y tocá Comprar. Pagá con tu saldo o con el procesador. Cuando el pago se confirma, el vendedor entrega en el juego (trade, correo o tienda privada) o, si la oferta tiene ⚡ entrega automática, recibís el contenido al instante en la orden.",
  },
  {
    q: "¿Cuándo recibe el dinero el vendedor?",
    a: "Recién cuando confirmás que recibiste todo. Si no confirmás ni abrís un reclamo dentro del plazo que figura en la orden, se confirma automáticamente. Mientras tanto, la venta figura como pendiente para el vendedor.",
  },
  {
    q: "Tengo un problema con una compra, ¿qué hago?",
    a: "Primero escribile al vendedor por el chat de la orden. Si no se resuelve, abrí un reclamo desde la orden (antes de confirmar la recepción): un administrador revisa el chat y la evidencia y decide si se libera el pago o se reembolsa.",
  },
  {
    q: "¿Cuánto cobra Argenpay?",
    a: "Una comisión del 10% sobre el precio de cada venta concretada. La paga el vendedor: del total que abona el comprador, el 90% va al saldo del vendedor.",
  },
  {
    q: "¿Cómo retiro mi saldo?",
    a: "Cargá tu CBU/CVU o alias en Mi cuenta y pedí el retiro desde Saldo. Si el retiro se rechaza, el dinero vuelve a tu saldo.",
  },
  {
    q: "¿Qué es subir ofertas?",
    a: "Desde Mis ventas → Mis ofertas podés poner tus ofertas activas primeras en su categoría. Se puede hacer cada 4 horas.",
  },
  {
    q: "¿Es seguro pasar datos por el chat?",
    a: "Nunca compartas tu contraseña de email ni códigos de verificación. Si vendés una cuenta, entregá los datos solo cuando la orden figure como Pago confirmado, y el comprador debería cambiarlos apenas ingrese.",
  },
];

export default async function SupportPage(props: PageProps<"/soporte">) {
  const sp = await props.searchParams;
  const session = await getSessionProfile();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="animate-fade-up">
        <h1 className="h1">Soporte</h1>
        <p className="mt-1 text-sm text-muted">Respuestas rápidas y contacto con el equipo de Argenpay.</p>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <section className="card animate-fade-up relative overflow-hidden border-gold/30">
        <span className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-gold/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="min-w-56 flex-1">
            <p className="font-display text-lg font-bold">¿Necesitás ayuda con una orden?</p>
            <p className="text-sm text-muted">Escribinos por chat. Si es por una compra, incluí el número de orden (ej: #AB12CD34).</p>
          </div>
          {session ? (
            <form action={contactSupport}>
              <SubmitButton className="btn-primary shine" pendingText="Abriendo…">💬 Escribir a soporte</SubmitButton>
            </form>
          ) : (
            <Link href="/ingresar?siguiente=/soporte" className="btn-primary shine">Ingresá para escribirnos</Link>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="h2">Preguntas frecuentes</h2>
        {FAQ.map((f, i) => (
          <details key={f.q} className="card group animate-fade-up p-0" style={{ "--i": i } as React.CSSProperties}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="text-gold transition group-open:rotate-45">+</span>
            </summary>
            <p className="px-5 pb-4 text-sm leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
