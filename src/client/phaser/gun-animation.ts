import {
  GUN_RADIUS,
  PORTAL_WALL_HALF_WIDTH,
  type GunView as ViewSnapshot,
} from "../../engine/view-kit.js";

type Tracer = ViewSnapshot["bombs"][number];

/** A portal/wrap continuation has the same direction and birth tick, but a later id. */
export function gunRoots(bombs: ViewSnapshot["bombs"]): Tracer[] {
  const roots = new Map<string, Tracer>();
  for (const bomb of bombs) {
    if (!bomb.shell?.gun) continue;
    const key = `${bomb.ownerId}:${bomb.launchedTick}:${bomb.shell.vx}:${bomb.shell.vy}`;
    const previous = roots.get(key);
    if (!previous || bomb.id < previous.id) roots.set(key, bomb);
  }
  return [...roots.values()];
}

/** Samples supplied world time only; neither recoil nor flash changes rider position. */
export function gunFrame(bomb: Tracer, tick: number) {
  const age = tick - bomb.launchedTick;
  const visible = !!bomb.shell?.gun && age >= 0 && tick < bomb.explodeAtTick;
  return {
    alpha: visible
      ? (1 - age / Math.max(1, bomb.explodeAtTick - bomb.launchedTick)) ** 2
      : 0,
    glow: visible ? Math.max(0, 1 - age / 1.5) : 0,
    flash: visible ? Math.max(0, 1 - age) : 0,
    recoil: visible ? 5 * Math.sin(Math.min(1, age / 2) * Math.PI) : 0,
    dx: bomb.shell?.vx ?? 0,
    dy: bomb.shell?.vy ?? 0,
  };
}

/** Match supplied incoming and outgoing segments; a ray merely ending near a gate does not pulse it. */
export function gunPortalPulses(snapshot: ViewSnapshot, tick: number) {
  const pulses: {
    pairId: string;
    strength: number;
    entry: { x: number; y: number };
    exit: { x: number; y: number };
  }[] = [];
  const rays = snapshot.bombs.filter(
    (bomb) => bomb.shell?.gun && gunFrame(bomb, tick).alpha > 0,
  );
  const clearance = PORTAL_WALL_HALF_WIDTH + GUN_RADIUS;
  for (const pair of snapshot.portalPairs) {
    if (pair.expiresAtTick <= tick) continue;
    for (const [index, gate] of pair.gates.entries()) {
      const linked = pair.gates[1 - index]!;
      for (const ray of rays) {
        const nearY = Math.max(
          gate.y - gate.halfLength,
          Math.min(gate.y + gate.halfLength, ray.y),
        );
        if (
          Math.abs(Math.hypot(ray.x - gate.x, ray.y - nearY) - clearance) > 0.1
        )
          continue;
        const proportion = Math.max(
          -1,
          Math.min(1, (ray.y - gate.y) / gate.halfLength),
        );
        const exit = rays.find(
          (next) =>
            next.id > ray.id &&
            next.ownerId === ray.ownerId &&
            next.launchedTick === ray.launchedTick &&
            next.shell!.vx === ray.shell!.vx &&
            next.shell!.vy === ray.shell!.vy &&
            Math.abs(Math.abs(next.launchX - linked.x) - (clearance + 1)) <
              0.1 &&
            Math.abs(
              next.launchY - (linked.y + proportion * linked.halfLength),
            ) < 0.1,
        );
        if (exit)
          pulses.push({
            pairId: pair.id,
            strength: gunFrame(ray, tick).alpha,
            entry: { x: ray.x, y: ray.y },
            exit: { x: exit.launchX, y: exit.launchY },
          });
      }
    }
  }
  return pulses;
}
