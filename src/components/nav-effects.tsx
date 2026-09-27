"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** Cierra los menús desplegables (<details>) al navegar o al hacer clic afuera. */
export function NavEffects() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    document.querySelectorAll("header details[open]").forEach((d) => d.removeAttribute("open"));
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      document.querySelectorAll("header details[open]").forEach((d) => {
        if (!d.contains(e.target as Node)) d.removeAttribute("open");
      });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
