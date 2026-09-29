/**
 * AI keepers (11C). Once per log tick, before the fold steps the arena, each
 * bot's ordinary Input is computed from the arena alone: where to go (a rival,
 * a pad, a ball), how to get there (the navigation graph and its pilot), when
 * to throw (a ballistic solve checked against the real bomb flight), when to
 * hook (a rival near an edge, an orb) and how to get out of a blast (the
 * bot's own body flown through the real keeper step). Bots get no privileged
 * physics, and nothing here is kept outside the room: what a bot remembers is
 * its checkpointed mind, and its chance is noise hashed from its id and the
 * tick. Every peer computes the same inputs; no peer sends them.
 */
import { boostOf, inPlay, type Arena, type Keeper } from "./arena.js";
import {
  BODY,
  HALF,
  NEUTRAL,
  S,
  BALL_RADII,
  isBallMode,
  type Input,
  type World,
} from "./world.js";
import { MAPS, type Platform } from "./maps.js";
import { step } from "./step.js";
import { sweep } from "./collision.js";
import type { CombatContext } from "./combat.js";
import {
  blastRadius,
  bombLaunch,
  bombPath,
  bombSpawn,
  touches,
  type Bomb,
} from "./bomb.js";
import {
  BLAST_RADIUS,
  BOMB_RADIUS,
  BOMBLET_FUSE,
  CARRY,
  CHARGE_TICKS,
  FULL_SPEED,
  FUSE_TICKS,
  MAX_BOMBS,
  TAP_SPEED,
} from "./bomb-rules.js";
import { padList, tickPower } from "./power-ups.js";
import {
  chestOf,
  drive,
  landing,
  navGraph,
  nextEdge,
  physics,
  standingOn,
  walk,
  TASK_NONE,
  TASK_STRIKE,
  type NavGraph,
  type Physics,
} from "./bot-nav.js";
import {
  BOT_LEVELS,
  REPLAN_MAX,
  STUCK_TICKS,
  noise,
  type LevelRules,
  type Mind,
} from "./bot-mind.js";

/** Where a bot stands off from its rival, units: outside the blast, inside a lob. */
const STANDOFF = 200;
/** A hesitation lasts this many log ticks (one second). */
const BLUNDER_BEATS = 20;
/** Clearance kept from a bot's own planned blast, units. */
const SELF_CLEAR = 60;
/** Charges a throw plan tries (ticks; a bot's hold rises three a log tick). */
const PLAN_CHARGES = [9, 18, 27, CHARGE_TICKS];

interface Threat {
  id: number;
  owner: string;
  fuse: number;
  /** Blast radius, units. */
  radius: number;
  /** The bomb after each of its remaining flights. */
  path: readonly { x: number; y: number }[];
}
/**
 * A live bomb as a blast to get clear of. A cluster bomb splits on its first
 * contact and its bomblets go off BOMBLET_FUSE later near there, so its blast
 * is taken at that point, with a whole bomb's radius for their spread.
 */
function threatOf(b: Bomb, t: Arena["tuning"]): Threat {
  const { path, contact } = bombPath(b, b.fuse, t.gravity, t.map),
    base = { id: b.id, owner: b.owner, radius: blastRadius(b.kind) };
  if (b.kind !== "cluster" || contact < 0)
    return { ...base, fuse: b.fuse, path };
  const at = path[contact]!,
    fuse = contact + 1 + BOMBLET_FUSE;
  return {
    ...base,
    fuse,
    path: Array.from({ length: fuse }, (_, i) =>
      i <= contact ? path[i]! : at,
    ),
  };
}
/** Where a throw's blast comes from: the fuse's end, or a cluster bomb's split point. */
function blastPoint(
  flight: ReturnType<typeof bombPath>,
  cluster: boolean,
): { x: number; y: number } | undefined {
  const { path, contact } = flight;
  if (cluster && contact >= 0) return path[contact];
  return path.length === FUSE_TICKS ? path[FUSE_TICKS - 1] : undefined;
}
/** The bomb a release now would throw is a cluster bomb. */
const throwsCluster = (k: Keeper) =>
  k.power.kind === "cluster" && k.power.charges > 0;
