import {
  createWorld,
  createCombat,
  cancel,
  S,
  type World,
  type Tuning,
  type Combat,
} from "./world.js";
import { step } from "./step.js";
import { stepCombat } from "./combat.js";
import { decodeWorld, parseTuning, plain, integer } from "./codec.js";

export interface Keeper {
  id: string;
  slot: number;
  generation: number;
  connected: boolean;
  shield: number;
  hits: number;
  world: World;
}
export interface HitEvent {
  tick: number;
  by: string;
  target: string;
  x: number;
  y: number;
}
export interface Arena {
  tick: number;
  tuning: Tuning;
  combat: Combat;
  keepers: Keeper[];
  hit: HitEvent | null;
}
export interface Member {
  id: string;
  slot: number;
  generation: number;
  connected: boolean;
}
export function createArena(tuning: Tuning, tick = 0): Arena {
  return {
    tick,
    tuning: { ...tuning },
    combat: createCombat(tuning.experiment),
    keepers: [],
    hit: null,
  };
}
export function syncKeepers(arena: Arena, members: readonly Member[]): void {
  arena.keepers = [...members]
    .sort((a, b) => a.slot - b.slot)
    .map((member) => {
      const old = arena.keepers.find(
        (k) => k.id === member.id && k.slot === member.slot,
      );
      if (old) {
        if (!member.connected || old.generation !== member.generation)
          cancel(old.world);
        return { ...old, ...member };
      }
      const world = createWorld(arena.tuning, member.slot);
      world.tick = arena.tick;
      world.combat = arena.combat;
      return { ...member, world, shield: 30, hits: 0 };
    });
}
/** Stable slot order owns contested props; player impulses use pre-step hurt shapes and commit together. */
export function stepArena(arena: Arena, running = true): void {
  arena.tick++;
  const victims = arena.keepers
    .filter((k) => k.connected && !k.world.respawn && !k.shield)
    .map((k) => ({ id: k.id, x: k.world.x, feet: k.world.feet }));
  const pending: {
    by: Keeper;
    target: string;
    vx: number;
    vy: number;
    x: number;
    y: number;
  }[] = [];
  for (const keeper of arena.keepers) {
    const w = keeper.world;
    w.combat = arena.combat;
    const wasReturning = w.respawn > 0,
      reset = w.input.reset && !w.previous.reset;
    if (running && keeper.connected) {
      step(w, {
        rivals: victims.filter((v) => v.id !== keeper.id),
        hit: (target, vx, vy, x, y) =>
          pending.push({ by: keeper, target, vx, vy, x, y }),
      });
      keeper.shield =
        (wasReturning && !w.respawn) || reset
          ? 30
          : Math.max(0, keeper.shield - 1);
    } else {
      cancel(w);
      w.tick++;
    }
    // A personal return does not reset shared props. With one keeper, retain the solo reset behavior.
    if (reset && arena.keepers.length === 1) arena.combat = w.combat;
    w.combat = arena.combat;
  }
  for (const impact of pending) {
    const victim = arena.keepers.find((k) => k.id === impact.target)!;
    if (victim.world.respawn || victim.shield) continue;
    const cap = Math.round((1000 * S) / 60);
    victim.world.vx = Math.max(
      -cap,
      Math.min(cap, victim.world.vx + impact.vx),
    );
    victim.world.vy = Math.max(
      -cap,
      Math.min(cap, victim.world.vy + impact.vy),
    );
    victim.world.grounded = false;
    victim.world.coyote = 0;
    impact.by.hits = Math.min(0xffffffff, impact.by.hits + 1);
    arena.hit = {
      tick: arena.tick,
      by: impact.by.id,
      target: victim.id,
      x: impact.x,
      y: impact.y,
    };
  }
  if (running && arena.keepers.some((k) => k.connected)) {
    const holder = arena.keepers[0]!.world;
    holder.combat = arena.combat;
    stepCombat(holder);
  }
  for (const k of arena.keepers) k.world.combat = arena.combat;
}
export function encodeArena(arena: Arena): unknown {
  return {
    tick: arena.tick,
    tuning: { ...arena.tuning },
    combat: structuredClone(arena.combat),
    hit: arena.hit && { ...arena.hit },
    keepers: arena.keepers.map((k) => {
      const {
        tick: _tick,
        tuning: _tuning,
        combat: _combat,
        ...body
      } = k.world;
      return {
        id: k.id,
        slot: k.slot,
        generation: k.generation,
        connected: k.connected,
        shield: k.shield,
        hits: k.hits,
        body: structuredClone(body),
      };
    }),
  };
}
const id = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 128 &&
  !/[\x00-\x1f\x7f]/.test(v);
export function decodeArena(raw: unknown): Arena | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).length !== 5 ||
    !integer(raw.tick, 0, 0xffffffff * 3) ||
    !Array.isArray(raw.keepers) ||
    raw.keepers.length > 5
  )
    return;
  const tuning = parseTuning(raw.tuning);
  if (!tuning) return;
  const probe = decodeWorld({
    ...createWorld(tuning),
    tick: raw.tick,
    combat: raw.combat,
  });
  if (!probe) return;
  const arena = createArena(tuning, raw.tick);
  arena.combat = probe.combat;
  const h = raw.hit;
  if (h !== null) {
    if (
      !plain(h) ||
      Object.keys(h).length !== 5 ||
      !integer(h.tick, 1, raw.tick) ||
      !id(h.by) ||
      !id(h.target) ||
      h.by === h.target ||
      !integer(h.x, 0, 1600 * S) ||
      !integer(h.y, -2000 * S, 1000 * S)
    )
      return;
    arena.hit = { tick: h.tick, by: h.by, target: h.target, x: h.x, y: h.y };
  }
  for (const k of raw.keepers) {
    if (
      !plain(k) ||
      Object.keys(k).length !== 7 ||
      !id(k.id) ||
      !integer(k.slot, 0, 4) ||
      !integer(k.generation, 0, 0xffffffff) ||
      typeof k.connected !== "boolean" ||
      !integer(k.shield, 0, 30) ||
      !integer(k.hits, 0, 0xffffffff) ||
      !plain(k.body) ||
      Object.hasOwn(k.body, "tick") ||
      Object.hasOwn(k.body, "tuning") ||
      Object.hasOwn(k.body, "combat") ||
      arena.keepers.some(
        (old) => old.id === k.id || old.slot >= (k.slot as number),
      )
    )
      return;
    const world = decodeWorld({
      ...k.body,
      tick: raw.tick,
      tuning,
      combat: raw.combat,
    });
    if (!world || world.slot !== k.slot) return;
    world.combat = arena.combat;
    arena.keepers.push({
      id: k.id,
      slot: k.slot,
      generation: k.generation,
      connected: k.connected,
      shield: k.shield,
      hits: k.hits,
      world,
    });
  }
  return arena;
}
