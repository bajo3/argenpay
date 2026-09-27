import "server-only";
import { redirect } from "next/navigation";

export function withMessage(path: string, kind: "error" | "ok", message: string): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("ok");
  params.set(kind, message.slice(0, 300));
  return `${base}?${params.toString()}`;
}

export function fail(path: string, message: string): never {
  redirect(withMessage(path, "error", message));
}

export function done(path: string, message: string): never {
  redirect(withMessage(path, "ok", message));
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return "Ocurrió un error inesperado";
}

/** Solo rutas internas (evita open redirects). */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = "/"): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : fallback;
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
