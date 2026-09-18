import {
  bombFuseTicks,
  GRAVITY_FIELD_TICKS,
  GRAVITY_MAX_HOLES_PER_PICKUP,
  INK_DURATION_TICKS,
  NITRO_DURATION_TICKS,
  NITRO_SPEED,
  SNAIL_DURATION_TICKS,
  SNAIL_SPEED,
  STAR_DURATION_TICKS,
  TICK_HZ,
  type PickupType,
} from "../engine/game.js";
import { DRUNK_DURATION_TICKS } from "../engine/drunk.js";
import { PICKUP_WEIGHTS } from "../engine/pickup-weights.js";
import { POWER_TUNING } from "../engine/power-progression.js";

export interface PowerupGuideEntry {
  type: PickupType;
  name: string;
  description: string;
  /** False for pickups that only spawn when a host enables them in room settings. */
  spawnsByDefault: boolean;
}

const seconds = (ticks: number): string => `${ticks / TICK_HZ}s`;

// Keyed by PickupType so a new pickup fails to typecheck until it has a guide entry; key order is display order.
const copy: Record<PickupType, readonly [name: string, description: string]> = {
  power: [
    "POWER",
    `each pickup improves blast size and reload with diminishing returns, and adds ${seconds(POWER_TUNING.trailTicksPerPickup)} of trail for this round`,
  ],
  extraBomb: [
    "EXTRA BOMB",
    "+1 bomb per ordinary shot for this round, up to 9; stacks with Triple/Five",
  ],
  triple: ["TRIPLE", "next ordinary shot adds 2 bombs"],
  five: ["FIVE", "next ordinary shot adds 4 bombs (overrides Triple)"],
  shell: [
    "SHELL",
    "next shot bounces off walls and trails, and through portal gates, until it hits a rider, you included",
  ],
  gun: [
    "GUN",
    "tap to fire instantly ahead, or hold and steer to swing the sight, then release; goes through any portal gate, stops at the first body, cuts a small hole, and kills near its head",
  ],
  stopwatch: [
    "FUSE",
    `shorter bomb fuses for this round: ${[0, 1, 2].map((level) => seconds(bombFuseTicks(level))).join(" → ")}`,
  ],
  orbitShield: ["SHIELD", "blocks one crash"],
  portal: [
    "PORTAL",
    "opens a pair of linked gates; shells and gun shots come through them too",
  ],
  beer: ["BEER", `rivals wobble for ${seconds(DRUNK_DURATION_TICKS)}`],
  ink: ["INK", `clouds rivals' view for ${seconds(INK_DURATION_TICKS)}`],
  star: ["STAR", `invulnerable for ${seconds(STAR_DURATION_TICKS)}`],
  range: [
    "RANGE",
    "longer maximum bomb reach for this round: 1.5× → 1.75× → 2×; stacks up to 3 times",
  ],
  grip: [
    "GRIP",
    "43% tighter turn radius for this round; collect once, leave later drops for rivals",
  ],
  nitro: [
    "NITRO",
    `${NITRO_SPEED}× speed for ${seconds(NITRO_DURATION_TICKS)}; every pickup stacks, so two run at ${NITRO_SPEED * NITRO_SPEED}×`,
  ],
  snail: [
    "SNAIL",
    `rivals crawl at ${SNAIL_SPEED}× speed for ${seconds(SNAIL_DURATION_TICKS)}; stacks, and cancels a Nitro one for one`,
  ],
  gravity: [
    "GRAVITY",
    `opens 1–${GRAVITY_MAX_HOLES_PER_PICKUP} black holes for ${seconds(GRAVITY_FIELD_TICKS)}; space curves there, so every rider's path bends around them, and falling into a core kills`,
  ],
};

const defaultSpawns = new Set(
  PICKUP_WEIGHTS.filter((row) => row.weight > 0).map((row) => row.type),
);

export const POWERUP_GUIDE: readonly PowerupGuideEntry[] = (
  Object.entries(copy) as Array<[PickupType, readonly [string, string]]>
).map(([type, [name, description]]) => ({
  type,
  name,
  description,
  spawnsByDefault: defaultSpawns.has(type),
}));
