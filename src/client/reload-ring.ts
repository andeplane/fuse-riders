import { BOMB_COOLDOWN_TICKS } from '../shared/game.js';
import type { ViewPlayer, ViewSnapshot } from './snapshot-stream.js';

export const RELOAD_RING_RADIUS = 25;

/** Snapshot time keeps reload feedback in sync through pauses, reconnects and rollback. */
export function reloadRemaining(player: ViewPlayer, snapshot: ViewSnapshot): number {
  if (!player.alive || snapshot.phase !== 'playing') return 0;
  const tick = player.presentationTick ?? snapshot.presentationTick ?? snapshot.tick;
  return Math.max(0, Math.min(1, (player.bombReadyAtTick - tick) / BOMB_COOLDOWN_TICKS));
}
