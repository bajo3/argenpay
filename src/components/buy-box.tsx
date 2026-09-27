"use client";
import { useState } from "react";
import { createOrder } from "@/app/actions/orders";
import { formatARS } from "@/lib/money";
import { SubmitButton } from "./submit-button";

const intFmt = new Intl.NumberFormat("es-AR");

/** Caja de compra: cantidad (en kk para adena) y total en vivo. El total definitivo lo fija el servidor. */
export function BuyBox({
  listingId,
  priceCents,
  stock,
  minQuantity,
  unit,
  unitPlural,
  loggedIn,
}: {
  listingId: string;
  priceCents: number;
  stock: number;
  minQuantity: number;
  unit: string;
  unitPlural: string;
  loggedIn: boolean;
}) {
  const min = Math.min(minQuantity, stock);
  const [qty, setQty] = useState(min);
  const valid = Number.isInteger(qty) && qty >= min && qty <= stock;
  const presets = [min, Math.ceil(stock / 4), Math.ceil(stock / 2), stock].filter((v, i, a) => v >= min && a.indexOf(v) === i && v > 0).slice(0, 4);

  return (
    <form action={createOrder} className="space-y-4">
      <input type="hidden" name="listing_id" value={listingId} />
      <div>
        <label className="label flex justify-between" htmlFor="quantity">
          <span>Cantidad</span>
          <span className="text-xs font-normal text-muted">
            {min > 1 && <>mín. {intFmt.format(min)} · </>}máx. {intFmt.format(stock)} {unitPlural}
          </span>
        </label>
        <div className="flex items-stretch overflow-hidden rounded-xl border border-line bg-bg-2 focus-within:border-gold/60">
          <button type="button" className="px-4 text-lg text-muted hover:text-gold-2" onClick={() => setQty((q) => Math.max(min, q - 1))} aria-label="Menos">−</button>
          <input
            id="quantity"
            name="quantity"
            type="number"
            min={min}
            max={stock}
            value={Number.isFinite(qty) ? qty : ""}
            onChange={(e) => setQty(Math.floor(Number(e.target.value)))}
            className="w-full bg-transparent py-2.5 text-center text-lg font-semibold outline-none"
          />
          <span className="flex items-center pr-3 text-sm text-muted">{unitPlural}</span>
          <button type="button" className="px-4 text-lg text-muted hover:text-gold-2" onClick={() => setQty((q) => Math.min(stock, (q || 0) + 1))} aria-label="Más">+</button>
        </div>
        {presets.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p} type="button" onClick={() => setQty(p)} className={`chip px-2.5 py-1 text-xs ${qty === p ? "chip-active" : ""}`}>
                {intFmt.format(p)} {p === 1 ? unit : unitPlural}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gold/20 bg-gold/5 p-4">
        <div className="flex items-baseline justify-between text-sm text-muted">
          <span>{valid ? `${intFmt.format(qty)} × ${formatARS(priceCents)}` : "Cantidad inválida"}</span>
          <span>Total</span>
        </div>
        <p className="mt-1 text-right font-display text-3xl font-bold text-gold-2 transition-all">
          {valid ? formatARS(priceCents * qty) : "—"}
        </p>
      </div>

      <SubmitButton className="btn-primary shine w-full py-3 text-base" pendingText="Creando orden…">
        {loggedIn ? "Comprar" : "Ingresá para comprar"}
      </SubmitButton>
      <p className="hint text-center">El total definitivo se calcula en el servidor al crear la orden.</p>
    </form>
  );
}
