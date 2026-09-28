/**
 * Alarma de ingresos en el navegador del administrador: sonido (Web Audio) + notificación del sistema.
 * Los navegadores solo permiten sonido después de un clic en la página; por eso hay un botón "Activar alarma".
 */
export const ALARM_KEY = "argenpay:alarma-ingresos";

let ctx: AudioContext | null = null;

export function alarmEnabled(): boolean {
  try {
    return localStorage.getItem(ALARM_KEY) === "on";
  } catch {
    return false;
  }
}

export function setAlarmEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(ALARM_KEY, "on");
    else localStorage.removeItem(ALARM_KEY);
  } catch {
    // Sin almacenamiento: la alarma queda activa solo en esta pestaña.
  }
}

/** Crea/reanuda el contexto de audio. Llamarlo dentro de un clic lo "desbloquea" para después. */
export async function unlockAudio(): Promise<boolean> {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.state === "running";
  } catch {
    return false;
  }
}

/** Tres pitidos tipo caja registradora. No falla si el navegador bloquea el audio. */
export async function playAlarm() {
  if (!(await unlockAudio()) || !ctx) return;
  const t0 = ctx.currentTime;
  [0, 0.28, 0.56].forEach((offset, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "triangle";
    osc.frequency.value = i === 2 ? 1320 : 988;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.24);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.26);
  });
}

/** Notificación del sistema operativo (se ve aunque la pestaña esté en segundo plano). */
export function systemNotify(title: string, body: string, href: string) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const n = new Notification(title, { body, tag: `ingreso-${Date.now()}`, requireInteraction: true, icon: "/icon.png" });
    n.onclick = () => {
      window.focus();
      window.location.href = href;
      n.close();
    };
  } catch {
    // Algunos navegadores móviles no permiten notificaciones desde la página.
  }
}