interface Context {
  arena: Arena;
  platforms: readonly Platform[];
  graph: NavGraph;
  ph: Physics;
  level: LevelRules;
  threats: readonly Threat[];
  beat: number;
}

/**
 * The inputs every connected bot plays this log tick, by keeper id. Call once
 * per log tick, before stepping; it updates each bot's mind.
 */
export function planBots(arena: Arena): Map<string, Input> {
  const out = new Map<string, Input>(),
    bots = arena.keepers.filter((k) => k.mind);
  if (!bots.length) return out;
  const t = arena.tuning,
    ctx: Context = {
      arena,
      platforms: MAPS[t.map].platforms,
      graph: navGraph(t),
      ph: physics(t),
      level: BOT_LEVELS[t.botLevel],
      threats: arena.bombs.map((b) => threatOf(b, t)),
      beat: Math.floor(arena.tick / 3),
    };
  for (const k of bots) out.set(k.id, sanitize(think(k, ctx)));
  return out;
}

/** An Input the room would accept: integer aim in bounds, never a reset. */
function sanitize(i: Input): Input {
  const aim = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : 0)));
  return {
    move: i.move > 0 ? 1 : i.move < 0 ? -1 : 0,
    jump: !!i.jump,
    drop: !!i.drop,
    fire: !!i.fire,
    bomb: !!i.bomb,
    reset: false,
    aimX: aim(i.aimX, -2000, 3600),
    aimY: aim(i.aimY, -4000, 3000),
  };
}
/** Forget a manoeuvre; a bot out of play starts over when it returns. */
function settle(m: Mind): void {
  Object.assign(m, {
    edge: -1,
    hop: -1,
    task: TASK_NONE,
    hold: 0,
    goal: -1,
    replan: 0,
  });
}

function think(k: Keeper, ctx: Context): Input {
  const w = k.world,
    m = k.mind!,
    idle: Input = { ...NEUTRAL, aimX: w.input.aimX, aimY: w.input.aimY };
  if (!inPlay(ctx.arena, k) || w.respawn) {
    settle(m);
    return idle;
  }
  m.replan = Math.max(0, m.replan - 1);
  m.timer = Math.min(STUCK_TICKS, m.timer + 1);
  // A hesitation: nothing new, though a wound-up bomb stays held.
  if (noise(k.id, Math.floor(ctx.beat / BLUNDER_BEATS), 1) < ctx.level.blunder)
    return { ...idle, bomb: w.input.bomb && w.charge > 0 };
  let input = navigate(k, ctx);
  input = hookShot(k, ctx, input);
  input = bombing(k, ctx, input);
  return dodge(k, ctx, input);
}

/** Rivals a bot can do something about: in play and on the field. */
const rivals = (k: Keeper, arena: Arena) =>
  arena.keepers.filter((r) => r !== k && inPlay(arena, r) && !r.world.respawn);
/** The ledge a keeper is on, will land on, or hangs nearest above. */
function ledgeOf(w: World, ctx: Context): number {
  const here = standingOn(w, ctx.platforms);
  if (here >= 0) return here;
  const below = landing(w, ctx.platforms, ctx.ph);
  if (below >= 0) return below;
  let best = -1,
    d = Infinity;
  ctx.platforms.forEach(([px, py, width], i) => {
    const dx = Math.max(0, px * S - w.x, w.x - (px + width) * S),
      dy = Math.abs(py * S - w.feet),
      value = dx + dy;
    if (value < d) {
      best = i;
      d = value;
    }
  });
  return best;
}
/**
 * Power-up pads a bot may walk to, the one place bots read pads: every ready
 * pad, whatever it shows (11D), from the pads' own read.
 */
