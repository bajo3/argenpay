import { redirect } from "next/navigation";

/** Ruta anterior: ahora se publica desde /publicar/[tipo]. */
export default function NewListingRedirect() {
  redirect("/publicar");
}
