import type { Metadata } from "next";

export const metadata: Metadata = { title: "Términos (borrador)" };

export default function Terms() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 text-sm leading-relaxed">
      <h1 className="h1">Términos y condiciones — borrador</h1>
      <p className="rounded-xl bg-warn-bg p-4 text-warn-ink">
        Texto provisional para pruebas. Debe ser revisado por asesoría legal antes de operar con usuarios reales.
      </p>
      <div className="card space-y-3">
        <p>Argenpay es un marketplace donde terceros publican bienes y servicios relacionados con videojuegos. Los vendedores son responsables de tener derecho a vender lo que publican y de cumplir lo ofrecido y las reglas de cada juego.</p>
        <p>Argenpay cobra una comisión del 10% sobre el precio de cada operación concretada. Los importes de cada orden se fijan al momento de crearla.</p>
        <p>Los reclamos se abren desde la orden y son resueltos por el equipo de administración según la evidencia aportada por ambas partes.</p>
        <p>Está prohibido publicar contenido ilegal, bienes robados, cuentas obtenidas sin autorización del titular, fichas o créditos de apuestas y cualquier artículo que el procesador de pagos no admita.</p>
      </div>
    </div>
  );
}