export function botPads(arena: Arena): { x: number; y: number }[] {
  return padList(arena).flatMap((pad) =>
    pad.ready ? [{ x: pad.x, y: pad.y }] : [],
  );
}
/** The ledge a pad sits on, or −1. */
function padLedge(platforms: readonly Platform[], x: number, y: number) {
  return platforms.findIndex(
    ([px, py, width]) => py >= y && py <= y + 40 && x >= px && x <= px + width,
  );
}
const inside = (p: Platform, x: number, inset = 24) =>
  Math.max(p[0] + inset, Math.min(p[0] + p[2] - inset, x));

function chooseGoal(k: Keeper, ctx: Context): void {
  const w = k.world,
    m = k.mind!,
    { platforms, graph, ph, level, arena } = ctx,
    here = ledgeOf(w, ctx);
  if (here < 0) return;
  const travel = (p: number, x: number) =>
    graph.dist[here]![p]! + Math.abs(w.x - x * S) / ph.run;
  for (const pad of botPads(arena)) {
    const p = padLedge(platforms, pad.x, pad.y);
    if (p >= 0 && travel(p, pad.x) <= level.pads) {
      Object.assign(m, { goal: p, goalX: pad.x, rival: -1 });
      return;
    }
  }
  const balls = arena.combat.balls;
  if (
    isBallMode(arena.tuning.experiment) &&
    balls.length &&
    noise(k.id, Math.floor(ctx.beat / 40), 2) < 0.5
  ) {
    const ball = balls.reduce((a, b) =>
      Math.abs(b.x - w.x) + Math.abs(b.y - w.feet) <
      Math.abs(a.x - w.x) + Math.abs(a.y - w.feet)
        ? b
        : a,
    );
    const p = ledgeOf(
      { ...w, x: ball.x, feet: ball.y, vx: 0, vy: 0, grounded: false },
      ctx,
    );
    if (p >= 0 && Number.isFinite(graph.dist[here]![p]!)) {
      Object.assign(m, {
        goal: p,
        goalX: Math.round(inside(platforms[p]!, ball.x / S)),
        rival: -1,
      });
      return;
    }
  }
  let target: Keeper | undefined,
    cost = Infinity;
  for (const r of rivals(k, arena)) {
    const p = ledgeOf(r.world, ctx);
    if (p < 0) continue;
    const c =
      travel(p, r.world.x / S) -
      (r.slot === m.rival ? 60 : 0) +
      noise(k.id, ctx.beat, 10 + r.slot) * (level.lead ? 60 : 240);
    if (Number.isFinite(c) && c < cost) {
      target = r;
      cost = c;
    }
  }
  if (target) {
    // Stand off where a lob reaches: the reachable ledge nearest that point.
    const rw = target.world,
      side = Math.sign(w.x - rw.x) || (k.slot % 2 ? 1 : -1),
      px = rw.x / S + side * STANDOFF,
      feet = rw.feet / S;
    let goal = -1,
      goalX = 0,
      best = Infinity;
    platforms.forEach((p, i) => {
      if (!Number.isFinite(graph.dist[here]![i]!)) return;
      const x = inside(p, px),
        dx = x - rw.x / S,
        dy = p[1] - feet,
        off = Math.abs(x - px) + Math.abs(dy) * 0.5,
        near =
          Math.sqrt(dx * dx + dy * dy) < BLAST_RADIUS + SELF_CLEAR ? 400 : 0;
      if (off + near < best) {
        goal = i;
        goalX = Math.round(x);
        best = off + near;
      }
    });
    if (goal >= 0) {
      Object.assign(m, { goal, goalX, rival: target.slot });
      return;
    }
  }
  wander(k, ctx);
}
function wander(k: Keeper, ctx: Context): void {
  const p = Math.floor(
      noise(k.id, ctx.beat, 3) * ctx.platforms.length,
    ) as number,
    [px, , width] = ctx.platforms[p]!;
  Object.assign(k.mind!, {
    goal: p,
    goalX: Math.round(px + width / 2),
    rival: -1,
  });
}

