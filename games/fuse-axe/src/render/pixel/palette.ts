/**
 * The master palette. Every sprite pixel is a one-character key into it. Lit materials come as three-key ramps
 * (light, base, shadow): shadows lean violet and lights lean gold. Unlit keys are flat colours; all of them but the
 * outline ink `k` glow, so nothing draws an outline against them.
 */
export type Palette = Readonly<Record<string, string>>;

/** A ramp's three keys, light to shadow, and their colours. */
export type Ramp = readonly [
  keys: string,
  light: string,
  base: string,
  shadow: string,
];

export const OUTLINE = "k";

/** The lit materials, by group. */
export const RAMPS: Readonly<Record<string, readonly Ramp[]>> = {
  Skin: [
    ["Ss1", "#ffd1a1", "#e0905c", "#9c4f45"],
    ["Oo2", "#b8bc78", "#7c8650", "#464c3e"],
  ],
  "Hair & bone": [
    ["Hh3", "#fff0a0", "#f0b83c", "#a8632e"],
    ["Ee4", "#ff9a5c", "#d8462e", "#842439"],
    ["Ww5", "#f2ece6", "#b4a8b0", "#6c5e78"],
    ["Bb6", "#fff6dc", "#dcc49a", "#94786e"],
  ],
  Metal: [
    ["Mm7", "#f4f8ff", "#a8b4cc", "#5a5c80"],
    ["Nn8", "#ffe08a", "#d8973a", "#8a4e2e"],
    ["Ii#", "#8c7ab0", "#4c3c70", "#241a3c"],
  ],
  "Cloth & leather": [
    ["Ll9", "#c98a58", "#8c5236", "#4f2c2e"],
    ["Cc0", "#ff6a54", "#c8303a", "#6e1838"],
    ["Vv!", "#8cd46a", "#3e8c4a", "#1f4a3e"],
    ["Uu@", "#78b4ff", "#3c5ce0", "#262e8c"],
  ],
  "Enemy tiers": [
    ["Aa$", "#cfc6c8", "#8e8494", "#514a60"],
    ["Tt%", "#f2a060", "#b85a2c", "#6e2c2a"],
    ["Qq^", "#d29aff", "#8c4ad8", "#46247a"],
  ],
  Beasts: [
    ["Yy&", "#9ee0b4", "#4ea08a", "#285058"],
    ["Xx*", "#ffb060", "#d85a2e", "#7c2838"],
  ],
};

/** The outline ink, then the glowing keys: fire and ember (F f ~ =) and the platform's UI neon. */
export const UNLIT: Palette = {
  [OUTLINE]: "#150c1f",
  F: "#fff6b8",
  f: "#ffc22e",
  "~": "#f86420",
  "=": "#a82434",
  G: "#16e7ff",
  P: "#ff2e9d",
  J: "#b6ff4d",
  D: "#ffe46b",
  Z: "#ffffff",
  g: "#6544c2",
};

const rampOfKey = new Map(
  Object.values(RAMPS).flatMap((ramps) =>
    ramps.flatMap(([keys]) => [...keys].map((key) => [key, keys] as const)),
  ),
);

/** Every key's colour. */
export const MASTER: Palette = {
  ...Object.fromEntries(
    Object.values(RAMPS).flatMap((ramps) =>
      ramps.flatMap(([keys, ...colors]) =>
        [...keys].map((key, shade) => [key, colors[shade]!]),
      ),
    ),
  ),
  ...UNLIT,
};

/** The ramp (`"Ss1"`) a lit key belongs to, or undefined for an unlit key. */
export const rampOf = (key: string): string | undefined => rampOfKey.get(key);

/** The key's shade on its ramp, 0 light to 2 shadow; an unlit key is its own every shade. */
export const shade = (key: string, level: 0 | 1 | 2): string =>
  rampOf(key)?.[level] ?? key;

/** Glowing keys (fire, smears, neon) take no outline against them. */
export const glows = (key: string): boolean =>
  key !== OUTLINE && Object.hasOwn(UNLIT, key);

/** A swap that recolours one ramp with another's colours, e.g. an enemy tier: `rampSwap("Aa$", "Tt%")`. */
export function rampSwap(from: string, to: string): Palette {
  return Object.fromEntries([...from].map((key, i) => [key, MASTER[to[i]!]!]));
}
