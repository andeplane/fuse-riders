import { config, DT, TICK_RATE } from "./config.js";
import { nextRandom } from "./rng.js";
import { closestOnSegment, crosses } from "./geometry.js";
import { insideAnyBridge, type Point, type Track } from "./track.js";
import { wrapAngle, type ItemKind, type Truck } from "./truck.js";
import { atan2, cos, hypot, sin } from "./deterministic-math.js";

export interface Missile {
  id: number;
  owner: number;
  x: number;
  y: number;
  heading: number;
  launchedTick: number;
  target: number | null;
  onBridge: boolean;
}
export interface Mine {
  id: number;
  owner: number;
  x: number;
  y: number;
  droppedTick: number;
  onBridge: boolean;
}
export interface OilSlick {
  id: number;
  owner: number;
  x: number;
  y: number;
  droppedTick: number;
}
export interface Drone {
  id: number;
  owner: number;
  launchedTick: number;
  zaps: number;
  lastZapTick: number[];
}

/** `id` is the launching projectile's id so hits resolve in launch order (ADR 005). */
export interface Hit {
  id: number;
  slot: number;
  by: number;
  item: ItemKind;
}

/** Weighted roll by race position: t=0 leader, t=1 last (ADR 005). Returns the item and the new RNG state. */
export function rollItem(
  position: number,
  count: number,
  rng: number,
): [ItemKind, number] {
  const t = count <= 1 ? 0 : (position - 1) / (count - 1);
  const weights = config.itemOdds.map((o) => ({
    kind: o.kind,
    w:
      t <= 0.5
        ? o.first + (o.mid - o.first) * (t / 0.5)
        : o.mid + (o.last - o.mid) * ((t - 0.5) / 0.5),
  }));
  const total = weights.reduce((s, w) => s + w.w, 0);
  const [r, next] = nextRandom(rng);
  let acc = r * total;
  for (const w of weights) {
    acc -= w.w;
    if (acc < 0) return [w.kind, next];
  }
  // config.itemOdds is a non-empty constant, so the weights list has a last entry.
  return [weights[weights.length - 1]!.kind, next];
}

function nearestTargetAhead(
  owner: Truck,
  trucks: Truck[],
  tick: number,
): number | null {
  const m = config.items.missile;
  let best: number | null = null,
    bestD = Infinity;
  for (const t of trucks) {
    if (
      t.slot === owner.slot ||
      t.respawnAtTick ||
      t.finishedTick ||
      tick < t.invulnerableUntilTick
    )
      continue;
    const dx = t.x - owner.x,
      dy = t.y - owner.y;
    const d = hypot(dx, dy);
    if (d > m.lockRange || d >= bestD) continue;
    if (Math.abs(wrapAngle(atan2(dy, dx) - owner.heading)) > m.lockCone)
      continue;
    best = t.slot;
    bestD = d;
  }
  return best;
}

export interface World {
  missiles: Missile[];
  mines: Mine[];
  oils: OilSlick[];
  drones: Drone[];
  nextId: number;
}
export interface UseResult extends World {
  truck: Truck;
  lockedSlot: number | null;
  stunned: number[];
}