function navigate(k: Keeper, ctx: Context): Input {
  const w = k.world,
    m = k.mind!,
    { platforms, graph, ph } = ctx,
    here = standingOn(w, platforms);
  if (here >= 0 && m.edge >= 0 && graph.edges[m.edge]?.to === here) m.timer = 0;
  if (m.timer >= STUCK_TICKS) {
    wander(k, ctx);
    m.timer = 0;
    m.replan = Math.min(REPLAN_MAX, ctx.level.replan * 3);
  } else if (m.replan === 0 || m.goal < 0) {
    chooseGoal(k, ctx);
    m.replan = ctx.level.replan;
  }
  if (here >= 0 && m.goal >= 0) {
    if (here === m.goal) m.edge = -1;
    else if (graph.edges[m.edge]?.from !== here) {
      m.edge = nextEdge(graph, here, w.x, m.goal, ph);
      if (m.edge < 0) m.goal = -1;
    }
  }
  const input = drive(
    w,
    m,
    graph.edges,
    platforms,
    ph,
    k.power.kind === "dash",
  );
  if (here >= 0 && here === m.goal && m.task === TASK_NONE) {
    input.move = walk(w, m.goalX * S, ph);
    if (Math.abs(w.x - m.goalX * S) < 24 * S) m.timer = 0;
  }
  return input;
}

/** Line of sight for a hook from (x, y) to (tx, ty), subunits. */
const clear = (
  platforms: readonly Platform[],
  x: number,
  y: number,
  tx: number,
  ty: number,
) => !sweep(x, y, tx - x, ty - y, false, platforms);
function hookShot(k: Keeper, ctx: Context, input: Input): Input {
  const w = k.world,
    m = k.mind!,
    h = w.hook;
  if (m.task === TASK_STRIKE) {
    if (h.phase === "flying") return { ...input, fire: true };
    m.task = TASK_NONE;
    return { ...input, fire: false };
  }
  if (
    m.task !== TASK_NONE ||
    h.phase !== "ready" ||
    w.input.fire ||
    input.fire ||
    w.charge ||
    m.hold ||
    !w.grounded ||
    ctx.beat % ctx.level.attack !== k.slot % ctx.level.attack
  )
    return input;
  const aim = strikeAim(k, ctx);
  if (!aim) return input;
  m.task = TASK_STRIKE;
  return { ...input, fire: true, aimX: aim.x, aimY: aim.y };
}
/** Where to shoot the hook: an orb in reach, or a rival worth knocking off. */
function strikeAim(
  k: Keeper,
  ctx: Context,
): { x: number; y: number } | undefined {
  const w = k.world,
    { platforms, ph, level, arena } = ctx,
    sx = w.x,
    sy = chestOf(w),
    reach = Math.min(ph.range - 40 * S, 480 * S);
  const lead = (x: number, y: number, vx: number, vy: number) => {
    const d = Math.sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy)),
      t = d / (32 * S);
    return { d, x: x + vx * t, y: y + vy * t };
  };
  let best: { d: number; x: number; y: number } | undefined;
  if (noise(k.id, ctx.beat, 4) < level.strike + 0.3)
    for (const ball of arena.combat.balls) {
      const p = lead(ball.x, ball.y, ball.vx, ball.vy);
      if (
        p.d <= reach + BALL_RADII[ball.tier]! * S &&
        (!best || p.d < best.d) &&
        clear(platforms, sx, sy, p.x, p.y)
      )
        best = p;
    }
  if (!best)
    for (const r of rivals(k, arena)) {
      // Spawn protection lets a hook pass through; a Shield only stops blasts.
      if (r.spawnGuard) continue;
      const rw = r.world,
        p = lead(rw.x, rw.feet - 28 * S, rw.vx, rw.vy);
      if (p.d > reach || (best && p.d >= best.d)) continue;
      // Worth it next to the edge the hook would push them over, or for points.
      const ledge = standingOn(rw, platforms);
      if (ledge < 0) continue;
      const [px, , width] = platforms[ledge]!,
        edge = rw.x > w.x ? (px + width) * S - rw.x : rw.x - px * S,
        chance = noise(k.id, ctx.beat, 20 + r.slot);
      const worth =
        (edge < 70 * S && chance < level.strike) ||
        (arena.tuning.rules === "score" && chance < level.strike * 0.5) ||
        chance < level.strike * 0.1;
      if (worth && clear(platforms, sx, sy, p.x, p.y)) best = p;
    }
  return best && { x: Math.round(best.x / S), y: Math.round(best.y / S) };
}

