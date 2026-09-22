import { cos, sin, TAU } from "./math.js";

export const MAP_IDS = ["classic", "crossfire", "ricochet"] as const;
export type MapId = (typeof MAP_IDS)[number];

export interface MapBlock {
  x: number;
  y: number;
}
export interface Bumper {
  x: number;
  y: number;
  radius: number;
}
export interface ArenaMap {
  id: MapId;
  label: string;
  description: string;
  blocks: readonly MapBlock[];
  bumpers: readonly Bumper[];
}

const ring = (count: number, radius: number, offset = 0): MapBlock[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = (TAU * (i + offset)) / count;
    return { x: cos(angle) * radius, y: sin(angle) * radius };
  });

const classic = [...ring(12, 34), ...ring(16, 50, 0.5), ...ring(20, 66)];
const crossfire = [
  ...ring(8, 34, 0.5),
  ...ring(12, 50, 0.5).filter((_, i) => i % 3 !== 0),
  ...ring(20, 66).filter((_, i) => i % 5 !== 0),
];
const bumpers = Array.from({ length: 5 }, (_, i) => {
  const angle = -Math.PI / 2 + (TAU * i) / 5;
  return { x: 500 + cos(angle) * 72, y: 500 + sin(angle) * 72, radius: 15 };
});

export const ARENA_MAPS: Readonly<Record<MapId, ArenaMap>> = {
  classic: {
    id: "classic",
    label: "CLASSIC CIRCUIT",
    description: "Dense armor and a clean field.",
    blocks: classic,
    bumpers: [],
  },
  crossfire: {
    id: "crossfire",
    label: "CROSSFIRE",
    description: "Open armor lanes make every return dangerous.",
    blocks: crossfire,
    bumpers: [],
  },
  ricochet: {
    id: "ricochet",
    label: "RICOCHET REACTOR",
    description: "Five central bumpers scramble predictable shots.",
    blocks: classic,
    bumpers,
  },
};

export const isMapId = (value: unknown): value is MapId =>
  typeof value === "string" && MAP_IDS.includes(value as MapId);
