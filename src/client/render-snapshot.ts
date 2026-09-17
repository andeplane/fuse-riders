import { advanceShell, SHELL_RADIUS } from '../shared/shell.js';
import { edgesOpen, obstacleEdges } from '../shared/arena-map.js';
import { wrapCoordinate, wrapDelta } from '../shared/wrap.js';
import type { ViewSnapshot } from './snapshot-stream.js';

export const VISUAL_PROJECTION_LIMIT_MS = 50;

export interface SnapshotFrame {
  snapshot: ViewSnapshot;
  matchId: string;
  round: number;
  receivedAt: number;
}

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Projects only alive rider transforms from the latest authoritative pair.
 * Tick spacing determines velocity, so packet bursts cannot amplify movement.
 */
export function renderedSnapshot(frames: readonly SnapshotFrame[], now: number): ViewSnapshot | undefined {
  if (!frames.length) return undefined;
  const newer = frames[frames.length - 1]!;
  const older = frames.length > 1 ? frames[frames.length - 2]! : newer;
  const tickDelta = newer.snapshot.tick - older.snapshot.tick;
  if (older === newer || older.matchId !== newer.matchId || older.round !== newer.round || tickDelta <= 0 ||
      older.snapshot.phase !== 'playing' || newer.snapshot.phase !== 'playing') return newer.snapshot;

  const authoritativeDuration = Math.max(VISUAL_PROJECTION_LIMIT_MS, tickDelta * VISUAL_PROJECTION_LIMIT_MS);
  const projectionDuration = Math.max(0, Math.min(VISUAL_PROJECTION_LIMIT_MS, now - newer.receivedAt));
  if (projectionDuration === 0) return newer.snapshot;
  const factor = projectionDuration / authoritativeDuration;
  const oldById = new Map(older.snapshot.players.map((player) => [player.id, player]));
  // Built once per projected frame rather than once per shell: the edges are the same board for every bomb.
  const obstacleWalls = newer.snapshot.obstacles.flatMap(obstacleEdges);
  // Over open edges a rider that crossed is a step further on, not a board's width back: velocity is the short way round.
  const open = edgesOpen(newer.snapshot);
  const { width, height } = newer.snapshot;
  return {
    ...newer.snapshot,
    // Cosmetic world effects use the same bounded fractional time as rider presentation.
    presentationTick: newer.snapshot.tick + projectionDuration / VISUAL_PROJECTION_LIMIT_MS,
    bombs: newer.snapshot.bombs.map(bomb => {
      if (!bomb.shell) return bomb;
      const dt = projectionDuration / 1000;
      if (bomb.shell.gun) return bomb;
      const motion = { x: bomb.x, y: bomb.y, vx: bomb.shell.vx * dt * 20, vy: bomb.shell.vy * dt * 20 };
      advanceShell(motion, open ? { left: -width, right: 2 * width, top: -height, bottom: 2 * height } : { left: newer.snapshot.boundaryInset + SHELL_RADIUS,
        right: newer.snapshot.width - newer.snapshot.boundaryInset - SHELL_RADIUS,
        top: newer.snapshot.boundaryInset + SHELL_RADIUS,
        bottom: newer.snapshot.height - newer.snapshot.boundaryInset - SHELL_RADIUS },
        // Scenery bounces a shell in the simulation, so the projection has to bounce it too or the sprite
        // slides through a building until the next authoritative tick snaps it back.
        [...obstacleWalls,
          ...newer.snapshot.players.flatMap(player => player.id === bomb.ownerId && newer.snapshot.tick - bomb.launchedTick < 6 ? [] : [...player.trail])]);
      return { ...bomb, x: open ? wrapCoordinate(motion.x, width) : motion.x, y: open ? wrapCoordinate(motion.y, height) : motion.y };
    }),
    players: newer.snapshot.players.map((player) => {
      const previous = oldById.get(player.id);
      if (!previous?.alive || !player.alive || player.portalCooldownUntilTick > previous.portalCooldownUntilTick) return player;
      const delta = angleDelta(previous.angle, player.angle);
      return {
        ...player,
        presentationTick: newer.snapshot.tick + projectionDuration / VISUAL_PROJECTION_LIMIT_MS,
        x: player.x + (open ? wrapDelta(player.x - previous.x, width) : player.x - previous.x) * factor,
        y: player.y + (open ? wrapDelta(player.y - previous.y, height) : player.y - previous.y) * factor,
        angle: player.angle + delta * factor,
        ...(player.bombTarget && previous.bombTarget ? { bombTarget: {
          x: Math.max(newer.snapshot.boundaryInset + 20, Math.min(newer.snapshot.width - newer.snapshot.boundaryInset - 20, player.bombTarget.x + (player.bombTarget.x - previous.bombTarget.x) * factor)),
          y: Math.max(newer.snapshot.boundaryInset + 20, Math.min(newer.snapshot.height - newer.snapshot.boundaryInset - 20, player.bombTarget.y + (player.bombTarget.y - previous.bombTarget.y) * factor)),
        } } : {}),
      };
    }),
  };
}
