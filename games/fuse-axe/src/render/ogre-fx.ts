import { QUAKE, VIEW_W } from "../engine/view-kit.js";
import type { EnemyView } from "../engine/view.js";
import { fill, type Pen } from "./pen.js";
import { MASTER } from "./pixel/palette.js";
import type { Point } from "./pixel/rig.js";

/**
 * The Ogre twins' effects, drawn from the view as the hit sparks are: the slam's shockwave, a crack splitting the floor
 * from where the hammer struck to the wave's front, where rock shards burst up out of the floor and crumble again
 * behind it as it runs on, dust and pebbles flying; and the steam an enraged twin blows off. Each is a pure function
 * of the enemy, the camera and (the steam's drift only) the 60 Hz frame, and nothing lands off screen (`pen.ts`).
 */

/** The shockwave's front along the road `animStep` steps into a slam, in world pixels; null while none runs. */
export function quakeFront(enemy: EnemyView): number | null {
  const n = Math.floor(enemy.animStep);
  if (enemy.anim !== "slam" || !(n >= 1 && n <= QUAKE.steps)) return null;
  const front = enemy.x + enemy.facing * (QUAKE.reach + QUAKE.speed * n);
  return Number.isFinite(front) ? front : null;
}

const [INK, LIT, ROCK, PUFF, DUST] = [
  MASTER.k!,
  MASTER.b!,
  MASTER["6"]!,
  MASTER.W!,
  MASTER.w!,
];
/** A whole-number hash of a world column, so the crack's jags stay put as the camera moves. */
const jag = (column: number) => (((column * 2654435761) >>> 0) % 5) - 2;
/** Pixels between the crack's bends. */
const BEND = 4;
/** Steps between the shards' bursts, and each shard's height on each step from its burst until it has crumbled. */
export const BURST = 3;
export const SHARD = [6, 12, 15, 13, 10, 7, 4, 2] as const;

/** The crack along the floor in the ogre's lane, from the hammer's strike to the front: drawn under the figures. */
export function drawCracks<Image>(
  pen: Pen<Image>,
  enemies: readonly EnemyView[],
  camX: number,
): void {
  for (const enemy of enemies) {
    const front = quakeFront(enemy);
    if (front === null) continue;
    const start = enemy.x + enemy.facing * QUAKE.reach;
    // Only the columns on screen: a camera that is not a number draws none.
    const left = Math.floor(camX);
    const from = Math.max(Math.floor(Math.min(start, front)), left);
    const to = Math.min(Math.floor(Math.max(start, front)), left + VIEW_W);
    const y = Math.floor(enemy.y);
    for (let x = from; x <= to; x++) {
      // Each column lies between two bends, the crack eased from one bend's depth to the next; it gapes wider
      // near the hammer, its far lip catching the light, and a short split forks off at the sharpest bends.
      const knot = Math.floor(x / BEND);
      const t = (x - knot * BEND) / BEND;
      const dy = Math.round(jag(knot) * (1 - t) + jag(knot + 1) * t);
      const sx = x - left;
      const wide = Math.abs(x - start) < Math.abs(front - start) / 2 ? 2 : 1;
      pen.fillStyle = ROCK;
      fill(pen, sx, y + dy - 1, 1, 1);
      pen.fillStyle = INK;
      fill(pen, sx, y + dy, 1, wide);
      if (t === 0 && Math.abs(jag(knot)) === 2) {
        const side = Math.sign(jag(knot));
        fill(pen, sx + enemy.facing, y + dy + side, 1, 1);
        fill(pen, sx + 2 * enemy.facing, y + dy + 2 * side, 1, 1);
      }
    }
  }
}

/** A pointed rock shard `h` high standing on (x, y), lit on its left, outlined in ink. */
function shard<Image>(pen: Pen<Image>, x: number, y: number, h: number) {
  const half = Math.ceil(h / 3);
  for (const inset of [0, 1])
    for (let i = -half - 1 + inset; i <= half + 1 - inset; i++) {
      const tall = Math.round(h + 1 - inset - (h * Math.abs(i)) / (half + 1));
      if (tall <= 0) continue;
      pen.fillStyle = inset ? (i < 0 ? LIT : ROCK) : INK;
      fill(pen, x + i, y - tall + 1 - inset, 1, tall);
    }
}

