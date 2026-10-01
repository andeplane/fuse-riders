import { BOUNDS } from "./arena.js";
import { UNIT, clamp, cos, div, isqrt, sin } from "./math.js";
import { CRUMB, FIRST_GAP, GAP, TRAIL } from "./tuning.js";

/**
 * The path a locomotive laid, and where its wagons are on it. The trail is a crumb every `CRUMB` of path, placed on
 * the segment the locomotive drove, so the crumbs are evenly spaced along the path whatever the speed; a wagon `D`
 * behind the locomotive sits `D` back along that path, through every turn. Nothing about a wagon is stored.
 */
interface Pathed {
  x: number;
  y: number;
  trail: number[];
  odo: number;
}

/** A trail straight back from `(x, y)` against heading `dir`, kept on the floor: a new train's past. */
export function straightTrail(x: number, y: number, dir: number): number[] {
  const trail: number[] = [];
  const dx = cos(dir),
    dy = sin(dir);
  for (let index = 0; index < TRAIL; index++)
    trail.push(
      clamp(x - div(index * CRUMB * dx, UNIT), BOUNDS.left, BOUNDS.right),
      clamp(y - div(index * CRUMB * dy, UNIT), BOUNDS.top, BOUNDS.bottom),
    );
  return trail;
}

/**
 * The locomotive has driven straight from `(fromX, fromY)` to where it is: lays a crumb wherever that segment
 * completes another `CRUMB` of path, and keeps what is left over in `odo`.
 */
export function layTrail(train: Pathed, fromX: number, fromY: number): void {
  const dx = train.x - fromX,
    dy = train.y - fromY,
    length = isqrt(dx * dx + dy * dy);
  if (length === 0) return;
  let used = 0;
  while (train.odo + (length - used) >= CRUMB) {
    used += CRUMB - train.odo;
    train.trail.unshift(
      fromX + div(dx * used, length),
      fromY + div(dy * used, length),
    );
    train.trail.length = TRAIL * 2;
    train.odo = 0;
  }
  train.odo += length - used;
}

/** The point `distance` back along the path from the locomotive's centre. */
export function along(train: Pathed, distance: number): [number, number] {
  const trail = train.trail;
  if (distance <= train.odo) {
    if (train.odo === 0) return [train.x, train.y];
    return [
      train.x + div((trail[0]! - train.x) * distance, train.odo),
      train.y + div((trail[1]! - train.y) * distance, train.odo),
    ];
  }
  const rest = distance - train.odo,
    index = div(rest, CRUMB),
    part = rest - index * CRUMB;
  if (index >= TRAIL - 1)
    return [trail[(TRAIL - 1) * 2]!, trail[(TRAIL - 1) * 2 + 1]!];
  const ax = trail[index * 2]!,
    ay = trail[index * 2 + 1]!,
    bx = trail[index * 2 + 2]!,
    by = trail[index * 2 + 3]!;
  return [ax + div((bx - ax) * part, CRUMB), ay + div((by - ay) * part, CRUMB)];
}

/** Path distance from the locomotive's centre to wagon `index`'s. */
export const wagonDistance = (index: number): number => FIRST_GAP + index * GAP;

/** Every wagon's centre, front first. */
export function wagons(
  train: Pathed & { cargo: readonly number[] },
): [number, number][] {
  return train.cargo.map((_, index) => along(train, wagonDistance(index)));
}