/** Unit direction of a throw from (sx, sy) that passes (tx, ty), low or high arc; subunits. */
function ballistic(
  sx: number,
  sy: number,
  vx: number,
  vy: number,
  tx: number,
  ty: number,
  charge: number,
  arc: number,
  g: number,
): { x: number; y: number } | undefined {
  const t = Math.max(0, Math.min(1, (charge - 1) / (CHARGE_TICKS - 1))),
    speed = ((TAP_SPEED + (FULL_SPEED - TAP_SPEED) * t) * S) / 60,
    cx = vx * CARRY,
    cy = vy * CARRY;
  // Launch velocity to be at the target after n flights, less the carry.
  const need = (n: number) => ({
    x: (tx - sx) / n - cx,
    y: (ty - sy - (g * n * (n + 1)) / 2) / n - cy,
  });
  const excess = (n: number) => {
    const v = need(n);
    return Math.sqrt(v.x * v.x + v.y * v.y) - speed;
  };
  let before = excess(1),
    root = -1;
  for (let n = 2; n <= FUSE_TICKS && root < 0; n++) {
    const now = excess(n);
    if (arc ? before <= 0 && now > 0 : before > 0 && now <= 0)
      root = n - 1 + before / (before - now);
    before = now;
  }
  if (root < 0) return;
  const v = need(root),
    d = Math.sqrt(v.x * v.x + v.y * v.y);
  return d ? { x: v.x / d, y: v.y / d } : undefined;
}
/** Distance from a point to a keeper's body box, subunits. */
function gap(w: Pick<World, "x" | "feet">, x: number, y: number): number {
  const dx = x - Math.max(w.x - HALF, Math.min(w.x + HALF, x)),
    dy = y - Math.max(w.feet - BODY, Math.min(w.feet, y));
  return Math.sqrt(dx * dx + dy * dy);
}
interface Throw {
  aimX: number;
  aimY: number;
  x: number;
  y: number;
  miss: number;
}
/**
 * A throw at `charge` along `arc` whose blast lands on `target`: solved
 * ballistically, flown with the real launch and bomb flight (bounces and all),
 * and corrected twice for where it actually ends up. A cluster bomb's blast
 * is taken where it splits.
 */