/** A pixel disc of radius `r` round (cx, cy) on screen, solid or (`thin`) every other pixel of it. */
function disc<Image>(
  pen: Pen<Image>,
  cx: number,
  cy: number,
  r: number,
  thin: boolean,
) {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8));
    if (!thin) fill(pen, cx - half, cy + dy, 2 * half + 1, 1);
    else
      for (let dx = -half; dx <= half; dx++)
        if ((dx + dy) % 2 === 0) fill(pen, cx + dx, cy + dy, 1, 1);
  }
}

/**
 * The shockwave's front breaking the floor: every `BURST` steps a pair of shards bursts up where the front is, peaks
 * and crumbles over `SHARD`'s steps, throwing pebbles and dust either side: drawn over the figures.
 */
export function drawShards<Image>(
  pen: Pen<Image>,
  enemies: readonly EnemyView[],
  camX: number,
): void {
  for (const enemy of enemies) {
    if (quakeFront(enemy) === null) continue;
    const n = Math.floor(enemy.animStep);
    const y = Math.floor(enemy.y);
    // The first burst is on the shockwave's first step, the step after the hammer lands.
    for (let born = n - ((n - 1) % BURST); born >= 1; born -= BURST) {
      const age = n - born;
      if (age >= SHARD.length) break;
      const x = enemy.x + enemy.facing * (QUAKE.reach + QUAKE.speed * born);
      const sx = Math.floor(x - camX);
      // Dust rolling out from the shards' feet and thinning away, and two pebbles thrown up and over.
      pen.fillStyle = age < 3 ? PUFF : DUST;
      for (const side of [-1, 1])
        disc(
          pen,
          sx + side * (3 + age),
          y - 1 - (age >> 1),
          1 + (age >> 1),
          age >= 4,
        );
      const rise = Math.floor(age * 3.6 - age * age * 0.45);
      if (rise > 0)
        for (const side of [-1, 1]) {
          const stone = sx + side * (5 + 2 * age);
          pen.fillStyle = INK;
          fill(pen, stone - 1, y - 4 - rise, 3, 3);
          pen.fillStyle = ROCK;
          fill(pen, stone, y - 3 - rise, 1, 1);
        }
      const tall = SHARD[age]!;
      shard(pen, sx, y, tall);
      shard(pen, sx + 4 * enemy.facing, y + 1, Math.floor(tall * 0.6));
    }
  }
}

/** Steps a puff of steam takes to rise and fade, and how many rise from an enraged twin's crown at once. */
export const STEAM = 36;
const PUFFS = 4;

/**
 * The steam an enraged ogre blows off: puffs rising from its crown, `crown` pixels from its feet facing right (the
 * figure's frame says where), drifting back and thinning, paced by the 60 Hz `frame`.
 */
export function drawSteam<Image>(
  pen: Pen<Image>,
  enemy: EnemyView,
  [cx, cy]: Point,
  camX: number,
  frame: number,
): void {
  const sx = Math.floor(enemy.x - camX) + enemy.facing * cx;
  const sy = Math.floor(enemy.y) - Math.floor(enemy.z) + cy;
  for (let k = 0; k < PUFFS; k++) {
    const age =
      (((Math.floor(frame) + (k * STEAM) / PUFFS) % STEAM) + STEAM) % STEAM;
    const side = k % 2 ? 1 : -1;
    const x = sx - enemy.facing * Math.floor(age / 5) + side * 3;
    const y = sy - 1 - Math.floor(age / 2.5);
    pen.fillStyle = age < STEAM / 2 ? PUFF : DUST;
    disc(pen, x, y, age < STEAM / 2 ? 2 : 1, age >= (2 * STEAM) / 3);
  }
}