/** Consume the held item at the committed position (ADR 005). Pure. */
export function useItem(
  t: Truck,
  alt: boolean,
  trucks: Truck[],
  world: World,
  tick: number,
  track: Track,
): UseResult {
  const { missiles, mines, oils, drones, nextId } = world;
  const none: UseResult = {
    truck: t,
    missiles,
    mines,
    oils,
    drones,
    nextId,
    lockedSlot: null,
    stunned: [],
  };
  if (!t.item) return none;
  const c = config.items;
  switch (t.item) {
    case "nitro":
      return {
        ...none,
        truck: {
          ...t,
          item: null,
          nitros: Math.min(config.truck.nitroMax, t.nitros + c.nitroRefill),
        },
      };
    case "shield":
      return {
        ...none,
        truck: { ...t, item: null, shieldUntilTick: tick + c.shieldTicks },
      };
    case "mine": {
      const d = alt ? c.mine.lobAhead : -c.mine.dropBehind;
      const mine: Mine = {
        id: nextId,
        owner: t.slot,
        x: t.x + cos(t.heading) * d,
        y: t.y + sin(t.heading) * d,
        droppedTick: tick,
        onBridge: false,
      };
      mine.onBridge = t.onBridge && insideAnyBridge(track, mine);
      return {
        ...none,
        truck: { ...t, item: null },
        mines: [...mines, mine],
        nextId: nextId + 1,
      };
    }
    case "oil": {
      const d = alt ? c.mine.lobAhead : -c.mine.dropBehind;
      const oil: OilSlick = {
        id: nextId,
        owner: t.slot,
        x: t.x + cos(t.heading) * d,
        y: t.y + sin(t.heading) * d,
        droppedTick: tick,
      };
      return {
        ...none,
        truck: { ...t, item: null },
        oils: [...oils, oil],
        nextId: nextId + 1,
      };
    }
    case "drone":
      return {
        ...none,
        truck: { ...t, item: null },
        drones: [
          ...drones,
          {
            id: nextId,
            owner: t.slot,
            launchedTick: tick,
            zaps: 0,
            lastZapTick: trucks.map(() => 0),
          },
        ],
        nextId: nextId + 1,
      };
    case "emp": {
      const stunned = trucks
        .filter(
          (o) =>
            o.slot !== t.slot &&
            !o.respawnAtTick &&
            !o.finishedTick &&
            tick >= o.invulnerableUntilTick &&
            hypot(o.x - t.x, o.y - t.y) <= c.emp.range,
        )
        .map((o) => o.slot);
      return { ...none, truck: { ...t, item: null }, stunned };
    }
    case "missile": {
      const heading = alt ? wrapAngle(t.heading + Math.PI) : t.heading;
      const target = alt ? null : nearestTargetAhead(t, trucks, tick);
      const m: Missile = {
        id: nextId,
        owner: t.slot,
        x: t.x,
        y: t.y,
        heading,
        launchedTick: tick,
        target,
        onBridge: t.onBridge,
      };
      return {
        ...none,
        truck: { ...t, item: null },
        missiles: [...missiles, m],
        nextId: nextId + 1,
        lockedSlot: target,
      };
    }
    default:
      return { ...none, truck: { ...t, item: null } };
  }
}

/** Advance missiles one tick: home, die on walls or age, hit the first eligible truck. Hits are in launch order. */
export function stepMissiles(
  missiles: Missile[],
  trucks: Truck[],
  track: Track,
  tick: number,
): { missiles: Missile[]; hits: Hit[] } {
  const m = config.items.missile;
  const hits: Hit[] = [];
  const alive: Missile[] = [];
  for (const p of missiles) {
    if (tick - p.launchedTick > m.lifeTicks) continue;
    let heading = p.heading;
    const target = p.target === null ? undefined : trucks[p.target];
    if (target && !target.respawnAtTick) {
      const err = wrapAngle(atan2(target.y - p.y, target.x - p.x) - heading);
      heading = wrapAngle(
        heading + Math.sign(err) * Math.min(Math.abs(err), m.turnRate * DT),
      );
    }
    const from: Point = { x: p.x, y: p.y };
    const to: Point = {
      x: p.x + cos(heading) * m.speed * DT,
      y: p.y + sin(heading) * m.speed * DT,
    };
    if (
      track.walls.some(
        (w) =>
          !(w.under && p.onBridge) &&
          !(w.deck && !p.onBridge) &&
          crosses(from, to, w),
      )
    )
      continue;
    let hit: Truck | undefined;
    if (tick - p.launchedTick >= m.armTicks) {
      hit = trucks.find((t) => {
        if (
          t.slot === p.owner ||
          t.respawnAtTick ||
          t.finishedTick ||
          tick < t.invulnerableUntilTick ||
          t.onBridge !== p.onBridge
        )
          return false;
        const c = closestOnSegment(t, { a: from, b: to });
        return hypot(t.x - c.x, t.y - c.y) < m.radius + config.truck.radius;
      });
    }
    if (hit) {
      hits.push({ id: p.id, slot: hit.slot, by: p.owner, item: "missile" });
      continue;
    }
    alive.push({
      ...p,
      x: to.x,
      y: to.y,
      heading,
      onBridge: p.onBridge && insideAnyBridge(track, to),
    });
  }
  return { missiles: alive, hits };
}

