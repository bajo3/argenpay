"use client";
import { useState } from "react";
import { reportTopup } from "@/app/actions/manual-payments";
import { compressImage, ImageError } from "@/lib/image";
import { formatARS } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "./submit-button";

/**
 * Carga de saldo por transferencia: el usuario elige cómo envió (pesos al CVU o USDT/USDC/BTC), el importe y el
 * TXID / comprobante. No acredita nada: lo acredita un administrador después de verificarlo.
 */
export function TopupForm({ userId, methods, rate }: { userId: string; methods: { id: string; label: string }[]; rate: number | null }) {
  const [method, setMethod] = useState(methods[0]?.id ?? "cvu");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const crypto = method !== "cvu";
  const currency = method === "cvu" ? "ARS" : method === "usdc" ? "USDC" : method === "btc" ? "BTC" : "USDT";
  const n = Number(amount.replace(/\./g, "").replace(",", "."));
  const cryptoN = Number(amount.replace(",", "."));
  const estimate =
    currency === "ARS"
      ? null
      : currency !== "BTC" && rate && cryptoN > 0
        ? `≈ ${formatARS(Math.round(cryptoN * rate))} de saldo (dólar cripto ${formatARS(rate)})`
        : currency === "BTC"
          ? "El saldo en pesos se calcula al acreditar, con la cotización del momento."
          : null;

  async function submit(fd: FormData) {
    setError(null);
    let file = fd.get("file");
    fd.delete("file");
    if (file instanceof File && file.size > 0) {
      if (file.type !== "application/pdf") {
        try {
          file = await compressImage(file, { maxSide: 2000, maxBytes: 3 * 1024 * 1024, keepGif: false });
        } catch (e) {
          return setError(e instanceof ImageError ? e.message : "No pudimos procesar la imagen");
        }
      } else if (file.size > 5 * 1024 * 1024) {
        return setError("El PDF supera los 5 MB");
      }
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${userId}/carga/${window.crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await createClient().storage.from("comprobantes").upload(path, file, { contentType: file.type });
      if (upErr) return setError("No se pudo subir el comprobante (formatos: PNG, JPG, WEBP o PDF)");
      fd.set("proof_path", path);
    }
    await reportTopup(fd);
  }

  return (
    <form action={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="topup-method">¿Cómo enviaste el dinero?</label>
          <select id="topup-method" name="method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="topup-amount">Importe enviado ({currency})</label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-xs font-semibold text-gold-2">{currency === "ARS" ? "$" : currency}</span>
            <input
              id="topup-amount"
              name="amount"
              required
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={crypto ? "10,5" : "15.000"}
              className={`input font-semibold tabular-nums ${currency === "ARS" ? "pl-8" : "pl-14"}`}
            />
          </div>
          {currency === "ARS" && n > 0 && <p className="mt-1 text-xs text-muted">Se acreditan {formatARS(Math.round(n * 100))}</p>}
          {estimate && <p className="mt-1 text-xs text-muted">{estimate}</p>}
        </div>
      </div>
      <input type="hidden" name="currency" value={currency} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="topup-reference">{crypto ? "TXID / ID de la operación" : "Nº de comprobante"}</label>
          <input id="topup-reference" name="reference" required minLength={4} maxLength={200} className="input font-mono" autoComplete="off" placeholder={crypto ? "0x4f9c…a12" : "00123456789"} />
        </div>
        <div>
          <label className="label" htmlFor="topup-payer">Nombre de quien envió (opcional)</label>
          <input id="topup-payer" name="payer_name" maxLength={120} className="input" placeholder="Como figura en la cuenta de origen" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="topup-file">Captura del comprobante (opcional)</label>
        <input id="topup-file" name="file" type="file" accept="image/*,application/pdf" className="text-sm" />
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <SubmitButton className="btn-primary shine w-full" pendingText="Enviando aviso…">Ya envié: avisar la carga</SubmitButton>
      <p className="hint">El saldo se acredita cuando verificamos el ingreso. Te avisamos en la campana.</p>
    </form>
  );
}
