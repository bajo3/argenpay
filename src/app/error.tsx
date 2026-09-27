"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="font-display text-5xl font-extrabold text-crimson">¡Ups!</p>
      <h1 className="h1 mt-3">Algo salió mal</h1>
      <p className="mt-2 text-muted">No pudimos cargar esta página. Probá de nuevo en unos segundos.</p>
      <button onClick={reset} className="btn-primary shine mt-6">Reintentar</button>
    </div>
  );
}
