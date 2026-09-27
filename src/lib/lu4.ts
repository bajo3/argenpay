/** Datos de dominio de Lineage 2 LU4 (lu4.org, crónica Interlude). */

export const RACES = [
  { value: "humano", label: "Humano" },
  { value: "elfo", label: "Elfo" },
  { value: "elfo_oscuro", label: "Elfo oscuro" },
  { value: "orco", label: "Orco" },
  { value: "enano", label: "Enano" },
] as const;

export type Race = (typeof RACES)[number]["value"];

export const EQUIPMENT = [
  { value: "desnudo", label: "Desnudo" },
  { value: "equipado", label: "Equipado" },
] as const;

export function raceLabel(value: string | null | undefined): string | null {
  return RACES.find((r) => r.value === value)?.label ?? null;
}

/** Clases de 2.ª y 3.ª profesión de Interlude (sugerencias; el vendedor puede escribir otra). */
export const CLASSES = [
  "Gladiator", "Duelist", "Warlord", "Dreadnought", "Paladin", "Phoenix Knight", "Dark Avenger", "Hell Knight",
  "Treasure Hunter", "Adventurer", "Hawkeye", "Sagittarius", "Sorcerer", "Archmage", "Necromancer", "Soultaker",
  "Warlock", "Arcana Lord", "Bishop", "Cardinal", "Prophet", "Hierophant",
  "Temple Knight", "Eva's Templar", "Swordsinger", "Sword Muse", "Plainswalker", "Wind Rider", "Silver Ranger",
  "Moonlight Sentinel", "Spellsinger", "Mystic Muse", "Elemental Summoner", "Elemental Master", "Elven Elder", "Eva's Saint",
  "Shillien Knight", "Shillien Templar", "Bladedancer", "Spectral Dancer", "Abyss Walker", "Ghost Hunter",
  "Phantom Ranger", "Ghost Sentinel", "Spellhowler", "Storm Screamer", "Phantom Summoner", "Spectral Master",
  "Shillien Elder", "Shillien Saint",
  "Destroyer", "Titan", "Tyrant", "Grand Khavatari", "Overlord", "Dominator", "Warcryer", "Doomcryer",
  "Bounty Hunter", "Fortune Seeker", "Warsmith", "Maestro",
];

/** Un vendedor está "en línea" si tuvo actividad en los últimos 5 minutos. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** Límite para el filtro "solo en línea". */
export function onlineCutoffISO(now = Date.now()): string {
  return new Date(now - ONLINE_WINDOW_MS).toISOString();
}

export function isOnline(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  return !!lastSeenAt && now - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

export function lastSeenLabel(lastSeenAt: string | null | undefined, now = Date.now()): string {
  if (!lastSeenAt) return "Sin actividad reciente";
  if (isOnline(lastSeenAt, now)) return "En línea";
  const mins = Math.round((now - new Date(lastSeenAt).getTime()) / 60000);
  if (mins < 60) return `Visto hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Visto hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `Visto hace ${days} día${days === 1 ? "" : "s"}`;
}

/** Antigüedad corta de una cuenta: "3 años", "5 meses", "12 días". */
export function accountAge(createdAt: string, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 86400000));
  if (days >= 365) {
    const y = Math.floor(days / 365);
    return `${y} año${y === 1 ? "" : "s"}`;
  }
  if (days >= 30) {
    const m = Math.floor(days / 30);
    return `${m} mes${m === 1 ? "" : "es"}`;
  }
  return days <= 1 ? "nuevo" : `${days} días`;
}

const intFmt = new Intl.NumberFormat("es-AR");

/** "5.000 kk", "1 cuenta", "3 ítems" */
export function formatQty(n: number, unit: string, plural: string): string {
  return `${intFmt.format(n)} ${n === 1 ? unit : plural}`;
}
