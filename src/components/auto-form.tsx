"use client";
import { useRef } from "react";

/** Formulario GET que se envía solo al cambiar un filtro (los textos, con una pequeña espera). */
export function AutoForm({ children, className, action }: { children: React.ReactNode; className?: string; action?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <form
      ref={ref}
      action={action}
      className={className}
      onChange={(e) => {
        const target = e.target as unknown as HTMLInputElement;
        if (timer.current) clearTimeout(timer.current);
        const delay = target.type === "text" || target.type === "search" || target.inputMode === "decimal" || target.type === "number" ? 500 : 0;
        timer.current = setTimeout(() => ref.current?.requestSubmit(), delay);
      }}
    >
      {children}
    </form>
  );
}
