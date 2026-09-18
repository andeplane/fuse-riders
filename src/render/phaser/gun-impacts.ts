import type { WorldView as ViewSnapshot } from "../../engine/view.js";
import { obstacleDistanceSquared, wrapDelta } from "../../engine/view-kit.js";

type Point = { x: number; y: number };
export interface GunImpact extends Point {
  id: number;
  born: number;
  kind: "trail" | "solid" | "lethal";
  color: string;
  dx: number;
  dy: number;
  ends: Point[];
}

/** Cosmetic evidence at an already-resolved endpoint, never a new raycast or damage decision. */
function contact(
  snapshot: ViewSnapshot,
  previous: ViewSnapshot,
  bomb: ViewSnapshot["bombs"][number],
): GunImpact | undefined {
  const open = snapshot.openEdges;
  const { gunRadius, gunHoleRadius, gunHeadshotRadius } = snapshot.rules;
  const distance = (a: Point, b: Point) =>
    Math.hypot(
      open ? wrapDelta(a.x - b.x, snapshot.width) : a.x - b.x,
      open ? wrapDelta(a.y - b.y, snapshot.height) : a.y - b.y,
    );
  const impact: GunImpact = {
    id: bomb.id,
    born: bomb.launchedTick,
    x: bomb.x,
    y: bomb.y,
    kind: "solid",
    color: "#d8edff",
    dx: bomb.shell!.vx,
    dy: bomb.shell!.vy,
    ends: [],
  };
  for (const player of snapshot.players) {
    if (player.id === bomb.ownerId) continue;
    const before = previous.players.find((p) => p.id === player.id);
    if (!before) continue;
    if (
      !player.alive &&
      before.alive &&
      distance(player, bomb) <= gunHeadshotRadius + 0.1
    )
      return { ...impact, kind: "lethal", color: player.color };
    // The hole's newly exposed endpoints are supplied by the simulation. Expiry alone is not a cut.
    const ends = player.trail
      .flatMap((trail) => [
        { x: trail.x1, y: trail.y1 },
        { x: trail.x2, y: trail.y2 },
      ])
      .filter(
        (end) =>
          Math.abs(distance(end, bomb) - gunHoleRadius) < 0.15 &&
          before.trail.some((trail) => {
            if (!trail.detached && trail.expiresAtTick <= snapshot.tick)
              return false;
            const dx = trail.x2 - trail.x1,
              dy = trail.y2 - trail.y1;
            const length = dx * dx + dy * dy;
            if (!length) return false;
            const t =
              ((end.x - trail.x1) * dx + (end.y - trail.y1) * dy) / length;
            return (
              t > 0.00001 &&
              t < 0.99999 &&
              Math.hypot(end.x - trail.x1 - dx * t, end.y - trail.y1 - dy * t) <
                0.15
            );
          }),
      )
      .slice(0, 4);
    if (ends.length)
      return { ...impact, kind: "trail", color: player.color, ends };
  }
  const inset = snapshot.boundaryInset + gunRadius;
  const wall =
    !open &&
    Math.min(
      Math.abs(bomb.x - inset),
      Math.abs(bomb.x - (snapshot.width - inset)),
      Math.abs(bomb.y - inset),
      Math.abs(bomb.y - (snapshot.height - inset)),
    ) < 0.1;
  if (
    wall ||
    snapshot.obstacles.some(
      (obstacle) =>
        obstacleDistanceSquared(obstacle, bomb.x, bomb.y) <=
        (gunRadius + 0.1) ** 2,
    )
  )
    return impact;
  return undefined; // Range ends and portal/wrap seams are not impacts.
}

/** One prior snapshot and at most 64 short-lived bursts. Baselines and rollback stay silent. */
export class GunImpacts {
  private previous?: ViewSnapshot;
  private scope = "";
  private active: GunImpact[] = [];
  reset(): void {
    this.previous = undefined;
    this.active = [];
    this.scope = "";
  }
  accept(
    snapshot: ViewSnapshot,
    matchId: string,
  ): { active: readonly GunImpact[]; fresh: readonly GunImpact[] } {
    const scope = `${matchId}:${snapshot.round}`;
    const previous = this.previous;
    const reset =
      !previous ||
      scope !== this.scope ||
      snapshot.tick < previous.tick ||
      snapshot.phase === "lobby" ||
      snapshot.phase === "countdown";
    const fresh: GunImpact[] = [];
    if (reset) this.active = [];
    else {
      const seen = new Set([
        ...previous.bombs.map((b) => b.id),
        ...this.active.map((b) => b.id),
      ]);
      for (const bomb of snapshot.bombs) {
        if (
          !bomb.shell?.gun ||
          seen.has(bomb.id) ||
          bomb.launchedTick < previous.tick ||
          bomb.explodeAtTick <= snapshot.tick
        )
          continue;
        const hit = contact(snapshot, previous, bomb);
        if (hit) fresh.push(hit);
      }
    }
    this.active = [...this.active, ...fresh]
      .filter((hit) => snapshot.tick < hit.born + 8)
      .slice(-64);
    this.previous = snapshot;
    this.scope = scope;
    return { active: this.active, fresh: fresh.slice(-64) };
  }
}

export function gunImpactFrame(hit: GunImpact, tick: number) {
  const age = Math.max(0, tick - hit.born);
  const alpha = tick < hit.born ? 0 : Math.max(0, 1 - age / 8);
  const count = hit.kind === "lethal" ? 12 : 6;
  const fragments = Array.from({ length: count }, (_, i) => {
    const spread = hit.kind === "solid" ? Math.PI * 0.85 : Math.PI * 2;
    const angle =
      Math.atan2(-hit.dy, -hit.dx) + ((i + 0.5) / count - 0.5) * spread;
    const reach =
      (hit.kind === "lethal" ? 8 : 4) + age * (2 + ((hit.id + i * 7) % 5));
    return {
      x: hit.x + Math.cos(angle) * reach,
      y: hit.y + Math.sin(angle) * reach,
      size: (hit.kind === "lethal" ? 4 : 3) * alpha,
    };
  });
  return {
    alpha,
    fragments,
    core: tick < hit.born ? 0 : Math.max(0, 1 - age / 2),
  };
}
