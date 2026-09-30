import { neighbors } from "./map.js";
import { STRUCTURES } from "./catalog.js";
import type { Player, World } from "./types.js";

/**
 * Random powerups on open tiles. Spawns are deterministic: each draw hashes
 * the match id with the spawn counter, so there is no generator state to
 * checkpoint and every peer and replay agrees. A powerup goes to the first
 * player whose connected network touches it; while two networks touch it at
 * once it stays contested.
 */
export const POWERUP_KINDS = ["cache", "regrowth", "surge", "frenzy"] as const;
export type PowerupKind = (typeof POWERUP_KINDS)[number];
export const BUFF_KINDS = ["surge", "frenzy"] as const;
export type BuffKind = (typeof BUFF_KINDS)[number];
export interface Powerup {
  id: number;
  cell: number;
  kind: PowerupKind;
  expiresAt: number;
}
export interface Buff {
  kind: BuffKind;
  expiresAt: number;
}

export const POWERUP_RULES = Object.freeze({
  /** First spawn one minute in, then every 40 s while fewer than two are out. */
  firstTick: 1200,
  interval: 800,
  lifetime: 900,
  maxActive: 2,
  /** Spawns keep this many hex steps from every brain. */
  minBrainDistance: 3,
  /** Fair spawns: brains' distances differ by at most this much. */
  fairness: 1,
  cacheBiomass: 150_000,
  cacheInsight: 50_000,
  regrowthPercent: 40,
  surgeTicks: 600,
  frenzyTicks: 400,
});

export const POWERUP_PRESENTATION: Record<
  PowerupKind,
  { label: string; description: string }
> = {
  cache: {
    label: "Nutrient cache",
    description: "+150 biomass and +50 insight at once.",
  },
  regrowth: {
    label: "Regrowth",
    description: "Heals every structure you own by 40% of its full health.",
  },
  surge: {
    label: "Growth surge",
    description: "Your builder grows construction twice as fast for 30 s.",
  },
  frenzy: {
    label: "Synaptic frenzy",
    description: "Your weapons fire twice as often for 20 s.",
  },
};

export const isPowerupKind = (value: unknown): value is PowerupKind =>
  typeof value === "string" &&
  (POWERUP_KINDS as readonly string[]).includes(value);
export const isBuffKind = (value: unknown): value is BuffKind =>
  typeof value === "string" &&
  (BUFF_KINDS as readonly string[]).includes(value);

/** Uniform draw in [0, 1) from the match id, spawn counter and a salt. */
export function powerupDraw(
  matchId: string,
  serial: number,
  salt: number,
): number {
  let h = 2166136261;
  for (let i = 0; i < matchId.length; i++)
    h = Math.imul(h ^ matchId.charCodeAt(i), 16777619);
  h ^= Math.imul(serial + 1, 0x9e3779b1);
  h ^= Math.imul(salt + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Steps between two cells of an odd-r hex map. */
export function hexDistance(width: number, a: number, b: number): number {
  const cube = (cell: number) => {
    const row = Math.floor(cell / width),
      col = cell % width;
    const x = col - (row - (row & 1)) / 2;
    return { x, z: row, y: -x - row };
  };
  const p = cube(a),
    q = cube(b);
  return Math.max(
    Math.abs(p.x - q.x),
    Math.abs(p.y - q.y),
    Math.abs(p.z - q.z),
  );
}

export function hasBuff(player: Player, kind: BuffKind, tick: number): boolean {
  return player.buffs.some((b) => b.kind === kind && b.expiresAt > tick);
}

/** Cells where a new powerup may appear this tick, in cell order. */
export function powerupCandidates(w: Readonly<World>): number[] {
  const brains = w.structures.filter(
    (s) =>
      s.kind === "brain" &&
      w.players.some((p) => p.alive && p.id === s.ownerId),
  );
  if (!brains.length) return [];
  const blocked = new Set([
    ...w.structures.map((s) => s.cell),
    ...w.powerups.map((p) => p.cell),
    ...w.players.flatMap((p) => p.queue.map((j) => j.cell)),
  ]);
  const touched = new Set(
    w.structures
      .filter((s) => s.connected)
      .flatMap((s) => [s.cell, ...neighbors(w.map, s.cell)]),
  );
  return w.map.cells.flatMap((cell, index) => {
    if (cell.terrain !== "open" || blocked.has(index) || touched.has(index))
      return [];
    const distances = brains.map((b) =>
      hexDistance(w.map.width, index, b.cell),
    );
    if (Math.min(...distances) < POWERUP_RULES.minBrainDistance) return [];
    if (
      Math.max(...distances) - Math.min(...distances) >
      POWERUP_RULES.fairness
    )
      return [];
    return [index];
  });
}

function claim(w: World, player: Player, powerup: Powerup) {
  const r = POWERUP_RULES;
  if (powerup.kind === "cache") {
    player.biomass = Math.min(1_000_000_000, player.biomass + r.cacheBiomass);
    player.insight = Math.min(1_000_000_000, player.insight + r.cacheInsight);
  } else if (powerup.kind === "regrowth") {
    for (const s of w.structures)
      if (s.ownerId === player.id) {
        const full = STRUCTURES[s.kind].hp;
        s.hp = Math.min(
          full,
          s.hp + Math.floor((full * r.regrowthPercent) / 100),
        );
      }
  } else {
    const duration = powerup.kind === "surge" ? r.surgeTicks : r.frenzyTicks;
    const existing = player.buffs.find((b) => b.kind === powerup.kind);
    // A second pickup of the same buff extends it rather than stacking.
    if (existing)
      existing.expiresAt = Math.max(existing.expiresAt, w.tick) + duration;
    else
      player.buffs.push({ kind: powerup.kind, expiresAt: w.tick + duration });
    player.buffs.sort((a, b) => (a.kind < b.kind ? -1 : 1));
  }
  w.outcomes.push({
    tick: w.tick,
    playerId: player.id,
    type: "claimed",
    cell: powerup.cell,
    reason: powerup.kind,
  });
}

/** Expire, claim and spawn powerups. Runs once per tick after construction. */
export function powerupPhase(w: World): void {
  for (const p of w.players)
    p.buffs = p.buffs.filter((b) => b.expiresAt > w.tick);
  if (!w.settings.powerups) return;
  w.powerups = w.powerups.filter((p) => p.expiresAt > w.tick);
  for (const powerup of [...w.powerups]) {
    const around = new Set([powerup.cell, ...neighbors(w.map, powerup.cell)]);
    const claimants = w.players.filter(
      (p) =>
        p.alive &&
        w.structures.some(
          (s) => s.ownerId === p.id && s.connected && around.has(s.cell),
        ),
    );
    if (claimants.length !== 1) continue;
    w.powerups.splice(w.powerups.indexOf(powerup), 1);
    claim(w, claimants[0]!, powerup);
  }
  const r = POWERUP_RULES;
  if (
    w.tick < r.firstTick ||
    (w.tick - r.firstTick) % r.interval !== 0 ||
    w.powerups.length >= r.maxActive
  )
    return;
  const candidates = powerupCandidates(w);
  if (!candidates.length) return;
  const cell =
    candidates[
      Math.floor(powerupDraw(w.matchId, w.powerupSerial, 0) * candidates.length)
    ]!;
  const kind =
    POWERUP_KINDS[
      Math.floor(
        powerupDraw(w.matchId, w.powerupSerial, 1) * POWERUP_KINDS.length,
      )
    ]!;
  w.powerupSerial++;
  w.powerups.push({
    id: w.nextEntityId++,
    cell,
    kind,
    expiresAt: w.tick + r.lifetime,
  });
}
