"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Video de fondo de la portada. React no serializa `muted` en el HTML del servidor, y sin ese
 * atributo el navegador bloquea el autoplay: lo forzamos en el cliente y arrancamos la reproducción.
 * Si el usuario prefiere menos movimiento, no se reproduce (queda la imagen de fondo).
 */
export function HeroVideo({ src, poster, className }: { src: string; poster: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    v.muted = true;
    v.defaultMuted = true;
    const onPlaying = () => setVisible(true);
    const tryPlay = () => {
      if (document.visibilityState === "visible" && v.paused) void v.play().catch(() => {});
    };
    v.addEventListener("playing", onPlaying);
    document.addEventListener("visibilitychange", tryPlay);
    tryPlay();
    return () => {
      v.removeEventListener("playing", onPlaying);
      document.removeEventListener("visibilitychange", tryPlay);
    };
  }, []);

  return (
    <video
      ref={ref}
      className={`${className ?? ""} transition-opacity duration-1000 ${visible ? "opacity-100" : "opacity-0"}`}
      muted
      loop
      playsInline
      preload="auto"
      poster={poster}
      aria-hidden
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}
