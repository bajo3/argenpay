"use client";
import { useState } from "react";

/** Copia un dato (CVU, alias, dirección…) al portapapeles y avisa con un "Copiado". */
export function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Sin permiso de portapapeles: el dato igual se puede seleccionar a mano.
        }
      }}
      className="shrink-0 rounded-md border border-gold/30 px-2 py-0.5 text-xs font-semibold text-gold transition hover:bg-gold/10"
      aria-label={`${label} ${value}`}
    >
      {copied ? "Copiado ✓" : label}
    </button>
  );
}
