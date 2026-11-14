/**
 * The contract between the page (`src/app`) and the arena renderer (`src/render`).
 * The page owns the room, input and menus; the renderer only draws supplied views and plays sound.
 */
import type { RoundView } from "../engine/view.js";
import type { EventFeed, SoundCue } from "./effects.js";

export type { EventFeed, SoundCue, SoundName, TickEvents } from "./effects.js";

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
  /** Set false to leave the end-of-game iris and winner text to the page; shown when omitted. */
  readonly banner?: boolean;
  /**
   * Set false while the page plays a music file, so the synthesised bed does not play under it; also false when
   * the music is switched off. The bed runs when this is omitted.
   */
  readonly bed?: boolean;
  /**
   * Called when a loud effect sounds, so the page can duck its music for a moment. Set once; `update` ignores it.
   */
  readonly duck?: () => void;
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
   * Feeds the newest view with the events of every log tick since the last feed (`feed.ticks`, the newest tick's
   * being the view's own), so each starts its effects and sounds once. A rolled-back tick may be fed again and must
   * not double its effects; its loud ones wait for `feed.confirmed` to pass the tick.
   */
  advance(view: RoundView, feed: EventFeed): void;
  /**
   * One sound the page asks for rather than the simulation: the countdown's beeps and its GO. Rate limiting is the
   * renderer's, so asking on every frame still beeps once a second.
   */
  cue(cue: SoundCue): void;
  update(options: Partial<ArenaOptions>): void;
  resize(): void;
  destroy(): void;
}

export type CreateArenaView = (
  host: HTMLElement,
  options: ArenaOptions,
) => ArenaView;
