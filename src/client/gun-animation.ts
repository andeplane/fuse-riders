import type { ViewSnapshot } from "./snapshot-stream.js";

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
    flash: visible ? Math.max(0, 1 - age) : 0,
    recoil: visible ? 5 * Math.sin(Math.min(1, age / 2) * Math.PI) : 0,
    dx: bomb.shell?.vx ?? 0,
    dy: bomb.shell?.vy ?? 0,
  };
}
