import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-12 border-t border-line/80 bg-bg-2/60">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-muted sm:grid-cols-3">
        <div>
          <p className="font-display text-base font-bold text-ink">Argenpay</p>
          <p className="mt-1">Mercado entre jugadores de Lineage 2 LU4. Precios en pesos argentinos.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Link href="/lotes/adena" className="hover:text-gold-2">Adena</Link>
          <Link href="/lotes/cuentas" className="hover:text-gold-2">Cuentas y personajes</Link>
          <Link href="/lotes/items" className="hover:text-gold-2">Ítems y equipo</Link>
          <Link href="/lotes/servicios" className="hover:text-gold-2">Servicios</Link>
        </div>
        <div className="flex flex-col gap-1.5">
          <Link href="/como-funciona" className="hover:text-gold-2">Cómo funciona</Link>
          <Link href="/terminos" className="hover:text-gold-2">Términos (borrador)</Link>
          <p className="text-xs">Sitio independiente. No está afiliado a lu4.org ni a NCSOFT.</p>
        </div>
      </div>
    </footer>
  );
}
