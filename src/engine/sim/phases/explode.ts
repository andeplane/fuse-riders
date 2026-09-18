import type { NewBlast, TickContext } from "../context.js";
import {
  BLAST_VISIBLE_TICKS,
  PICKUP_DESTRUCTION_RADIUS_RATIO,
  RIDER_RADIUS,
} from "../../tuning.js";
import { type BlastCircle, type BlastState, sortedBombs } from "../../state.js";
import { NO_WRAP, wrapImages } from "../../wrap.js";
import { edgesOpen, obstacleTouchesCircle } from "../../arena-map.js";
import { segmentIntersectsDisk } from "../../blast-geometry.js";
import { square } from "../../geometry.js";

/**
 * Bombs whose fuse has run out go off before anyone moves, and take every landed bomb their blast reaches with them
 * (unless the room turned chaining off). What they clear is gone before a rider can ride into it.
 */
export function explodeFuses(ctx: TickContext): void {
  ctx.fuseBlasts = resolveExplosions(ctx);
}

/**
 * The same rule a second time, after this tick's launches: a released Target Bomb lands and explodes on the tick it
 * is thrown, and chains like any other blast.
 */
export function explodeInstant(ctx: TickContext): void {
  ctx.instantBlasts = resolveExplosions(ctx);
}

/** Explodes what is due, in bomb-id order, and follows the chain breadth-first in id order. */
function resolveExplosions({ state, events, facts }: TickContext): NewBlast[] {
  // #166: with chaining off a bomb only ever answers to its own fuse, neither to a blast already on the field nor to one opened this tick.
  const chain = state.settings.chainReaction;
  const queue = sortedBombs(state)
    .filter(
      (bomb) =>
        !bomb.shell &&
        bomb.landsAtTick <= state.tick &&
        (bomb.explodeAtTick <= state.tick ||
          (chain &&
            state.blasts.some((blast) =>
              segmentIntersectsDisk(
                bomb.x,
                bomb.y,
                bomb.x,
                bomb.y,
                blast.circle,
              ),
            ))),
    )
    .sort((a, b) => a.id - b.id)
    .map((bomb) => bomb.id);
  const queued = new Set(queue);
  const exploded = new Set<number>();
  const result: NewBlast[] = [];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor]!;
    if (exploded.has(id)) continue;
    const bomb = state.bombs.get(id);
    if (!bomb) continue;
    exploded.add(id);
    // A blast that reaches past an open edge carries on from the opposite one; "reaches" is measured at a rider's
    // radius, the widest thing a blast is tested against, so a rider or trail overhanging the edge is covered too. Each part is a blast in its own right,
    // under the same bomb id, so everything downstream — kills, cuts, chains, the drawing — covers both without knowing.
    const circles: BlastCircle[] = (
      edgesOpen(state)
        ? wrapImages(
            state.width,
            state.height,
            bomb.x - bomb.blastRange - RIDER_RADIUS,
            bomb.y - bomb.blastRange - RIDER_RADIUS,
            bomb.x + bomb.blastRange + RIDER_RADIUS,
            bomb.y + bomb.blastRange + RIDER_RADIUS,
          )
        : NO_WRAP
    ).map(({ dx, dy }) => ({
      x: bomb.x + dx,
      y: bomb.y + dy,
      radius: bomb.blastRange,
    }));
    const circle = circles[0]!;
    state.pickups = state.pickups.filter((pickup) =>
      circles.every(
        (part) =>
          square(pickup.x - part.x) + square(pickup.y - part.y) >=
          square(part.radius * PICKUP_DESTRUCTION_RADIUS_RATIO),
      ),
    );
    // Scenery goes at the full radius rather than the pickups' inner disk: clearing a path is the point of the shot.
    state.obstacles = state.obstacles.filter(
      (obstacle) =>
        !circles.some((part) =>
          obstacleTouchesCircle(obstacle, part.x, part.y, part.radius),
        ),
    );
    // Stored and returned separately: `state.blasts` is checkpointed and validated field by field, so the
    // statistics-only shot stays in the returned copy this tick's kill attribution reads.
    for (const part of circles) {
      const blast: BlastState = {
        bombId: id,
        ownerId: bomb.ownerId,
        circle: part,
        expiresAtTick: state.tick + BLAST_VISIBLE_TICKS,
      };
      state.blasts.push(blast);
      result.push({
        ...blast,
        ...(bomb.shot === undefined ? {} : { shot: bomb.shot }),
      });
    }
    facts.push({ kind: "bombExploded", ownerId: bomb.ownerId });
    events.push({ type: "explosion", bombId: id });

    if (chain)
      for (const candidate of sortedBombs(state)) {
        if (exploded.has(candidate.id) || queued.has(candidate.id)) continue;
        if (candidate.shell || candidate.landsAtTick > state.tick) continue;
        if (
          circles.some((part) =>
            segmentIntersectsDisk(
              candidate.x,
              candidate.y,
              candidate.x,
              candidate.y,
              part,
            ),
          )
        ) {
          queued.add(candidate.id);
          queue.push(candidate.id);
        }
      }
  }
  for (const id of exploded) state.bombs.delete(id);
  return result;
}
