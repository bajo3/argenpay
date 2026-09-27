import { redirect } from "next/navigation";

/** Ruta anterior: redirige al listado de lotes LU4 conservando la búsqueda. */
export default async function SearchRedirect(props: PageProps<"/buscar">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  redirect(q ? `/lotes/todos?q=${encodeURIComponent(q)}` : "/lotes/todos");
}
