"use client";
import { useRef, useState } from "react";
import { compressImage, ImageError } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";

/** Administrador: sube el QR de cobro al bucket público "cobro". Deja la ruta en un campo oculto del formulario. */
export function QrUploader({ currentUrl }: { currentUrl: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(original: File) {
    setError(null);
    setBusy(true);
    try {
      // Sin achicar demasiado: un QR necesita bordes nítidos para poder escanearse.
      const file = await compressImage(original, { maxSide: 1200, maxBytes: 1.5 * 1024 * 1024 });
      const ext = file.type.split("/")[1].replace("jpeg", "jpg");
      const newPath = `qr-${Date.now()}.${ext}`;
      const { error: upErr } = await createClient().storage.from("cobro").upload(newPath, file, { contentType: file.type });
      if (upErr) throw new Error("No se pudo subir el QR");
      setPath(newPath);
      setPreview(URL.createObjectURL(file));
    } catch (e) {
      setError(e instanceof ImageError || e instanceof Error ? e.message : "No pudimos procesar la imagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <input type="hidden" name="qr_path" value={path} />
      <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-white">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob) o URL pública de Storage
          <img src={preview} alt="QR de cobro" className="h-full w-full object-contain" />
        ) : (
          <span className="px-2 text-center text-[11px] text-neutral-500">Sin QR</span>
        )}
      </div>
      <div className="space-y-2">
        <button type="button" className="btn-ghost px-3 py-2" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Subiendo…" : preview ? "Cambiar QR" : "Subir QR"}
        </button>
        {currentUrl && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" name="remove_qr" /> Quitar el QR actual
          </label>
        )}
        <p className="hint">Captura del QR de tu app (Mercado Pago, banco, etc.). PNG, JPG o WEBP.</p>
        {error && <p className="text-xs text-bad">{error}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
