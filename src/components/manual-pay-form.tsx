"use client";
import { useState } from "react";
import { reportManualPayment } from "@/app/actions/manual-payments";
import { compressImage, ImageError } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "./submit-button";

export interface MethodOption {
  id: string;
  label: string;
}

/** El comprador avisa que pagó: medio, TXID / nº de comprobante y (opcional) una captura. */
export function ManualPayForm({ orderId, userId, methods }: { orderId: string; userId: string; methods: MethodOption[] }) {
  const [error, setError] = useState<string | null>(null);

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
      const path = `${userId}/${orderId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await createClient().storage.from("comprobantes").upload(path, file, { contentType: file.type });
      if (upErr) return setError("No se pudo subir el comprobante (formatos: PNG, JPG, WEBP o PDF)");
      fd.set("proof_path", path);
    }
    await reportManualPayment(fd);
  }

  return (
    <form action={submit} className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-4">
      <input type="hidden" name="order_id" value={orderId} />
      <p className="text-sm font-semibold">Ya transferí: avisar el pago</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="method">¿Cómo pagaste?</label>
          <select id="method" name="method" required className="input" defaultValue="">
            <option value="" disabled>Elegí una opción</option>
            {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            <option value="otro">Otro</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="reference">TXID o nº de comprobante</label>
          <input id="reference" name="reference" required minLength={4} maxLength={200} className="input font-mono" placeholder="Ej: 4f9c…a12 / 00123456789" autoComplete="off" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="payer_name">Nombre de quien pagó (opcional)</label>
          <input id="payer_name" name="payer_name" maxLength={120} className="input" placeholder="Como figura en la cuenta de origen" />
        </div>
        <div>
          <label className="label" htmlFor="file">Captura del comprobante (opcional)</label>
          <input id="file" name="file" type="file" accept="image/*,application/pdf" className="text-sm" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="note">Comentario (opcional)</label>
        <input id="note" name="note" maxLength={500} className="input" placeholder="Cualquier dato que ayude a ubicar la transferencia" />
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <SubmitButton className="btn-primary shine w-full" pendingText="Enviando aviso…">Avisar que ya pagué</SubmitButton>
      <p className="hint">Tu pago se toma como recibido recién cuando lo verificamos y lo confirmamos. Hasta entonces el vendedor no entrega.</p>
    </form>
  );
}
