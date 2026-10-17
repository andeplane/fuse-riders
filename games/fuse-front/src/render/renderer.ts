/**
 * What the page asks of a battlefield, so it can pick the three.js one when WebGL2 is there and the 2D pixel one
 * otherwise. Every call is presentation: none writes back into the simulation.
 */
import type { WorldView } from "../engine/view.js";
import type { StampedEvent } from "./cues.js";

export interface Renderer {
  /** Whether the camera follows this device's hero: a pan stops it, Space sets it again. */
  follow: boolean;
  /** Fits the picture to a `cssW` × `cssH` box at `dpr` device pixels per CSS pixel. */
  resize(cssW: number, cssH: number, dpr: number, world: WorldView): void;
  /** Pans by CSS pixels and stops following the hero. */
  pan(dx: number, dy: number, world: WorldView): void;
  /** Zooms by `factor` (above 1 closer); a renderer with a fixed scale ignores it. */
  zoom(factor: number): void;
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
