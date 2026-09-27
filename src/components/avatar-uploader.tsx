"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { removeAvatar, setAvatar } from "@/app/actions/account";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./seller-badge";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Sube la foto de perfil al bucket público "avatares" en la carpeta del usuario. */
export function AvatarUploader({ userId, name, url }: { userId: string; name: string; url: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    if (!TYPES.includes(file.type)) return setError("Formato no permitido. Usá PNG, JPG, WEBP o GIF.");
    if (file.size > MAX_BYTES) return setError("La imagen supera los 2 MB.");
    setBusy(true);
    setPreview(URL.createObjectURL(file));
    const supabase = createClient();
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatares").upload(path, file, { contentType: file.type, cacheControl: "31536000" });
    if (upErr) {
      setBusy(false);
      setPreview(url);
      return setError("No se pudo subir la imagen. Probá de nuevo.");
    }
    const { data } = supabase.storage.from("avatares").getPublicUrl(path);
    const res = await setAvatar(data.publicUrl);
    setBusy(false);
    if (res?.error) {
      setPreview(url);
      return setError(res.error);
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative rounded-full focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
        aria-label="Cambiar foto de perfil"
      >
        <Avatar name={name} url={preview} size={96} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-xs font-semibold opacity-0 transition group-hover:opacity-100">
          {busy ? "Subiendo…" : "Cambiar"}
        </span>
      </button>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn-primary shine px-3 py-2">
            {busy ? "Subiendo…" : preview ? "Cambiar foto" : "Subir foto"}
          </button>
          {preview && !busy && (
            <button
              type="button"
              className="btn-ghost px-3 py-2"
              onClick={async () => {
                await removeAvatar();
                setPreview(null);
                router.refresh();
              }}
            >
              Quitar
            </button>
          )}
        </div>
        <p className="hint">PNG, JPG, WEBP o GIF · máximo 2 MB. Se ve en tus ofertas, chats y reseñas.</p>
        {error && <p className="text-xs text-bad">{error}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept={TYPES.join(",")}
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
