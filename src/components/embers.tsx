/** Brasas flotantes decorativas (CSS puro, se desactivan con prefers-reduced-motion). */
export function Embers({ count = 22 }: { count?: number }) {
  // Posiciones deterministas para que servidor y cliente rendericen lo mismo.
  const items = Array.from({ length: count }, (_, i) => {
    const r = (n: number) => ((i * 9301 + n * 49297) % 233280) / 233280;
    return {
      left: `${Math.round(r(1) * 100)}%`,
      duration: `${6 + r(2) * 8}s`,
      delay: `${-r(3) * 12}s`,
      drift: `${Math.round((r(4) - 0.5) * 80)}px`,
      scale: 0.6 + r(5) * 1.2,
    };
  });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((e, i) => (
        <span
          key={i}
          className="ember"
          style={{
            left: e.left,
            animationDuration: e.duration,
            animationDelay: e.delay,
            transform: `scale(${e.scale})`,
            ["--drift" as string]: e.drift,
          }}
        />
      ))}
    </div>
  );
}