function throwAt(
  k: Keeper,
  charge: number,
  arc: number,
  target: Keeper,
  ctx: Context,
  tries = 3,
): Throw | undefined {
  const t = ctx.arena.tuning,
    w = k.world,
    cluster = throwsCluster(k),
    sx = w.x,
    sy = chestOf(w),
    rw = target.world,
    tx = rw.x + rw.vx * 20 * ctx.level.lead,
    ledge = ledgeOf(rw, ctx),
    ty =
      (ledge >= 0 ? ctx.platforms[ledge]![1] * S : rw.feet) -
      BOMB_RADIUS * S -
      S;
  let gx = tx,
    best: Throw | undefined;
  for (let i = 0; i < tries; i++) {
    const dir = ballistic(
      sx,
      sy,
      w.vx,
      w.vy,
      gx,
      ty,
      charge,
      arc,
      ctx.ph.gravity,
    );
    if (!dir) break;
    const aimX = Math.round((sx + dir.x * 400 * S) / S),
      aimY = Math.round((sy + dir.y * 400 * S) / S),
      v = bombLaunch(charge, sx, sy, w.vx, w.vy, aimX, aimY, w.facing),
      flight = bombPath(
        { ...bombSpawn(sx, sy, t.map), vx: v.vx, vy: v.vy },
        FUSE_TICKS,
        t.gravity,
        t.map,
      );
    let end = blastPoint(flight, cluster);
    if (t.bomb === "impact") {
      const hit = flight.path.findIndex((p) =>
        touches(rw, p.x, p.y, BOMB_RADIUS * S),
      );
      // A cluster bomb that splits first never reaches the rival whole.
      if (hit >= 0 && !(cluster && flight.contact >= 0 && flight.contact < hit))
        end = flight.path[hit];
    }
    if (!end) break;
    const miss = gap({ x: tx, feet: rw.feet }, end.x, end.y);
    if (!best || miss < best.miss)
      best = { aimX, aimY, x: end.x, y: end.y, miss };
    if (miss <= 8 * S) break;
    gx += tx - end.x;
  }
  return best;
}
function targetsFor(k: Keeper, ctx: Context): Keeper[] {
  const w = k.world;
  return rivals(k, ctx.arena)
    .filter((r) => {
      const dx = Math.abs(r.world.x - w.x),
        dy = r.world.feet - w.feet;
      return (
        dx <= 560 * S &&
        dy >= -420 * S &&
        dy <= 360 * S &&
        dx + Math.abs(dy) > (BLAST_RADIUS + 40) * S
      );
    })
    .sort(
      (a, b) =>
        Math.abs(a.world.x - w.x) +
          Math.abs(a.world.feet - w.feet) -
          (Math.abs(b.world.x - w.x) + Math.abs(b.world.feet - w.feet)) ||
        a.slot - b.slot,
    );
}
function bombing(k: Keeper, ctx: Context, input: Input): Input {
  const w = k.world,
    m = k.mind!,
    kit = k.bomb,
    arena = ctx.arena;
  if (arena.tuning.bomb === "off") {
    m.hold = 0;
    return input;
  }
  const windUp = {
    bomb: true,
    move: 0,
    jump: false,
    drop: false,
    fire: false,
  } as const;
  if (m.hold > 0) {
    if (w.charge < m.hold) {
      // The hold never took (still cooling down): give it up.
      if (w.input.bomb && !w.charge && kit.cooldown) {
        m.hold = 0;
        return { ...input, bomb: false };
      }
      // Winding up: hold still until the charge reaches the plan.
      return { ...input, ...windUp };
    }
    m.hold = 0;
    const aim = release(k, ctx);
    return { ...input, bomb: false, aimX: aim.aimX, aimY: aim.aimY };
  }
  if (w.charge > 0) {
    // A charge without a plan (a hesitation, a dodge): throw it well.
    const aim = release(k, ctx);
    return { ...input, bomb: false, aimX: aim.aimX, aimY: aim.aimY };
  }
  if (
    kit.cooldown ||
    !w.grounded ||
    m.task !== TASK_NONE ||
    w.hook.phase !== "ready" ||
    input.fire ||
    arena.bombs.length >= MAX_BOMBS ||
    arena.bombs.some((b) => b.owner === k.id) ||
    ctx.beat % ctx.level.attack !== k.slot % ctx.level.attack
  )
    return input;
  const targets = targetsFor(k, ctx);
  const r = targets[ctx.beat % Math.min(2, targets.length || 1)];
  if (!r) return input;
  const radius = BLAST_RADIUS * S;
  let best: { charge: number; arc: number; miss: number } | undefined;
  for (const charge of PLAN_CHARGES)
    for (const arc of [1, 0]) {
      const plan = throwAt(k, charge, arc, r, ctx, 2);
      if (
        plan &&
        (!best || plan.miss < best.miss) &&
        gap(w, plan.x, plan.y) > radius + SELF_CLEAR * S
      )
        best = { charge, arc, miss: plan.miss };
    }
  if (!best || best.miss > radius * ctx.level.accept) return input;
  Object.assign(m, { hold: best.charge, arc: best.arc, rival: r.slot });
  return { ...input, ...windUp };
}
/** The aim a release uses now: at the planned rival with the level's error, or a lob away from itself. */
function release(k: Keeper, ctx: Context): { aimX: number; aimY: number } {
  const w = k.world,
    m = k.mind!,
    charge = Math.max(1, w.charge),
    targets = targetsFor(k, ctx),
    r = targets.find((t) => t.slot === m.rival) ?? targets[0];
  const sx = w.x,
    sy = chestOf(w);
  let aim: { aimX: number; aimY: number } | undefined;
  if (r) {
    const plan =
      throwAt(k, charge, m.arc, r, ctx) ??
      throwAt(k, charge, 1 - m.arc, r, ctx);
    if (plan && gap(w, plan.x, plan.y) > BLAST_RADIUS * S) aim = plan;
  }
  if (!aim) {
    // Nothing worth hitting: lob it toward the open side, the farther landing.
    const t = ctx.arena.tuning;
    let far = -1;
    for (const side of [-1, 1]) {
      const aimX = Math.round(sx / S + side * 200),
        aimY = Math.round(sy / S - 346),
        v = bombLaunch(charge, sx, sy, w.vx, w.vy, aimX, aimY, w.facing),
        end = blastPoint(
          bombPath(
            { ...bombSpawn(sx, sy, t.map), vx: v.vx, vy: v.vy },
            FUSE_TICKS,
            t.gravity,
            t.map,
          ),
          throwsCluster(k),
        ),
        // A bomb that falls out of the arena harms nobody.
        d = end ? gap(w, end.x, end.y) : Infinity;
      if (d > far) {
        far = d;
        aim = { aimX, aimY };
      }
    }
    return aim!;
  }
  // The level's error: a sideways nudge of the aim direction.
  const dx = aim.aimX * S - sx,
    dy = aim.aimY * S - sy,
    e = (noise(k.id, k.bomb.thrown, 7) * 2 - 1) * ctx.level.aimError;
  return {
    aimX: Math.round((sx + dx - dy * e) / S),
    aimY: Math.round((sy + dy + dx * e) / S),
  };
}

