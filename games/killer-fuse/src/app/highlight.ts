import type { UnitKind } from "../engine/index.js";

/**
 * "Highlight me": this device's unit is outlined for a few seconds when it appears (play starts),
 * comes back from a death, or steps out of a gate changed. Read from the view each frame rather than from events, so a
 * rollback that undoes a death undoes its outline too.
 */
export const HIGHLIGHT_MS = 3_000;

/** What the outline looks at, for this device's unit in the current frame. */
export interface UnitSnap {
  /** The game the frame is in ("match:round"); a new one is a new spawn. */
  game: string;
  /** The game is past its countdown. */
  live: boolean;
  dead: boolean;
  kind: UnitKind;
  speed: boolean;
}

/** When the outline goes off, given the last frame's snap and this one's, at `now` ms; `until` is the current end. */
export function highlightUntil(
  previous: UnitSnap | undefined,
  next: UnitSnap | undefined,
  now: number,
  until: number,
): number {
  if (!next?.live) return next ? until : 0;
  const same = previous !== undefined && previous.game === next.game,
    spawned = !same || !previous.live,
    respawned = same && previous.dead && !next.dead,
    changed =
      same &&
      !previous.dead &&
      !next.dead &&
      (previous.kind !== next.kind || previous.speed !== next.speed);
  return spawned || respawned || changed ? now + HIGHLIGHT_MS : until;
}
