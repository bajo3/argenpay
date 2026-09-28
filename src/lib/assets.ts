/** Arte generado para Argenpay LU4 (public/lu4). Estilo propio, sin logos ni personajes oficiales. */

export const HERO = {
  image: "/lu4/portada-a.webp",
  imageSm: "/lu4/portada-a-sm.webp",
  video: "/lu4/portada.mp4",
  siege: "/lu4/portada-b.webp",
  siegeSm: "/lu4/portada-b-sm.webp",
};

export const CATEGORY_ICON: Record<string, string> = {
  adena: "/lu4/icono-adena.webp",
  cuentas: "/lu4/icono-cuentas.webp",
  items: "/lu4/icono-items.webp",
  coins: "/lu4/icono-coins.webp",
  servicios: "/lu4/icono-servicios.webp",
  otros: "/lu4/icono-otros.webp",
};

export const SERVER_EMBLEM: Record<string, string> = {
  Carmine: "/lu4/server-carmine.webp",
  Gamma: "/lu4/server-gamma.webp",
  Black: "/lu4/server-black.webp",
  White: "/lu4/server-white.webp",
};

export function categoryIcon(slug: string | null | undefined): string | null {
  return (slug && CATEGORY_ICON[slug]) || null;
}

export function serverEmblem(name: string | null | undefined): string | null {
  return (name && SERVER_EMBLEM[name]) || null;
}