const QUIET: CombatContext = { rivals: [], hit() {} };
/**
 * The bot detached from the room for a trial. Every object `step` and the
 * power's tick write is copied: the body with its inputs and hook, the power
 * (kind, timer, cluster charges), the bomb kit; scalars such as the dash
 * timer, bonus jumps and spawn guard are copied by the spread. Its combat is
 * an empty one and it has no mind. Tuning is only read. Nothing a trial does
 * reaches shared state.
 */
function ghost(k: Keeper): Keeper {
  const w = k.world;
  return {
    ...k,
    mind: null,
    power: { ...k.power },
    bomb: { ...k.bomb },
    world: {
      ...w,
      input: { ...w.input },
      previous: { ...w.previous },
      hook: { ...w.hook },
      combat: {
        target: null,
        balls: [],
        hits: 0,
        falls: 0,
        impact: { tick: 0, x: 0, y: 0 },
      },
    },
  };
}
type Script = (beat: number, g: World) => Input;
/**
 * How close the nearest blast comes to the bot if it plays `script` (units of
 * clearance beyond the radius; negative is caught), whether it falls to its
 * death, and whether it ends on or over a ledge. The ghost moves as the fold
 * moves the bot: with its power's boost (Triple jump, Dash bump) until the
 * power runs out.
 */
