import type Phaser from "phaser";

/**
 * The art the arena loads, and the frame layouts inside each strip. Ported from the game's `BootScene`:
 * the images are the same files, cut by `scripts/build-assets.py` in the game's own repository.
 */

/** One truck sprite per grid slot, in slot order. */
export const TRUCK_COLORS = [
  "cyan",
  "pink",
  "lime",
  "orange",
  "violet",
] as const;
/** Cell size of a truck sheet, and of the 128 px item/effect strips. */
export const TRUCK_CELL = 256;
export const SPRITE_CELL = 128;

/** Frame indices in the split strips. */
export const FRAMES = {
  projectiles: {
    missile: 0,
    mineArmed: 2,
    mineUnarmed: 3,
    drone: 4,
    shield: 5,
    oil: 6,
    emp: 7,
  },
  icons: {
    missile: 0,
    mine: 1,
    oil: 2,
    nitro: 3,
    shield: 4,
    drone: 5,
    emp: 6,
    empty: 7,
  },
  explosionFrames: [0, 1, 2, 3, 4],
  /** Brown dirt puffs in the dust strip. */
  dust: [1, 2, 3, 4],
  /** bars strip: lit/unlit pairs; the armor pair for a truck colour sits at 2 * slot. */
  bars: { nitro: 10, nitroEmpty: 11 },
  countdown: { go: 3, finish: 4 },
} as const;

/** Cell sizes of the HUD strips. */
export const HUD_CELL = {
  portraits: 128,
  bars: 64,
  countdown: 640,
  placements: 256,
  logo: 768,
} as const;

/** Nine-slice panels, one per truck colour plus the neutral frames. */
export const PANELS = [
  "grey",
  "cyan",
  "pink",
  "lime",
  "orange",
  "violet",
  "gold",
  "bar",
] as const;

/** Frames in the decor strip. */
export const DECOR = {
  drum: 0,
  tyres: 1,
  pipe: 2,
  elbow: 3,
  tank: 4,
  sign: 7,
  light: 8,
  crowd: [12, 13, 14],
} as const;

/** Made-up sponsors for the trackside boards: text, panel colour, text colour. */
export const SPONSORS = [
  ["MR.GRIP", "#d62828", "#ffffff"],
  ["FUSE OIL", "#ffe600", "#111111"],
  ["TURBO", "#1f5fd6", "#ffffff"],
  ["NITRO-X", "#ffffff", "#d62828"],
  ["DIRT KING", "#111111", "#ffe600"],
] as const;

/** Text style every label in the arena starts from. */
export const FONT = {
  fontFamily: "monospace",
  color: "#ffffff",
  stroke: "#000000",
  strokeThickness: 6,
} as const;

/** Where the images are served from, relative to the page's base. */
export const defaultAssetBase = (): string =>
  `${import.meta.env.BASE_URL}assets/`;

/**
 * Queue every file the arena draws with. `base` ends with a slash and is resolved against the page, never
 * against the module, so a project-path deployment (GitHub Pages) reaches the same files.
 */
export function queueArenaAssets(
  load: Phaser.Loader.LoaderPlugin,
  base: string,
): void {
  const url = (name: string): string => `${base}${name}.png`;
  for (const name of ["grandstand", "fence", "wreck"])
    load.image(name, url(name));
  for (const color of TRUCK_COLORS)
    load.image(`truck-${color}`, url(`truck-${color}`));
  for (const name of [
    "itembox",
    "projectiles",
    "explosion",
    "icons",
    "dust",
    "decor",
  ])
    load.spritesheet(name, url(name), {
      frameWidth: SPRITE_CELL,
      frameHeight: SPRITE_CELL,
    });
  for (const [name, size] of Object.entries(HUD_CELL))
    load.spritesheet(name, url(name), { frameWidth: size, frameHeight: size });
  for (const panel of PANELS)
    load.image(`panel-${panel}`, url(`panel-${panel}`));
}
