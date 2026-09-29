import {
  createWorld,
  createCombat,
  cancel,
  endDash,
  S,
  BODY,
  HALF,
  WIDTH,
  type World,
  type Tuning,
  type Combat,
} from "./world.js";
import { step, type Boost } from "./step.js";
import { stepCombat } from "./combat.js";
import {
  clearPower,
  freshPads,
  freshPower,
  stepPowerUps,
  tickPower,
  POWER_PADS,
  type Pad,
  type PickupEvent,
  type PowerState,
  type ShieldPop,
} from "./power-ups.js";
import {
  CLUSTER_CHARGES,
  DASH_KNOCK,
  DASH_LIFT,
  HARPOON_LIFT,
  HARPOON_PULL,
  PAD_TICKS,
  bonusRefill,
  isPowerKind,
  powerPool,
  powerTicks,
  type PowerKind,
} from "./power-rules.js";
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
  BOMBLET_FUSE,
  BOMBLETS,
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
  /** Spawn protection ticks: hooks, dashes and blasts pass through. */
  spawnGuard: number;
  power: PowerState;
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
  /** Mixed into every pad draw; fixed for the arena's life. */
  seed: number;
  pads: Pad[];
  pickupEvents: PickupEvent[];
  shieldPops: ShieldPop[];
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
export function createArena(tuning: Tuning, tick = 0, seed = 0): Arena {
  return {
    seed: seed >>> 0,
    pads: freshPads(tuning.map),
    pickupEvents: [],
    shieldPops: [],
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
/**
 * A bomb outlives neither its owner's seat nor its owner's cooldown. The
 * throw sets the cooldown to the fuse plus 60 ticks and both then count down
 * together (a keeper out of play keeps their cooldown, a chain only shortens
 * the fuse), so a live bomb's owner always has at least that much left. A
 * cluster splits on contact with at least one fuse tick left, so the owner has
 * at least 60 left when its bomblets start their 36-tick fuse: a bomblet's
 * owner keeps at least 24 more than its fuse. The id carries the owner's slot
 * (tick × 32 + slot × 4 + 0–3), which keeps a split's bomblet ids unique.
 */
const ownedBomb = (arena: Arena, b: Bomb) =>
  arena.keepers.some(
    (k) =>
      k.id === b.owner &&
      Math.floor(b.id / 4) % 8 === k.slot &&
      k.bomb.cooldown >=
        b.fuse +
          COOLDOWN_TICKS -
          FUSE_TICKS -
          (b.kind === "bomblet" ? BOMBLET_FUSE : 0),
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
          clearPower(old);
        }
        return { ...old, ...member };
      }
      const world = createWorld(arena.tuning, member.slot);
      world.tick = arena.tick;
      world.combat = arena.combat;
      return {
        ...member,
        world,
        spawnGuard: FALL_SHIELD,
        power: freshPower(),
        hits: 0,
        bomb: freshKit(),
      };
    });
  if (!arena.bombs.every((b) => ownedBomb(arena, b)))
    arena.bombs = arena.bombs.filter((b) => ownedBomb(arena, b));
}
const NO_BOOST: Boost = { refill: 0, dash: false };
function boostOf(keeper: Keeper, jumpMode: Tuning["jumpMode"]): Boost {
  const kind = keeper.power.kind;
  if (kind !== "triple" && kind !== "dash") return NO_BOOST;
  return { refill: bonusRefill(kind, jumpMode), dash: kind === "dash" };
}
/** Body boxes touch, with a little slack so a fast dash cannot skip a rival. */
function bodiesTouch(a: World, b: World): boolean {
  const slack = 4 * S;
  return (
    Math.abs(a.x - b.x) < 2 * HALF + slack &&
    a.feet - BODY < b.feet + slack &&
    b.feet - BODY < a.feet + slack
  );
}
interface Impact {
  by: Keeper;
  target: string;
  vx: number;
  vy: number;
  x: number;
  y: number;
  /** A Harpoon hit: pull toward `by` instead of the pushed impulse. */
  pull: boolean;
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
        // Every pad is ready with a fresh draw for the round.
        for (const pad of arena.pads) {
          pad.cooldown = 0;
          pad.cycle = (pad.cycle + 1) >>> 0;
        }
        arena.pickupEvents = [];
        arena.shieldPops = [];
        arena.bombs = [];
        arena.blasts = [];
        arena.knockouts = [];
        for (const k of arena.keepers) {
          k.world = createWorld(arena.tuning, k.slot);
          k.world.tick = arena.tick - 1;
          k.hits = 0;
          k.spawnGuard = FALL_SHIELD;
          k.power = freshPower();
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
  const open = (k: Keeper) => canPlay(k) && !k.world.respawn && !k.spawnGuard;
  const victims = arena.keepers
    .filter(open)
    .map((k) => ({ id: k.id, x: k.world.x, feet: k.world.feet }));
  const pending: Impact[] = [];
  const dashers: Keeper[] = [];
  for (const keeper of arena.keepers) {
    const w = keeper.world;
    if (competitive) w.input.reset = false;
    w.combat = arena.combat;
    const oldDeaths = w.deaths;
    const wasReturning = w.respawn > 0,
      wasDashing = w.dash > 0,
      reset = w.input.reset && !w.previous.reset;
    if (playing && canPlay(keeper)) {
      const pull = keeper.power.kind === "harpoon";
      step(
        w,
        {
          rivals: victims.filter((v) => v.id !== keeper.id),
          hit: (target, vx, vy, x, y) =>
            pending.push({ by: keeper, target, vx, vy, x, y, pull }),
        },
        boostOf(keeper, arena.tuning.jumpMode),
      );
      if (wasDashing || w.dash > 0) dashers.push(keeper);
      const blasted =
        keeper.bomb.fate === "bomb" || keeper.bomb.fate === "self";
      keeper.spawnGuard =
        wasReturning && !w.respawn
          ? blasted
            ? KO_SHIELD
            : FALL_SHIELD
          : reset
            ? FALL_SHIELD
            : Math.max(0, keeper.spawnGuard - 1);
      if (reset || w.respawn) clearPower(keeper);
      else tickPower(keeper);
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
  // Dash bump: a dash that touches rivals after everyone moved knocks each of
  // them away from the dasher once, and ends.
  for (const dasher of dashers) {
    const w = dasher.world;
    if (w.respawn || !canPlay(dasher)) continue;
    let bumped = false;
    for (const rival of arena.keepers) {
      if (rival === dasher || !open(rival) || !bodiesTouch(w, rival.world))
        continue;
      // sqrt of an exact integer sum rounds alike on every engine; hypot need not.
      const dx = rival.world.x - w.x,
        dy = rival.world.feet - w.feet,
        d = Math.sqrt(dx * dx + dy * dy),
        ux = d ? dx / d : w.facing,
        uy = d ? dy / d : 0;
      pending.push({
        by: dasher,
        target: rival.id,
        vx: Math.round(ux * DASH_KNOCK * S),
        vy: Math.min(
          -DASH_LIFT * S,
          Math.round(uy * DASH_KNOCK * S) - DASH_LIFT * S,
        ),
        x: Math.round((w.x + rival.world.x) / 2),
        y: Math.max(
          -2000 * S,
          Math.round((w.feet + rival.world.feet) / 2 - BODY / 2),
        ),
        pull: false,
      });
      bumped = true;
    }
    if (bumped) endDash(w);
  }
  for (const impact of pending) {
    const victim = arena.keepers.find((k) => k.id === impact.target)!;
    if (victim.world.respawn || victim.spawnGuard || !canPlay(victim)) continue;
    let { vx, vy } = impact;
    // Toward the hooking keeper instead of away, lifted off the ground. A
    // hooker who fell out this step is already below the arena, so the rival
    // gets the ordinary push instead of a pull into the pit.
    if (impact.pull && !impact.by.world.respawn) {
      const by = impact.by.world,
        dx = by.x - victim.world.x,
        dy = by.feet - victim.world.feet,
        d = Math.sqrt(dx * dx + dy * dy) || 1;
      vx = Math.round((dx / d) * HARPOON_PULL * S);
      vy = Math.round((dy / d) * HARPOON_PULL * S) - HARPOON_LIFT * S;
    }
    const cap = Math.round((1000 * S) / 60);
    victim.world.vx = Math.max(-cap, Math.min(cap, victim.world.vx + vx));
    victim.world.vy = Math.max(-cap, Math.min(cap, victim.world.vy + vy));
    victim.world.grounded = false;
    victim.world.coyote = 0;
    impact.by.hits = Math.min(0xffffffff, impact.by.hits + 1);
    if (competitive && arena.tuning.rules === "score") {
      c.entries.find((e) => e.id === impact.by.id)!.score++;
      victim.spawnGuard = FALL_SHIELD;
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
      // Powers end with the round; the pickup tally stays for the results.
      for (const k of arena.keepers) {
        cancel(k.world);
        clearPower(k);
      }
      arena.bombs = [];
    }
  }
}
export function encodeArena(arena: Arena): unknown {
  return {
    seed: arena.seed,
    pads: arena.pads.map((p) => ({ ...p })),
    pickupEvents: arena.pickupEvents.map((e) => ({ ...e })),
    shieldPops: arena.shieldPops.map((e) => ({ ...e })),
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
        spawnGuard: k.spawnGuard,
        power: { ...k.power },
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
/** Only a kind in the room's pool, with its own duration and charges. */
function decodePower(
  raw: unknown,
  pool: readonly PowerKind[],
): PowerState | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).length !== 4 ||
    !count(raw.taken) ||
    (!pool.length && raw.taken)
  )
    return;
  if (raw.kind === "") {
    if (raw.ticks !== 0 || raw.charges !== 0) return;
  } else if (
    !isPowerKind(raw.kind) ||
    !pool.includes(raw.kind) ||
    !integer(raw.ticks, 1, powerTicks(raw.kind)) ||
    (raw.kind === "cluster"
      ? !integer(raw.charges, 1, CLUSTER_CHARGES)
      : raw.charges !== 0)
  )
    return;
  return {
    kind: raw.kind,
    ticks: raw.ticks as number,
    charges: raw.charges as number,
    taken: raw.taken,
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
const chestY = (v: unknown): v is number => integer(v, -3000 * S, 1000 * S);
const bombKind = (v: unknown, cluster: boolean): v is Bomb["kind"] =>
  v === "plain" || (cluster && (v === "cluster" || v === "bomblet"));
/**
 * Ids from tick × 32 + slot × 4 (+ 1–3 for bomblets): unique and ascending.
 * That the slot is the owner's is checked once the keepers decode.
 */
function decodeBombs(
  raw: unknown,
  tick: number,
  cluster: boolean,
): Bomb[] | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_BOMBS) return;
  const bombs: Bomb[] = [],
    speed = MAX_BOMB_SPEED * S;
  for (const b of raw) {
    if (
      !plain(b) ||
      Object.keys(b).length !== 8 ||
      !integer(b.id, 0, tick * 32 + 31) ||
      !id(b.owner) ||
      !bombKind(b.kind, cluster) ||
      // A thrown bomb takes the slot's first id; bomblets the three after it.
      (b.id % 4 === 0) !== (b.kind !== "bomblet") ||
      !bombX(b.x) ||
      !bombY(b.y) ||
      !integer(b.vx, -speed, speed) ||
      !integer(b.vy, -speed, speed) ||
      !integer(b.fuse, 1, b.kind === "bomblet" ? BOMBLET_FUSE : FUSE_TICKS) ||
      bombs.some((old) => old.id >= (b.id as number)) ||
      bombs.filter(
        (old) =>
          old.owner === b.owner &&
          (old.kind === "bomblet") === (b.kind === "bomblet"),
      ).length >= (b.kind === "bomblet" ? BOMBLETS : 1)
    )
      return;
    bombs.push({
      id: b.id,
      owner: b.owner,
      kind: b.kind,
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
    Object.keys(raw).length !== 13 ||
    !integer(raw.tick, 0, 0xffffffff * 3) ||
    !integer(raw.seed, 0, 0xffffffff) ||
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
  const arena = createArena(tuning, raw.tick, raw.seed);
  const contest = decodeContest(raw.contest, tuning.rules);
  if (!contest) return;
  arena.contest = contest;
  arena.combat = probe.combat;
  const pool = powerPool(tuning),
    layout = POWER_PADS[tuning.map];
  if (
    !Array.isArray(raw.pads) ||
    raw.pads.length !== layout.length ||
    !Array.isArray(raw.pickupEvents) ||
    raw.pickupEvents.length > layout.length
  )
    return;
  arena.pads = [];
  for (const p of raw.pads) {
    if (
      !plain(p) ||
      Object.keys(p).length !== 2 ||
      !integer(p.cooldown, 0, pool.length ? PAD_TICKS : 0) ||
      !integer(p.cycle, 0, 0xffffffff)
    )
      return;
    arena.pads.push({ cooldown: p.cooldown, cycle: p.cycle });
  }
  for (const e of raw.pickupEvents) {
    if (
      !plain(e) ||
      Object.keys(e).length !== 4 ||
      !integer(e.tick, 1, arena.tick) ||
      !id(e.by) ||
      !integer(e.pad, 0, layout.length - 1) ||
      !isPowerKind(e.kind) ||
      !pool.includes(e.kind) ||
      arena.pickupEvents.some(
        (old) => old.pad >= (e.pad as number) || old.tick !== e.tick,
      )
    )
      return;
    arena.pickupEvents.push({
      tick: e.tick,
      by: e.by,
      pad: e.pad,
      kind: e.kind,
    });
  }
  const shieldPops = decodeEvents(raw.shieldPops, arena.tick, 4, (e) =>
    id(e.target) && bombX(e.x) && chestY(e.y)
      ? { tick: e.tick as number, target: e.target, x: e.x, y: e.y }
      : undefined,
  );
  if (!shieldPops || (!pool.includes("shield") && shieldPops.length)) return;
  arena.shieldPops = shieldPops;
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
    cluster = pool.includes("cluster"),
    bombs = decodeBombs(raw.bombs, tick, cluster),
    blasts = decodeEvents(raw.blasts, tick, 6, (e) =>
      integer(e.id, 0, tick * 32 + 31) &&
      id(e.owner) &&
      bombKind(e.kind, cluster) &&
      bombX(e.x) &&
      bombY(e.y)
        ? {
            tick: e.tick as number,
            id: e.id,
            owner: e.owner,
            kind: e.kind,
            x: e.x,
            y: e.y,
          }
        : undefined,
    ),
    knockouts = decodeEvents(raw.knockouts, tick, 5, (e) =>
      id(e.by) && id(e.target) && bombX(e.x) && chestY(e.y)
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
      // Only a bomb knockout's return protects for longer than a fall's.
      !integer(
        k.spawnGuard,
        0,
        tuning.bomb === "off" ? FALL_SHIELD : KO_SHIELD,
      ) ||
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
    const kit = decodeKit(k.bomb, tuning),
      power = decodePower(k.power, pool);
    const world = decodeWorld({
      ...k.body,
      tick: raw.tick,
      tuning,
      combat: raw.combat,
    });
    if (
      !kit ||
      !power ||
      !world ||
      world.slot !== k.slot ||
      // A power ends with the keeper's connection or life.
      (power.kind && (!k.connected || world.respawn)) ||
      // Extra air actions and dashes only come from the power that grants them.
      world.bonusJumps > bonusRefill(power.kind, tuning.jumpMode) ||
      (world.dash && power.kind !== "dash") ||
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
      spawnGuard: k.spawnGuard,
      power,
      hits: k.hits,
      bomb: kit,
      world,
    });
  }
  if (!arena.bombs.every((b) => ownedBomb(arena, b))) return;
  if (arena.contest.elapsed > arena.tick) return;
  // Bombs fly and charges grow only in play. A round's start clears bomb
  // state and its end clears bombs and cancels charges, so outside an active
  // round there are no bombs or charges, and before one no bomb events either
  // (the last blasts of a round stay briefly for presentation).
  const competitive = tuning.rules !== "free",
    phase = arena.contest.phase,
    inPlay = (k: Keeper) =>
      k.connected &&
      (!competitive ||
        (phase === "active" &&
          arena.contest.entries.some((e) => e.id === k.id && !e.out)));
  if (
    (competitive && phase !== "active" && arena.bombs.length) ||
    (competitive &&
      (phase === "waiting" || phase === "countdown") &&
      (arena.blasts.length || arena.knockouts.length)) ||
    arena.keepers.some((k) => k.world.charge && !inPlay(k))
  )
    return;
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
