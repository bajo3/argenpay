"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Administrador: fuerza una lectura de Binance ahora (además de la automática de cada minuto). */
export function CheckDepositsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ingresos/revisar?forzar=1", { method: "POST" });
      const data = (await res.json()) as { nuevos?: number; errores?: string[]; error?: string };
      if (!res.ok) setMsg(data.error ?? "No se pudo revisar");
      else if (data.errores?.length) setMsg(`Con errores: ${data.errores.join(" | ")}`);
      else setMsg(data.nuevos ? `${data.nuevos} ingreso(s) nuevo(s)` : "Sin ingresos nuevos");
      router.refresh();
    } catch {
      setMsg("No se pudo revisar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="max-w-xs truncate text-xs text-muted" title={msg}>{msg}</span>}
      <button type="button" onClick={() => void run()} disabled={busy} className="btn-ghost px-3 py-1.5">
        {busy ? "Revisando…" : "Revisar ahora"}
      </button>
    </div>
  );
}
