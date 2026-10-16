/** Team colours, metal ramps and the four map biomes. */
import type { Colour, Rgba, SpritePalette } from "./image.js";
import type { Ramp } from "./shape.js";

/** A team's dark, base, light and highlight shades. */
export interface TeamColours {
  readonly T: string;
  readonly t: string;
  readonly u: string;
  readonly l: string;
}

export type TeamId = "red" | "blue" | "neutral" | "wreck";

export const TEAM: Readonly<Record<TeamId, TeamColours>> = {
  red: { T: "#6e1410", t: "#c8301c", u: "#f86a40", l: "#ffb090" },
  blue: { T: "#142a6e", t: "#2a5ad0", u: "#6aa0ff", l: "#b8d4ff" },
  neutral: { T: "#4e4e4e", t: "#8e8e8e", u: "#cacaca", l: "#f0f0f0" },
  wreck: { T: "#1a1614", t: "#2e2824", u: "#4a403a", l: "#5a5048" },
};

/** A full five-shade bevel ramp (outline, shadow, mid, light, sparkle). */
export type Ramp5 = readonly [Colour, Colour, Colour, Colour, Colour];

export const METAL: Ramp5 = [
  "#101010",
  "#4a4e52",
  "#7a7e82",
  "#b0b4b8",
  "#e8ecf0",
];
export const DARK_METAL: Ramp5 = [
  "#101010",
  "#24272a",
  "#3a3e42",
  "#5a5e62",
  "#8a8e92",
];
export const GOLD: Ramp5 = [
  "#101010",
  "#8a5a10",
  "#d89a20",
  "#f8d030",
  "#fff4b0",
];

/** A team's colours as a bevel ramp. */
export const teamRamp = (T: TeamColours): Ramp => [
  "#101010",
  T.T,
  T.t,
  T.u,
  T.l,
];

/** Concrete for forts and factories. */
export const CONCRETE = {
  mid: "#86847a",
  hi: "#bab8ac",
  lo: "#4e4c46",
} as const;

/** The robot sprite palette for a team. */
export function robotPalette(tm: TeamId): SpritePalette {
  const T = TEAM[tm];
  return {
    k: "#101010",
    d: "#3a3c40",
    g: "#6e7276",
    G: "#a8acb0",
    w: "#e8ece8",
    y: "#f8d030",
    o: "#f08020",
    e: "#50e0ff",
    r: "#f03020",
    t: T.t,
    T: T.T,
    u: T.u,
  };
}

/** Sparse single-pixel ground detail scattered over a biome. */
export interface BiomeSpeck {
  /** Chance per pixel (applied after pebbles). */
  readonly chance: number;
  readonly colour: Colour;
  /** Drawn one pixel above, e.g. a grass blade's tip. */
  readonly above?: Colour;
}

export interface Biome {
  /** Ground shades from dark to light. */
  readonly base: readonly [Colour, Colour, Colour, Colour];
  readonly peb: Colour;
  readonly pebHi: Colour;
  readonly rock: Ramp5;
  /** Crater rim: shadowed far side, lit near side. */
  readonly crater: readonly [Colour, Colour];
  /** Deep, shallow, ripple and foam. */
  readonly water: readonly [Colour, Colour, Colour, Colour];
  readonly bank: Colour;
  /** The tint laid over raised plateaus. */
  readonly lift: Rgba;
  readonly speck?: BiomeSpeck;
}

export type BiomeId = "desert" | "arctic" | "jungle" | "volcanic";

export const BIOME: Readonly<Record<BiomeId, Biome>> = {
  desert: {
    base: ["#b48448", "#c49456", "#d2a464", "#dfb474"],
    peb: "#8a6234",
    pebHi: "#efce94",
    rock: ["#2e2014", "#6a4628", "#94683c", "#c4925a", "#e8c088"],
    crater: ["#7a5630", "#e8c890"],
    water: ["#1a4268", "#285a88", "#4c84b8", "#a8d0f0"],
    bank: "#866432",
    lift: [255, 236, 200, 56],
  },
  arctic: {
    base: ["#a2b6c8", "#b6c8d8", "#cadaea", "#e2eef8"],
    peb: "#8298ae",
    pebHi: "#ffffff",
    rock: ["#1a2430", "#3a4858", "#5a6c80", "#8a9cb0", "#c4d4e4"],
    crater: ["#7a90a6", "#ffffff"],
    water: ["#123050", "#1e4870", "#3a74a8", "#c0e4ff"],
    bank: "#f4fbff",
    lift: [255, 255, 255, 40],
    speck: { chance: 0.02, colour: "#ffffff" },
  },
  jungle: {
    base: ["#2c5020", "#365e26", "#426c2e", "#4e7a36"],
    peb: "#22401a",
    pebHi: "#80b050",
    rock: ["#161c0e", "#363622", "#56523a", "#7a7452", "#a8a072"],
    crater: ["#243a16", "#6a9a40"],
    water: ["#163a3e", "#205056", "#367a76", "#8ac8b8"],
    bank: "#5a4828",
    lift: [230, 255, 200, 26],
    speck: { chance: 0.03, colour: "#5e8e3a", above: "#86b852" },
  },
  volcanic: {
    base: ["#262020", "#302826", "#3a302c", "#463a34"],
    peb: "#161212",
    pebHi: "#6a5a50",
    rock: ["#0c0a0a", "#262020", "#40342e", "#5e4e44", "#8a7464"],
    crater: ["#141010", "#7a5a40"],
    water: ["#7a1606", "#c43a0a", "#f07a18", "#ffd848"],
    bank: "#140e0c",
    lift: [255, 200, 160, 20],
    speck: { chance: 0.012, colour: "#c84a14" },
  },
};
