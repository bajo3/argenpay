import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-gold-gradient font-display text-7xl font-extrabold">404</p>
      <h1 className="h1 mt-2">No encontramos esta página</h1>
      <p className="mt-2 text-muted">Puede que no exista o que no tengas acceso.</p>
      <Link href="/" className="btn-primary shine mt-6">Volver al inicio</Link>
    </div>
  );
}
