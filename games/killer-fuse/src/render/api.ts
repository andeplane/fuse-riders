/**
 * The contract between the page (`src/app`) and the arena renderer (`src/render`).
 * The page owns the room, input and menus; the renderer only draws supplied views and plays sound.
 */
import type { RoundView } from "../engine/index.js";

export interface ArenaOptions {
  /** Base URL of the art folder, ending in a slash. */
  readonly artUrl: string;
  /** Seat the local player controls, or -1 when watching. Used to mark their unit. */
  readonly localSlot: number;
  /** Display names by seat; an empty string leaves the seat unnamed. */
  readonly names: readonly string[];
  readonly muted: boolean;
  /** Outlines the local player's unit while true; the page turns it on for a few seconds at spawn and after a transform. */
  readonly highlight?: boolean;
}

export interface ArenaView {
  /** Resolves once art and sound are loaded and the first frame can be drawn. */
  readonly ready: Promise<void>;
  /**
   * Draws one display frame between two simulation steps.
   * `alpha` is 0 at `previous` and 1 at `current`; pass the same view twice when there is no history.
   */
  render(previous: RoundView, current: RoundView, alpha: number): void;
  /**
   * Feeds a newly confirmed or predicted step so its events start effects and sounds.
   * Call it once per step, in order; a rolled-back step may be fed again and must not double its effects.
   */
  advance(view: RoundView): void;
  update(options: Partial<ArenaOptions>): void;
  resize(): void;
  destroy(): void;
}

export type CreateArenaView = (
  host: HTMLElement,
  options: ArenaOptions,
) => ArenaView;
