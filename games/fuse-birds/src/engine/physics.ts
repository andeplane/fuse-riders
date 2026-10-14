import {
  BODY_X,
  BODY_Y,
  GRAVITY,
  HEIGHT,
  UNIT,
  WIDTH,
  type Crate,
  type Player,
  type Projectile,
  type Terrain,
} from "./types.js";
import { solid } from "./terrain.js";

interface Fraction {
  n: number;
  d: number;
}
const before = (a: Fraction, b: Fraction) => a.n * b.d < b.n * a.d;
const ZERO = { n: 0, d: 1 },
  ONE = { n: 1, d: 1 };
export interface Contact {
  time: Fraction;
  x: number;
  y: number;
  kind: "terrain" | "crate" | "bird";
  id: string | number;
}
/** Same direct/blast collection predicate for live shots and supply placement witnesses. */
export function collectsCrate(
  terrain: Terrain,
  hit: Contact,
  crate: Crate,
  radius: number,
): boolean {
  const dx = crate.x - hit.x,
    dy = crate.y - hit.y;
  return (
    (hit.kind === "crate" && hit.id === crate.id) ||
    (dx * dx + dy * dy <= (radius * UNIT) ** 2 &&
      exposed(terrain, hit.x, hit.y, crate.x, crate.y))
  );
}
/** Slab fractions compare by exact integer products under the fixed world/velocity bounds. */
function slab(
  x: number,
  y: number,
  dx: number,
  dy: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Fraction | undefined {
  let enter = ZERO,
    leave = ONE;
  for (const [origin, delta, low, high] of [
    [x, dx, left, right],
    [y, dy, top, bottom],
  ]) {
    if (delta === 0) {
      if (origin! < low! || origin! > high!) return;
      continue;
    }
    const a = {
      n: delta! > 0 ? low! - origin! : origin! - high!,
      d: Math.abs(delta!),
    };
    const b = {
      n: delta! > 0 ? high! - origin! : origin! - low!,
      d: Math.abs(delta!),
    };
    if (before(enter, a)) enter = a;
    if (before(b, leave)) leave = b;
    if (before(leave, enter)) return;
  }
  // A projectile merely touching a face may leave it; a zero-duration exit is not an impact.
  if (leave.n === 0 && (dx !== 0 || dy !== 0)) return;
  return enter;
}
export function sweep(
  t: Terrain,
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius = UNIT,
  players: readonly Player[] = [],
  crates: readonly Crate[] = [],
  ignore?: string,
  radiusY = radius,
): Contact | undefined {
  let hit: Contact | undefined;
  const check = (
    left: number,
    top: number,
    right: number,
    bottom: number,
    kind: Contact["kind"],
    id: string | number,
  ) => {
    const time = slab(
      x,
      y,
      dx,
      dy,
      left - radius,
      top - radiusY,
      right + radius,
      bottom + radiusY,
    );
    if (time && (!hit || before(time, hit.time)))
      hit = {
        time,
        x: x + Math.trunc((dx * time.n) / time.d),
        y: y + Math.trunc((dy * time.n) / time.d),
        kind,
        id,
      };
  };
  for (
    let cy = Math.max(0, Math.floor((Math.min(y, y + dy) - radiusY) / UNIT));
    cy <=
    Math.min(HEIGHT - 1, Math.floor((Math.max(y, y + dy) + radiusY) / UNIT));
    cy++
  ) {
    for (
      let cx = Math.max(0, Math.floor((Math.min(x, x + dx) - radius) / UNIT));
      cx <=
      Math.min(WIDTH - 1, Math.floor((Math.max(x, x + dx) + radius) / UNIT));
      cx++
    )
      if (solid(t, cx, cy))
        check(
          cx * UNIT,
          cy * UNIT,
          (cx + 1) * UNIT,
          (cy + 1) * UNIT,
          "terrain",
          cy * WIDTH + cx,
        );
  }
  for (const c of [...crates].sort((a, b) => a.id - b.id))
    check(
      c.x - 5 * UNIT,
      c.y - 5 * UNIT,
      c.x + 5 * UNIT,
      c.y + 5 * UNIT,
      "crate",
      c.id,
    );
  for (const p of [...players].sort((a, b) => a.slot - b.slot))
    if (p.hp > 0 && p.id !== ignore)
      check(
        p.x - BODY_X,
        p.y - BODY_Y,
        p.x + BODY_X,
        p.y + BODY_Y,
        "bird",
        p.id,
      );
  return hit;
}
export function exposed(
  t: Terrain,
  x: number,
  y: number,
  tx: number,
  ty: number,
): boolean {
  return !sweep(t, x, y, tx - x, ty - y, 0);
}
export function launchPosition(
  player: Player,
  vx: number,
  vy: number,
): { x: number; y: number } {
  // Place the projectile outside the bird along its dominant launch axis.
  // Vertical shots must not be offset sideways; downward shots still collide with solid footing.
  return Math.abs(vx) >= Math.abs(vy)
    ? { x: player.x + (vx < 0 ? -9 : 9) * UNIT, y: player.y - 3 * UNIT }
    : { x: player.x, y: player.y + (vy < 0 ? -9 : 9) * UNIT };
}
/** Clip the short muzzle path too: a thin roof/wall cannot be skipped at spawn. */
export function projectileOrigin(
  player: Player,
  vector: { vx: number; vy: number },
  terrain: Terrain,
  players: readonly Player[],
  crates: readonly Crate[] = [],
): { x: number; y: number } {
  const origin = launchPosition(player, vector.vx, vector.vy);
  const dx = origin.x - player.x,
    dy = origin.y - player.y;
  const hit = sweep(
    terrain,
    player.x,
    player.y,
    dx,
    dy,
    UNIT,
    players,
    crates,
    player.id,
  );
  // Put a blocked muzzle just inside its contacted surface, so the first physics step
  // resolves the collision even if gravity changes a grazing trajectory away from it.
  return hit
    ? { x: hit.x + Math.sign(dx) * 2, y: hit.y + Math.sign(dy) * 2 }
    : origin;
}
export function advanceProjectile(
  p: Projectile,
  wind: number,
  terrain: Terrain,
  players: readonly Player[],
  crates: readonly Crate[],
): Contact | undefined {
  p.vx += wind;
  p.vy += GRAVITY;
  const owner = players.find((b) => b.id === p.owner);
  if (
    !owner ||
    Math.abs(p.x - owner.x) > BODY_X + UNIT ||
    Math.abs(p.y - owner.y) > BODY_Y + UNIT
  )
    p.cleared = true;
  const hit = sweep(
    terrain,
    p.x,
    p.y,
    p.vx,
    p.vy,
    UNIT,
    players,
    crates,
    p.cleared ? undefined : p.owner,
  );
  if (hit) {
    p.x = hit.x;
    p.y = hit.y;
  } else {
    p.x += p.vx;
    p.y += p.vy;
  }
  return hit;
}
export function outside(p: { x: number; y: number }): boolean {
  return p.x < 0 || p.x > WIDTH * UNIT || p.y < 0 || p.y > HEIGHT * UNIT;
}
export function blastProfile(kind: Projectile["kind"]): {
  radius: number;
  damage: number;
} {
  return kind === "pebble"
    ? { radius: 26, damage: 34 }
    : kind === "scatter"
      ? { radius: 23, damage: 28 }
      : { radius: 22, damage: 22 };
}
export function damageAt(
  t: Terrain,
  hit: Contact,
  p: Player,
  kind: Projectile["kind"],
): number {
  const { radius, damage } = blastProfile(kind),
    dx = p.x - hit.x,
    dy = p.y - hit.y,
    r = radius * UNIT;
  const direct = hit.kind === "bird" && hit.id === p.id ? damage : 0;
  const distance = dx * dx + dy * dy;
  // Sample at the free projectile center; terrain is not removed until all exposure tests finish.
  const splash =
    distance <= r * r && exposed(t, hit.x, hit.y, p.x, p.y)
      ? Math.max(4, Math.trunc((damage * (r * r - distance)) / (r * r)))
      : 0;
  return Math.max(direct, splash);
}
