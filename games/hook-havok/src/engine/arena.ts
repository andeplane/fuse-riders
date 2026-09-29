import {
  createWorld,
  createCombat,
  cancel,
  S,
  WIDTH,
  type World,
  type Tuning,
  type Combat,
} from "./world.js";
import { step } from "./step.js";
import { stepCombat } from "./combat.js";
import {
  stepPowerUps,
  POWER_COOLDOWN,
  WARD_TICKS,
  type PickupEvent,
} from "./power-ups.js";
import { decodeWorld, parseTuning, plain, integer } from "./codec.js";
import {
  createContest,
  decodeContest,
  finishContest,
  COUNTDOWN_TICKS,
  ROUND_TICKS,
  type Contest,
} from "./contest.js";
import {
  freshKit,
  pruneBombEvents,
  stepBombs,
  type Blast,
  type Bomb,
  type BombKit,
  type Knockout,
} from "./bomb.js";
import {
  BOMB_CEILING,
  BOMB_FLOOR,
  COOLDOWN_TICKS,
  EVENT_TICKS,
  FALL_SHIELD,
  FUSE_TICKS,
  KO_SHIELD,
  MAX_BOMBS,
  MAX_BOMB_SPEED,
  MAX_EVENTS,
} from "./bomb-rules.js";

export interface Keeper {
  id: string;
  slot: number;
  generation: number;
  connected: boolean;
  /** Spawn protection ticks: hooks and blasts pass through. */
  shield: number;
  ward: number;
  hits: number;
  bomb: BombKit;
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
  powerCooldowns: number[];
  pickupEvents: PickupEvent[];
  contest: Contest;
  tick: number;
  tuning: Tuning;
  combat: Combat;
  keepers: Keeper[];
  hit: HitEvent | null;
  bombs: Bomb[];
  blasts: Blast[];
  knockouts: Knockout[];
}
export interface Member {
  id: string;
  slot: number;
  generation: number;
  connected: boolean;
}
export function createArena(tuning: Tuning, tick = 0): Arena {
  return {
    powerCooldowns: [0, 0],
    pickupEvents: [],
    contest: createContest(tuning.rules),
    tick,
    tuning: { ...tuning },
    combat: createCombat(tuning.experiment, tuning.map),
    keepers: [],
    hit: null,
    bombs: [],
    blasts: [],
    knockouts: [],
  };
}
/** A bomb outlives neither its owner's seat nor its owner's cooldown. */
const ownedBomb = (arena: Arena, b: Bomb) =>
  arena.keepers.some(
    (k) => k.id === b.owner && k.bomb.cooldown > COOLDOWN_TICKS - FUSE_TICKS,
  );
