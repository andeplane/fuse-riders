/**
 * What the page asks of a battlefield, so it can pick the three.js one when WebGL2 is there and the 2D pixel one
 * otherwise. Every call is presentation: none writes back into the simulation.
 */
import type { WorldView } from "../engine/view.js";
import type { StampedEvent } from "./cues.js";

/**
 * What the page asks a battlefield to draw over the world, in sub-pixels: while aiming, a ring of `range` around this
 * device's hero and one of `area` around `cursor` (0 hides a ring); and `marks`, the bodies an aimed spell may take or
 * the enemy under the cursor. The hero's own target (`HeroView.target`) the battlefield reads from the view.
 */
export interface Overlay {
  range: number;
  area: number;
  cursor: { x: number; y: number } | null;
  marks: readonly { x: number; y: number }[];
}
export const NO_OVERLAY: Overlay = {
  range: 0,
  area: 0,
  cursor: null,
  marks: [],
};

/** The colour of targeting marks: no team's, so it reads the same on either side. */
export const TARGET_HEX = 0xf4f0e0;
export const PULSE_MS = 450;

/** A short pulse when the hero takes a new chosen target: 1 at the change, falling to 0 over `PULSE_MS`. */
export class TargetPulse {
  private key = "";
  private at = -Infinity;
  of(
    target: { of: string; id: number; chosen: boolean } | null | undefined,
    now: number,
  ): number {
    const key = target?.chosen ? `${target.of}:${target.id}` : "";
    if (key !== this.key) [this.key, this.at] = [key, key ? now : -Infinity];
    return Math.max(0, 1 - (now - this.at) / PULSE_MS);
  }
}

/** The point a zoom holds still, `x`, `y` CSS pixels from the canvas's top-left, over `world`. */
export interface ZoomAnchor {
  x: number;
  y: number;
  world: WorldView;
}

export interface Renderer {
  /** Whether the camera follows this device's hero: a pan stops it, Space sets it again. */
  follow: boolean;
  /** Drawn over the next frames until replaced. */
  overlay: Overlay;
  /** Fits the picture to a `cssW` × `cssH` box at `dpr` device pixels per CSS pixel. */
  resize(cssW: number, cssH: number, dpr: number, world: WorldView): void;
  /** Pans by CSS pixels and stops following the hero. */
  pan(dx: number, dy: number, world: WorldView): void;
  /**
   * Zooms by `factor` (above 1 closer). With an `anchor` (CSS pixels from the canvas's top-left: the cursor or a
   * pinch's midpoint) the ground under it holds still on screen and following the hero stops; without one the view
   * zooms about its centre.
   */
  zoom(factor: number, anchor?: ZoomAnchor): void;
  /** Centres the camera on fractions `fx`, `fy` of the map (a minimap click) and stops following the hero. */
  lookAt(fx: number, fy: number, world: WorldView): void;
  /** The camera's box in fractions of the map, for the minimap. */
  box(world: WorldView): { x: number; y: number; w: number; h: number };
  /** The map tile under a point `dx`, `dy` CSS pixels from the canvas's top-left. */
  tileAt(
    dx: number,
    dy: number,
    world: WorldView,
  ): { x: number; y: number } | undefined;
  /** An engine event, once per match however often rollback delivers it. */
  event(matchId: string, stamped: StampedEvent, now: number): void;
  /** Draws `world`, interpolated from `older` by `t` (0 to 1), for this device's `self` seat at wall-clock `now`. */
  draw(
    matchId: string,
    world: WorldView,
    older: WorldView | undefined,
    t: number,
    self: number,
    now: number,
  ): void;
  /** Frees what the renderer holds (GPU buffers, textures) when the room closes. */
  dispose(): void;
}
