"use client";
import { useState } from "react";
import { centsToInput, formatARS, parseARSToCents } from "@/lib/money";

/** "1234567,5" → "1.234.567,5" mientras se escribe (sin tocar los decimales que ya se tipearon). */
function groupThousands(raw: string): string {
  // Un punto recién tipeado al final se toma como coma decimal ("900." → "900,").
  if (!raw.includes(",") && raw.endsWith(".")) raw = `${raw.slice(0, -1)},`;
  const clean = raw.replace(/[^\d,]/g, "");
  const [intPart, ...rest] = clean.split(",");
  const int = intPart.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (!rest.length) return int;
  return `${int || "0"},${rest.join("").slice(0, 2)}`;
}

/** Al salir del campo: "900" → "900,00". */
function normalize(raw: string): string {
  const cents = parseARSToCents(raw);
  if (cents === null) return raw;
  const [int, frac] = centsToInput(cents).split(",");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

/**
 * Campo de importe en pesos: muestra el signo $, separa miles mientras se escribe y completa
 * los centavos al salir (900 → $ 900,00). Envía el texto al servidor, que lo vuelve a validar.
 */
export function MoneyInput({
  name,
  label,
  placeholder = "0,00",
  required,
  max,
  presets,
  className = "",
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  /** Tope en centavos: habilita el botón "Todo" y avisa si se pasa. */
  max?: number;
  /** Importes rápidos en centavos. */
  presets?: number[];
  className?: string;
}) {
  const [value, setValue] = useState("");
  const cents = parseARSToCents(value);
  const over = max !== undefined && cents !== null && cents > max;

  const set = (c: number) => setValue(normalize(centsToInput(c)));

  return (
    <div className={`space-y-2 ${className}`}>
      {presets && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => set(p)} className={`chip px-2.5 py-1 text-xs transition hover:border-gold/60 hover:text-gold-2 ${cents === p ? "border-gold/70 text-gold-2" : ""}`}>
              {formatARS(p).replace(/,00$/, "")}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-semibold text-gold-2">$</span>
        <input
          name={name}
          value={value}
          onChange={(e) => setValue(groupThousands(e.target.value))}
          onBlur={() => value && setValue(normalize(value))}
          inputMode="decimal"
          autoComplete="off"
          required={required}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={over || undefined}
          className={`input pl-8 font-semibold tabular-nums ${max !== undefined ? "pr-16" : ""} ${over ? "border-bad/70" : ""}`}
        />
        {max !== undefined && max > 0 && (
          <button type="button" onClick={() => set(max)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md border border-gold/30 px-2 py-0.5 text-xs font-semibold text-gold hover:bg-gold/10">
            Todo
          </button>
        )}
      </div>
      {over ? (
        <p className="text-xs text-bad">Supera tu saldo disponible ({formatARS(max!)}).</p>
      ) : cents !== null && cents > 0 ? (
        <p className="text-xs text-muted">Importe: <strong className="text-ink">{formatARS(cents)}</strong></p>
      ) : null}
    </div>
  );
}
