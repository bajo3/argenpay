"use client";
import { useState } from "react";
import { orderAction } from "@/app/actions/orders";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "./submit-button";

/** El vendedor marca la entrega con evidencia (texto obligatorio + archivo opcional en Storage privado). */
export function DeliveryForm({ orderId }: { orderId: string }) {
  const [error, setError] = useState<string | null>(null);

  async function submit(fd: FormData) {
    setError(null);
    const file = fd.get("file");
    fd.delete("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 5 * 1024 * 1024) return setError("El archivo supera los 5 MB");
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${orderId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await createClient().storage.from("evidencias").upload(path, file, { contentType: file.type });
      if (upErr) return setError("No se pudo subir el archivo (formatos: PNG, JPG, WEBP o PDF)");
      fd.set("evidence_path", path);
    }
    await orderAction(fd);
  }

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="action" value="marcar_entregado" />
      <div>
        <label className="label" htmlFor="note">Evidencia de entrega</label>
        <textarea id="note" name="note" required minLength={5} rows={3} className="input"
          placeholder="Qué entregaste y cómo (ej: credenciales enviadas por el chat a las 15:32, ítem transferido al personaje X)." />
        <p className="hint">No pegues contraseñas acá: usá el chat de la orden. Esto queda en el registro.</p>
      </div>
      <div>
        <label className="label" htmlFor="file">Captura o comprobante (opcional)</label>
        <input id="file" name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="text-sm" />
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <SubmitButton pendingText="Enviando…">Marcar como entregado</SubmitButton>
    </form>
  );
}