export function syncKeepers(arena: Arena, members: readonly Member[]): void {
  arena.keepers = [...members]
    .sort((a, b) => a.slot - b.slot)
    .map((member) => {
      const old = arena.keepers.find(
        (k) => k.id === member.id && k.slot === member.slot,
      );
      if (old) {
        if (
          arena.tuning.rules !== "free" &&
          arena.contest.phase === "active" &&
          old.generation !== member.generation
        ) {
          const entry = arena.contest.entries.find((e) => e.id === member.id);
          if (entry) entry.out = true;
        }
        if (!member.connected || old.generation !== member.generation) {
          cancel(old.world);
          old.ward = 0;
        }
        return { ...old, ...member };
      }
      const world = createWorld(arena.tuning, member.slot);
      world.tick = arena.tick;
      world.combat = arena.combat;
      return {
        ...member,
        world,
        shield: FALL_SHIELD,
        ward: 0,
        hits: 0,
        bomb: freshKit(),
      };
    });
  if (!arena.bombs.every((b) => ownedBomb(arena, b)))
    arena.bombs = arena.bombs.filter((b) => ownedBomb(arena, b));
}
/** Stable slot order owns contested props; player impulses use pre-step hurt shapes and commit together. */
export function stepArena(arena: Arena, running = true): void {
  arena.tick++;
  pruneBombEvents(arena);
  const competitive = arena.tuning.rules !== "free",
    c = arena.contest;
  if (competitive && running) {
    const connected = arena.keepers.filter((k) => k.connected);
    if (c.phase === "waiting" && connected.length >= 2) c.phase = "countdown";
    if (c.phase === "countdown") {
      if (connected.length < 2) {
        c.phase = "waiting";
        c.elapsed = 0;
      } else if (++c.elapsed === COUNTDOWN_TICKS) {
        c.phase = "active";
        c.elapsed = 0;
        c.entries = connected.map((k) => ({
          id: k.id,
          slot: k.slot,
          score: 0,
          out: false,
        }));
        arena.combat = createCombat(arena.tuning.experiment, arena.tuning.map);
        arena.hit = null;
        arena.powerCooldowns = [0, 0];
        arena.pickupEvents = [];
        arena.bombs = [];
        arena.blasts = [];
        arena.knockouts = [];
        for (const k of arena.keepers) {
          k.world = createWorld(arena.tuning, k.slot);
          k.world.tick = arena.tick - 1;
          k.hits = 0;
          k.shield = FALL_SHIELD;
          k.ward = 0;
          k.bomb = freshKit();
        }
      }
    }
    if (c.phase === "active") {
      for (const entry of c.entries)
        if (!arena.keepers.some((k) => k.id === entry.id && k.connected))
          entry.out = true;
    }
  }
  const canPlay = (k: Keeper) =>
    k.connected &&
    (!competitive ||
      (c.phase === "active" && c.entries.some((e) => e.id === k.id && !e.out)));
  const playing = running && (!competitive || c.phase === "active");
  const victims = arena.keepers
    .filter((k) => canPlay(k) && !k.world.respawn && !k.shield && !k.ward)
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
    if (competitive) w.input.reset = false;
    w.combat = arena.combat;
    const oldDeaths = w.deaths;
    const wasReturning = w.respawn > 0,
      reset = w.input.reset && !w.previous.reset;
    if (playing && canPlay(keeper)) {
      step(w, {
        rivals: victims.filter((v) => v.id !== keeper.id),
        hit: (target, vx, vy, x, y) =>
          pending.push({ by: keeper, target, vx, vy, x, y }),
      });
      const blasted =
        keeper.bomb.fate === "bomb" || keeper.bomb.fate === "self";
      keeper.shield =
        wasReturning && !w.respawn
          ? blasted
            ? KO_SHIELD
            : FALL_SHIELD
          : reset
            ? FALL_SHIELD
            : Math.max(0, keeper.shield - 1);
      keeper.ward = reset || w.respawn ? 0 : Math.max(0, keeper.ward - 1);
    } else {
      cancel(w);
      w.tick++;
    }
    // A personal return does not reset shared props. With one keeper, retain the solo reset behavior.
    if (reset && arena.keepers.length === 1) arena.combat = w.combat;
    w.combat = arena.combat;
    if (w.deaths > oldDeaths) {
      keeper.bomb.fate = "fall";
      keeper.bomb.by = "";
    }
    if (competitive && w.deaths > oldDeaths) {
      const entry = c.entries.find((e) => e.id === keeper.id)!;
      if (arena.tuning.rules === "elimination") {
        entry.out = true;
        cancel(w);
      } else entry.score -= 2;
    }
  }
  for (const impact of pending) {
    const victim = arena.keepers.find((k) => k.id === impact.target)!;
    if (
      victim.world.respawn ||
      victim.shield ||
      victim.ward ||
      !canPlay(victim)
    )
      continue;
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
    if (competitive && arena.tuning.rules === "score") {
      c.entries.find((e) => e.id === impact.by.id)!.score++;
      victim.shield = FALL_SHIELD;
    }
    arena.hit = {
      tick: arena.tick,
      by: impact.by.id,
      target: victim.id,
      x: impact.x,
      y: impact.y,
    };
  }
  if (playing && arena.keepers.some(canPlay)) {
    const holder = arena.keepers[0]!.world;
    holder.combat = arena.combat;
    stepCombat(
      holder,
      arena.keepers.filter(canPlay).map((k) => k.world),
    );
    stepPowerUps(arena, canPlay);
    stepBombs(arena, canPlay);
  }
  for (const k of arena.keepers) k.world.combat = arena.combat;
  if (competitive && playing) {
    c.elapsed++;
    if (
      c.elapsed >= ROUND_TICKS ||
      c.entries.filter((e) => !e.out).length <= 1
    ) {
      finishContest(c, arena.tuning.rules);
      for (const k of arena.keepers) cancel(k.world);
      arena.bombs = [];
    }
  }
}
export function encodeArena(arena: Arena): unknown {
  return {
    powerCooldowns: [...arena.powerCooldowns],
    pickupEvents: arena.pickupEvents.map((e) => ({ ...e })),
    contest: structuredClone(arena.contest),
    tick: arena.tick,
    tuning: { ...arena.tuning },
    combat: structuredClone(arena.combat),
    hit: arena.hit && { ...arena.hit },
    bombs: arena.bombs.map((b) => ({ ...b })),
    blasts: arena.blasts.map((e) => ({ ...e })),
    knockouts: arena.knockouts.map((e) => ({ ...e })),
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
        ward: k.ward,
        hits: k.hits,
        bomb: { ...k.bomb },
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
const count = (v: unknown): v is number => integer(v, 0, 0xffffffff);
function decodeKit(raw: unknown, tuning: Tuning): BombKit | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).length !== 7 ||
    !integer(raw.cooldown, 0, tuning.bomb === "off" ? 0 : COOLDOWN_TICKS) ||
    !count(raw.thrown) ||
    !count(raw.knockouts) ||
    !count(raw.selfKnockouts) ||
    !count(raw.bombed) ||
    (raw.fate !== "" &&
      raw.fate !== "fall" &&
      raw.fate !== "bomb" &&
      raw.fate !== "self") ||
    (raw.fate === "bomb" ? !id(raw.by) : raw.by !== "") ||
    (tuning.bomb === "off" &&
      (raw.thrown ||
        raw.knockouts ||
        raw.selfKnockouts ||
        raw.bombed ||
        raw.fate === "bomb" ||
        raw.fate === "self"))
  )
    return;
  return {
    cooldown: raw.cooldown,
    thrown: raw.thrown,
    knockouts: raw.knockouts,
    selfKnockouts: raw.selfKnockouts,
    bombed: raw.bombed,
    fate: raw.fate,
    by: raw.by as string,
  };
}
/** Chronological presentation events inside the retention window. */
function decodeEvents<T>(
  raw: unknown,
  tick: number,
  keys: number,
  parse: (e: Record<string, unknown>) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS) return;
  const out: T[] = [];
  let last = 0;
  for (const e of raw) {
    if (
      !plain(e) ||
      Object.keys(e).length !== keys ||
      !integer(e.tick, Math.max(1, tick - EVENT_TICKS + 1), tick) ||
      e.tick < last
    )
      return;
    last = e.tick;
    const parsed = parse(e);
    if (!parsed) return;
    out.push(parsed);
  }
  return out;
}
const bombX = (v: unknown): v is number => integer(v, 0, WIDTH * S);
const bombY = (v: unknown): v is number =>
  integer(v, BOMB_CEILING * S, BOMB_FLOOR * S);
