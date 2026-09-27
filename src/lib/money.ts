const formatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatARS(cents: number | bigint): string {
  const n = typeof cents === "bigint" ? Number(cents) : cents;
  return formatter.format(n / 100);
}

/**
 * Convierte un texto ingresado por el usuario ("1.234,56", "1234.5", "1234") a centavos.
 * Devuelve null si el formato no es válido. Nunca usa aritmética de punto flotante.
 */
export function parseARSToCents(input: string): number | null {
  const raw = input.trim().replace(/\s|\$/g, "");
  if (!raw) return null;
  let normalized: string;
  if (raw.includes(",")) {
    // Formato argentino: punto = miles, coma = decimales
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, "");
  } else {
    normalized = raw;
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(cents);
}

/** Para precargar inputs: 123456 → "1234,56" */
export function centsToInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `${whole},${frac}`;
}