/** Expire mines and trigger armed ones. A mine hits at most one truck, lowest slot wins. Owner is not immune. */
export function stepMines(
  mines: Mine[],
  trucks: Truck[],
  tick: number,
): { mines: Mine[]; hits: Hit[] } {
  const c = config.items.mine;
  const hits: Hit[] = [];
  const alive: Mine[] = [];
  for (const mine of mines) {
    if (tick - mine.droppedTick > c.lifeTicks) continue;
    if (tick - mine.droppedTick >= c.armTicks) {
      const victim = trucks.find(
        (t) =>
          !t.respawnAtTick &&
          !t.finishedTick &&
          tick >= t.invulnerableUntilTick &&
          t.onBridge === mine.onBridge &&
          hypot(t.x - mine.x, t.y - mine.y) < c.radius + config.truck.radius,
      );
      if (victim) {
        hits.push({
          id: mine.id,
          slot: victim.slot,
          by: mine.owner,
          item: "mine",
        });
        continue;
      }
    }
    alive.push(mine);
  }
  return { mines: alive, hits };
}

/** Drones orbit their owner and zap nearby trucks: 1 damage, no spin-out, once per second per truck, 3 zaps or 8 s. */
export function stepDrones(
  drones: Drone[],
  trucks: Truck[],
  tick: number,
): { drones: Drone[]; hits: Hit[] } {
  const c = config.items.drone;
  const hits: Hit[] = [];
  const alive: Drone[] = [];
  for (const d of drones) {
    const owner = trucks[d.owner]!; // A drone carries the slot of the truck that launched it.
    if (
      tick - d.launchedTick > c.lifeTicks ||
      d.zaps >= c.maxZaps ||
      owner.respawnAtTick ||
      owner.finishedTick
    )
      continue;
    const at = dronePosition(d, owner, tick);
    let zaps = d.zaps;
    const lastZapTick = d.lastZapTick.slice();
    for (const t of trucks) {
      if (zaps >= c.maxZaps) break;
      if (
        t.slot === d.owner ||
        t.respawnAtTick ||
        t.finishedTick ||
        tick < t.invulnerableUntilTick ||
        tick - lastZapTick[t.slot]! < c.zapIntervalTicks
      )
        continue;
      if (hypot(t.x - at.x, t.y - at.y) > c.range) continue;
      hits.push({ id: d.id, slot: t.slot, by: d.owner, item: "drone" });
      lastZapTick[t.slot] = tick;
      zaps += 1;
    }
    alive.push({ ...d, zaps, lastZapTick });
  }
  return { drones: alive, hits };
}

/** Position of a drone this tick, for rendering and range: orbits the owner at fixed angular speed. */
export function dronePosition(d: Drone, owner: Truck, tick: number): Point {
  const a =
    ((tick - d.launchedTick) / TICK_RATE) *
    Math.PI *
    2 *
    config.items.drone.orbitHz;
  return {
    x: owner.x + cos(a) * config.items.drone.radius,
    y: owner.y + sin(a) * config.items.drone.radius,
  };
}

export interface DamageResult {
  truck: Truck;
  absorbed: boolean;
  killed: boolean;
}

/** One hit: shield absorbs, otherwise 1 armor and a spin-out (drone zaps do not spin); zero armor explodes (ADR 005). */
export function applyHit(
  t: Truck,
  tick: number,
  item: ItemKind = "missile",
): DamageResult {
  if (tick < t.shieldUntilTick)
    return {
      truck: { ...t, shieldUntilTick: 0 },
      absorbed: true,
      killed: false,
    };
  const armor = t.armor - 1;
  const c = config.truck;
  if (armor <= 0) {
    return {
      truck: {
        ...t,
        armor: 0,
        item: null,
        shieldUntilTick: 0,
        deaths: t.deaths + 1,
        respawnAtTick: tick + c.respawnTicks,
        speed: 0,
        spinUntilTick: 0,
        airborneUntilTick: 0,
        landAtTick: 0,
        oilUntilTick: 0,
        nitroUntilTick: 0,
        boostUntilTick: 0,
        padUntilTick: 0,
        lockedUntilTick: 0,
        driftDir: 0,
        driftTicks: 0,
      },
      absorbed: false,
      killed: true,
    };
  }
  if (item === "drone")
    return { truck: { ...t, armor }, absorbed: false, killed: false };
  return {
    truck: {
      ...t,
      armor,
      spinUntilTick: tick + c.spinOutTicks,
      speed: t.speed * c.spinOutSpeedMul,
      driftDir: 0,
      driftTicks: 0,
    },
    absorbed: false,
    killed: false,
  };
}