function decodeBombs(raw: unknown, tick: number): Bomb[] | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_BOMBS) return;
  const bombs: Bomb[] = [],
    speed = MAX_BOMB_SPEED * S;
  for (const b of raw) {
    if (
      !plain(b) ||
      Object.keys(b).length !== 7 ||
      !integer(b.id, 0, tick * 8 + 7) ||
      !id(b.owner) ||
      !bombX(b.x) ||
      !bombY(b.y) ||
      !integer(b.vx, -speed, speed) ||
      !integer(b.vy, -speed, speed) ||
      !integer(b.fuse, 1, FUSE_TICKS) ||
      bombs.some((old) => old.id >= (b.id as number) || old.owner === b.owner)
    )
      return;
    bombs.push({
      id: b.id,
      owner: b.owner,
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
      fuse: b.fuse,
    });
  }
  return bombs;
}
export function decodeArena(raw: unknown): Arena | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).length !== 11 ||
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
  const contest = decodeContest(raw.contest, tuning.rules);
  if (!contest) return;
  arena.contest = contest;
  arena.combat = probe.combat;
  if (
    !Array.isArray(raw.powerCooldowns) ||
    raw.powerCooldowns.length !== 2 ||
    raw.powerCooldowns.some((n) => !integer(n, 0, POWER_COOLDOWN)) ||
    !Array.isArray(raw.pickupEvents) ||
    raw.pickupEvents.length > 2
  )
    return;
  arena.powerCooldowns = [...raw.powerCooldowns] as number[];
  for (const e of raw.pickupEvents) {
    if (
      !plain(e) ||
      Object.keys(e).length !== 3 ||
      !integer(e.tick, 1, arena.tick) ||
      !id(e.by) ||
      !integer(e.pad, 0, 1) ||
      arena.pickupEvents.some(
        (old) => old.pad >= (e.pad as number) || old.tick !== e.tick,
      )
    )
      return;
    arena.pickupEvents.push({ tick: e.tick, by: e.by, pad: e.pad });
  }
  if (
    tuning.powerUps === "off" &&
    (arena.powerCooldowns.some(Boolean) || arena.pickupEvents.length)
  )
    return;
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
  const tick = arena.tick,
    bombs = decodeBombs(raw.bombs, tick),
    blasts = decodeEvents(raw.blasts, tick, 5, (e) =>
      integer(e.id, 0, tick * 8 + 7) && id(e.owner) && bombX(e.x) && bombY(e.y)
        ? { tick: e.tick as number, id: e.id, owner: e.owner, x: e.x, y: e.y }
        : undefined,
    ),
    knockouts = decodeEvents(raw.knockouts, tick, 5, (e) =>
      id(e.by) &&
      id(e.target) &&
      integer(e.x, 0, WIDTH * S) &&
      integer(e.y, -3000 * S, 1000 * S)
        ? {
            tick: e.tick as number,
            by: e.by,
            target: e.target,
            x: e.x,
            y: e.y,
          }
        : undefined,
    );
  if (
    !bombs ||
    !blasts ||
    !knockouts ||
    (tuning.bomb === "off" &&
      (bombs.length || blasts.length || knockouts.length))
  )
    return;
  arena.bombs = bombs;
  arena.blasts = blasts;
  arena.knockouts = knockouts;
  for (const k of raw.keepers) {
    if (
      !plain(k) ||
      Object.keys(k).length !== 9 ||
      !id(k.id) ||
      !integer(k.slot, 0, 4) ||
      !integer(k.generation, 0, 0xffffffff) ||
      typeof k.connected !== "boolean" ||
      !integer(k.shield, 0, KO_SHIELD) ||
      !integer(k.ward, 0, tuning.powerUps === "on" ? WARD_TICKS : 0) ||
      (!k.connected && !!k.ward) ||
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
    const kit = decodeKit(k.bomb, tuning);
    const world = decodeWorld({
      ...k.body,
      tick: raw.tick,
      tuning,
      combat: raw.combat,
    });
    if (
      !kit ||
      !world ||
      world.slot !== k.slot ||
      (world.respawn && k.ward) ||
      // Charging needs an armed keeper; tallies and fate follow the deaths.
      (world.charge && kit.cooldown) ||
      kit.bombed + kit.selfKnockouts > world.deaths ||
      !world.deaths !== (kit.fate === "")
    )
      return;
    world.combat = arena.combat;
    arena.keepers.push({
      id: k.id,
      slot: k.slot,
      generation: k.generation,
      connected: k.connected,
      shield: k.shield,
      ward: k.ward,
      hits: k.hits,
      bomb: kit,
      world,
    });
  }
  if (!arena.bombs.every((b) => ownedBomb(arena, b))) return;
  if (arena.contest.elapsed > arena.tick) return;
  if (
    arena.contest.phase === "active" &&
    tuning.rules !== "free" &&
    arena.contest.entries.some(
      (e) =>
        !e.out &&
        !arena.keepers.some(
          (k) => k.id === e.id && k.slot === e.slot && k.connected,
        ),
    )
  )
    return;
  return arena;
}