function trial(
  k: Keeper,
  script: Script,
  threats: readonly Threat[],
  ctx: Context,
): { clearance: number; dead: boolean; safe: boolean } {
  const gk = ghost(k),
    g = gk.world,
    jumpMode = ctx.arena.tuning.jumpMode,
    horizon = Math.max(...threats.map((t) => t.fuse)),
    impact = ctx.arena.tuning.bomb === "impact";
  let clearance = Infinity;
  for (let s = 1; s <= horizon; s++) {
    if ((s - 1) % 3 === 0) g.input = script((s - 1) / 3, g);
    step(g, QUIET, boostOf(gk, jumpMode));
    if (g.respawn) return { clearance: -Infinity, dead: true, safe: false };
    tickPower(gk);
    for (const t of threats) {
      if (s > t.fuse) continue;
      const p = t.path[s - 1]!;
      if (s === t.fuse)
        clearance = Math.min(clearance, gap(g, p.x, p.y) - t.radius * S);
      else if (
        impact &&
        t.owner !== k.id &&
        touches(g, p.x, p.y, BOMB_RADIUS * S)
      )
        clearance = Math.min(clearance, -BLAST_RADIUS * S);
    }
  }
  const standing =
    standingOn(g, ctx.platforms) >= 0 || landing(g, ctx.platforms, ctx.ph) >= 0;
  return { clearance, dead: false, safe: standing };
}
function dodge(k: Keeper, ctx: Context, input: Input): Input {
  const w = k.world,
    { level, ph } = ctx,
    reach = (level.margin + BLAST_RADIUS + 64) * S;
  const threats = ctx.threats.filter((t) => {
    if (
      t.fuse > level.react ||
      t.path.length < t.fuse ||
      k.spawnGuard >= t.fuse
    )
      return false;
    // Its own bomb it always knows about; a rival's it may miss altogether.
    if (t.owner !== k.id && noise(k.id, t.id, 5) >= level.notice) return false;
    const p = t.path[t.fuse - 1]!;
    return gap(w, p.x, p.y) <= reach + ph.run * t.fuse;
  });
  if (!threats.length) return input;
  const margin = level.margin * S,
    first = threats.reduce((a, b) => (b.fuse < a.fuse ? b : a)),
    blast = first.path[first.fuse - 1]!,
    away = (Math.sign(w.x - blast.x) || w.facing) as -1 | 1;
  const held = { ...input };
  // A jump that rises, lets go at the top and uses an air jump (a power's too).
  const jumping = (beat: number, g: World) =>
    beat === 0
      ? !w.input.jump
      : g.vy < 0
        ? g.input.jump
        : (g.airJump || g.bonusJumps > 0) && !g.input.jump;
  // Holding Dash bump, a jumping escape's air jump dashes up and away.
  const dashAim = (move: -1 | 0 | 1) =>
    k.power.kind === "dash"
      ? {
          aimX: Math.round(w.x / S) + (move || away) * 120,
          aimY: Math.round(chestOf(w) / S) - 200,
        }
      : { aimX: input.aimX, aimY: input.aimY };
  const make =
    (move: -1 | 0 | 1, jump: boolean, drop = false): Script =>
    (beat, g) => ({
      ...NEUTRAL,
      ...(jump ? dashAim(move) : { aimX: input.aimX, aimY: input.aimY }),
      bomb: input.bomb,
      move,
      jump: jump && jumping(beat, g),
      drop: drop && beat === 0 && !w.input.drop,
    });
  const options: { script: Script; first: Partial<Input> }[] = [
    { script: () => held, first: {} },
    {
      script: make(away, false),
      first: { move: away, jump: false, drop: false, fire: false },
    },
    {
      script: make(away, true),
      first: {
        ...dashAim(away),
        move: away,
        jump: !w.input.jump,
        drop: false,
        fire: false,
      },
    },
    {
      script: make(-away as -1 | 1, true),
      first: {
        ...dashAim(-away as -1 | 1),
        move: -away as -1 | 1,
        jump: !w.input.jump,
        drop: false,
        fire: false,
      },
    },
    {
      script: make(0, true),
      first: {
        ...dashAim(0),
        move: 0,
        jump: !w.input.jump,
        drop: false,
        fire: false,
      },
    },
    ...(w.grounded
      ? [
          {
            script: make(away, false, true),
            first: {
              move: away,
              jump: false,
              drop: !w.input.drop,
              fire: false,
            },
          },
        ]
      : []),
    {
      script: make(-away as -1 | 1, false),
      first: { move: -away as -1 | 1, jump: false, drop: false, fire: false },
    },
  ];
  let best = options[0]!,
    score = -Infinity;
  for (const option of options) {
    const r = trial(k, option.script, threats, ctx);
    if (!r.dead && r.safe && r.clearance >= margin)
      return { ...input, ...option.first };
    const value = r.dead ? -Infinity : r.clearance + (r.safe ? 0 : -40 * S);
    if (value > score) {
      best = option;
      score = value;
    }
  }
  return { ...input, ...best.first };
}
