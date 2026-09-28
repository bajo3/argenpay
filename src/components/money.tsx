"use client";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { formatARS } from "@/lib/money";

/**
 * Moneda en la que el usuario ve los importes (ARS o USD). Todo se contabiliza en pesos: USD es pesos ÷
 * cotización del dólar cripto. La preferencia se guarda en una cookie para que el servidor también la use.
 */
export type Currency = "ARS" | "USD";

interface MoneyCtx {
  currency: Currency;
  /** ARS (centavos) por 1 USD. */
  rate: number | null;
  setCurrency: (c: Currency) => void;
}

const Ctx = createContext<MoneyCtx>({ currency: "ARS", rate: null, setCurrency: () => {} });

const usdFmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatUSD(arsCents: number, rate: number): string {
  return usdFmt.format(arsCents / rate).replace("USD", "US$");
}

/** Formatea pesos (centavos) en la moneda elegida. Sin cotización, siempre en pesos. */
export function formatMoney(arsCents: number, currency: Currency, rate: number | null): string {
  return currency === "USD" && rate ? formatUSD(arsCents, rate) : formatARS(arsCents);
}

export function MoneyProvider({ initialCurrency, rate, children }: { initialCurrency: Currency; rate: number | null; children: React.ReactNode }) {
  const [currency, setState] = useState<Currency>(initialCurrency);
  return (
    <Ctx.Provider
      value={{
        currency: rate ? currency : "ARS",
        rate,
        setCurrency: (c) => {
          setState(c);
          document.cookie = `moneda=${c}; path=/; max-age=31536000; samesite=lax`;
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useMoney() {
  const ctx = useContext(Ctx);
  return { ...ctx, format: (cents: number) => formatMoney(cents, ctx.currency, ctx.rate) };
}

/** Importe en la moneda elegida; al pasar el mouse muestra el equivalente en la otra. */
export function Money({ cents, className }: { cents: number | bigint | string; className?: string }) {
  const { currency, rate } = useMoney();
  const n = Number(cents);
  const main = formatMoney(n, currency, rate);
  const other = rate ? (currency === "USD" ? formatARS(n) : formatUSD(n, rate)) : undefined;
  return (
    <span className={className} title={other ? `≈ ${other}` : undefined}>
      {main}
    </span>
  );
}

/** Selector ARS / USD del encabezado. */
export function CurrencyToggle() {
  const { currency, rate, setCurrency } = useMoney();
  const router = useRouter();
  if (!rate) return null;
  return (
    <div className="hidden items-center rounded-lg border border-line p-0.5 text-[11px] font-bold sm:flex" role="group" aria-label="Moneda">
      {(["ARS", "USD"] as const).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => {
            setCurrency(c);
            router.refresh();
          }}
          className={`rounded-md px-2 py-1 transition ${currency === c ? "bg-gold text-gold-ink" : "text-muted hover:text-gold-2"}`}
          aria-pressed={currency === c}
          title={c === "USD" ? `Dólar cripto: ${formatARS(rate)}` : "Pesos argentinos"}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
