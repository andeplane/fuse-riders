import type { Stage } from "fuse-netcode";
import type { HeroKind } from "../engine/index.js";

/**
 * Two decisions about time that the page makes from frames, kept pure so they are tested without a browser: how a
 * solo page opens on the lobby, and how long a hero pick stands in for the room's answer.
 */

/** What the opening reads of a frame. */
export interface Opening {
  stage: Stage;
  logTick: number;
}

/**
 * Solo sets out the moment it starts: the netcode seats the hero and logs START, since a solo room has nobody to wait
 * for. This page opens on the hero picker instead, so it holds those frames back, logs one return to the lobby once the
 * clock has moved past the opening tick (an entry stamped at a tick already folded would be too late), and lets frames
 * through again as soon as the lobby lands. Nothing but the lobby ends the hold early on its own, so it never lets a
 * run the player started be taken back: the page shows no START until the lobby has landed, and after that the opening
 * is over. It also ends when the return is refused, and when the lobby has not landed `wait` log ticks after it was
 * logged, so a page can never be left looking at "Connecting" for a room that is already running.
 */
export class SoloOpening {
  private opened: number | undefined;
  private sentAt: number | undefined;
  private over = false;
  constructor(private readonly wait = 40) {}
  /**
   * Whether `frame` stays off the screen. `toLobby` logs the return to the lobby and says whether it was logged; it is
   * called at most once.
   */
  holds(frame: Opening, toLobby: () => boolean): boolean {
    if (this.over) return false;
    if (frame.stage !== "running") {
      this.over = true;
      return false;
    }
    if (this.opened === undefined) {
      this.opened = frame.logTick;
      return true;
    }
    if (this.sentAt === undefined) {
      if (frame.logTick <= this.opened) return true;
      if (!toLobby()) {
        this.over = true;
        return false;
      }
      this.sentAt = frame.logTick;
      return true;
    }
    if (frame.logTick - this.sentAt > this.wait) {
      this.over = true;
      return false;
    }
    return true;
  }
}

/**
 * The hero this device just picked, shown until the seat's own catches up. The fold applies a pick a tick or two after
 * it is logged, and a frame in between still carries the old hero, so the picker would snap back and forward again.
 * The room still decides: the pick stands down when the seat agrees, when a pick no longer applies (a run began, the
 * seat went away) and after `wait` log ticks, so a pick the room dropped shows the hero the seat really plays.
 */
export class PendingPick {
  private hero: HeroKind | undefined;
  private since = 0;
  constructor(private readonly wait = 20) {}
  pick(hero: HeroKind, logTick: number): void {
    this.hero = hero;
    this.since = logTick;
  }
  /** The hero to show: the pending pick while it stands, otherwise the room's (`null` before a seat). */
  shown(
    room: HeroKind | null,
    canPick: boolean,
    logTick: number,
  ): HeroKind | null {
    if (this.hero === undefined) return room;
    if (room === this.hero || !canPick || logTick - this.since > this.wait) {
      this.hero = undefined;
      return room;
    }
    return this.hero;
  }
}
