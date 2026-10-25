import type { Template } from "./generate.js";
import type { LaneTemplate } from "./lanes.js";

/** The generated maps, by file id (`maps/<id>.json`): one per team size, at about the scale of Z and StarCraft. */
export const TEMPLATES: Readonly<Record<string, Template>> = {
  "rust-canyon": {
    name: "Rust Canyon",
    seed: 1101,
    width: 192,
    height: 128,
    players: 2,
    biome: "desert",
    symmetry: "mirror",
    flags: 32,
    river: { bridges: 2, fords: 1 },
    plateaus: 1,
    lakes: 1,
    rocks: 16,
    vehicles: 30,
  },
  "glass-lakes": {
    name: "Glass Lakes",
    seed: 2202,
    width: 224,
    height: 160,
    players: 4,
    biome: "desert",
    symmetry: "rotate",
    flags: 40,
    plateaus: 2,
    lakes: 4,
    rocks: 22,
    vehicles: 30,
  },
  "iron-delta": {
    name: "Iron Delta",
    seed: 3303,
    width: 256,
    height: 192,
    players: 6,
    biome: "desert",
    symmetry: "mirror",
    flags: 48,
    river: { bridges: 3, fords: 1 },
    plateaus: 2,
    lakes: 2,
    rocks: 26,
    vehicles: 30,
  },
};

/** The lane maps of design v3 (`mapgen/lanes.ts`), one per team size, sized so a grunt walks a lane in about 60–90 s. */
export const LANE_TEMPLATES: Readonly<Record<string, LaneTemplate>> = {
  "neon-duel": {
    name: "Neon Duel",
    seed: 4404,
    size: 176,
    players: 2,
    biome: "jungle",
    lanes: 1,
    jungle: 8,
    vehicles: 40,
  },
  "twin-wilds": {
    name: "Twin Wilds",
    seed: 5505,
    size: 176,
    players: 4,
    biome: "jungle",
    lanes: 3,
    jungle: 12,
    vehicles: 35,
  },
  "crown-jungle": {
    name: "Crown Jungle",
    seed: 6606,
    size: 180,
    players: 6,
    biome: "jungle",
    lanes: 3,
    jungle: 16,
    vehicles: 35,
  },
};
