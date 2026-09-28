"use client";
import { useEffect, useState } from "react";
import { alarmEnabled, playAlarm, setAlarmEnabled, unlockAudio } from "@/lib/alarm";

/** Administrador: activa la alarma de ingresos en este navegador (sonido + notificación del sistema). */
export function AlarmToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [perm, setPerm] = useState<string>("default");

  useEffect(() => {
    // Leer preferencias guardadas en el navegador (no existen en el servidor).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(alarmEnabled());
    setPerm(typeof Notification === "undefined" ? "no-soportado" : Notification.permission);
  }, []);

  async function enable() {
    await unlockAudio();
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      setPerm(await Notification.requestPermission());
    }
    setAlarmEnabled(true);
    setOn(true);
    await playAlarm();
  }

  if (on === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/30 bg-gold/5 p-3 text-sm">
      <span className="text-lg">🔔</span>
      <div className="min-w-48 flex-1">
        <p className="font-semibold">Alarma de ingresos en este navegador: {on ? <span className="text-ok">activada</span> : <span className="text-muted">apagada</span>}</p>
        <p className="text-xs text-muted">
          Suena y muestra una notificación cuando entra dinero a Binance, aunque estés en otra pestaña.
          {perm === "denied" && " Las notificaciones están bloqueadas: habilitalas desde el candado de la barra de direcciones."}
        </p>
      </div>
      {on ? (
        <div className="flex gap-2">
          <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => void playAlarm()}>Probar sonido</button>
          <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => { setAlarmEnabled(false); setOn(false); }}>Apagar</button>
        </div>
      ) : (
        <button type="button" className="btn-primary shine px-3 py-1.5" onClick={() => void enable()}>Activar alarma</button>
      )}
    </div>
  );
}
