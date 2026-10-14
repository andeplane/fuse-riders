// What the round's framing camera frames, the edge markers for ships outside the view, the sky's place behind it and
// the minimum on-screen size of small things, in plain numbers (no Phaser) so tests run them under Node. Render only:
// positions in, screen positions out; nothing here feeds the simulation. round-scene.ts wires it to `camera.ts`.

import type { CastleView, GhostView } from "../engine/index.js";
import {
  offscreenMarkers,
  visibleRect,
  type CameraPoint,
  type CameraPose,
  type Point,
  type Size,
} from "./camera.js";

/** How hard a ghost pulls the shared screen's framing: part of the way, so one far ghost does not zoom out a fight. */
export const GHOST_WEIGHT = 0.35;

/** A ship to frame: a living gunship (weight 1) or a ghost (`GHOST_WEIGHT`), with its seat. */
export type ShipPoint = CameraPoint & {
  readonly id: number;
  readonly ghost: boolean;
};

/** The shared screen's points: every living gunship, then every ghost. Wrecks are not framed. */
export function framingPoints(view: {
  castles: readonly Pick<CastleView, "id" | "x" | "y" | "alive">[];
  ghosts: readonly Pick<GhostView, "owner" | "x" | "y">[];
}): ShipPoint[] {
  const ships: ShipPoint[] = [];
  for (const c of view.castles)
    if (c.alive) ships.push({ id: c.id, x: c.x, y: c.y, ghost: false });
  for (const g of view.ghosts)
    ships.push({
      id: g.owner,
      x: g.x,
      y: g.y,
      weight: GHOST_WEIGHT,
      ghost: true,
    });
  return ships;
}

/** Markers this far (world px) beyond the view's edge are drawn at `MARKER_MIN_SCALE`; nearer ones grow to 1. */
export const MARKER_FAR = 2400;
export const MARKER_MIN_SCALE = 0.6;

/** An edge arrow on the HUD camera for a ship outside the view. */
export interface ShipMarker {
  readonly id: number;
  readonly ghost: boolean;
  /** Screen px of the arrow, and its direction toward the ship (radians, 0 right, y down). */
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /** 1 just off the edge down to `MARKER_MIN_SCALE` far away: the distance hint. */
  readonly scale: number;
}

/**
 * Edge arrows for the ships outside `pose`'s view. `view` is the camera's viewport (screen px) and `top` its offset
 * from the HUD's top edge, so the arrows land in HUD coordinates.
 */
export function shipMarkers(
  ships: readonly ShipPoint[],
  pose: CameraPose,
  view: Size,
  top = 0,
  inset = 30,
): ShipMarker[] {
  const r = visibleRect(pose, view);
  return offscreenMarkers(pose, view, ships, inset).map((m) => {
    const p = m.point;
    const dx = Math.max(0, r.x - p.x, p.x - (r.x + r.width));
    const dy = Math.max(0, r.y - p.y, p.y - (r.y + r.height));
    const k = Math.min(1, Math.hypot(dx, dy) / MARKER_FAR);
    return {
      id: p.id,
      ghost: p.ghost,
      x: m.x,
      y: m.y + top,
      angle: m.angle,
      scale: 1 - (1 - MARKER_MIN_SCALE) * k,
    };
  });
}

/** The sky's parallax: how far (screen px) it slides across the whole world, and how much it grows zoomed in. */
export const SKY = { parallax: 40, grow: 0.12, margin: 24 } as const;

/**
 * Where the screen-filling sky sits in the world (its centre and display size) for a pose on a `screen`: centred on
 * the view, slid against the camera up to `SKY.parallax` screen px each way (× the growth) as it pans toward a world
 * edge, and grown by up to `SKY.grow` as it zooms from `zoomMin` to `zoomMax`. It always covers the screen and
 * `SKY.margin` screen px more each way (a shake's worth).
 */
export function skyRect(
  pose: CameraPose,
  screen: Size,
  world: Size,
  zoomMin: number,
  zoomMax: number,
): Point & Size {
  const { parallax, grow, margin } = SKY;
  const range = Math.log(zoomMax / zoomMin);
  const t = range > 0 ? Math.log(pose.zoom / zoomMin) / range : 0;
  const g = 1 + grow * Math.min(1, Math.max(0, t || 0));
  const side = (c: number, w: number) =>
    Math.min(1, Math.max(-1, (c - w / 2) / (w / 2) || 0));
  const width = (screen.width + 2 * (margin + parallax)) * g;
  const height = (screen.height + 2 * (margin + parallax)) * g;
  return {
    x:
      pose.centerX -
      (parallax * g * side(pose.centerX, world.width)) / pose.zoom,
    y:
      pose.centerY -
      (parallax * g * side(pose.centerY, world.height)) / pose.zoom,
    width: width / pose.zoom,
    height: height / pose.zoom,
  };
}

/** Screen-space marks over a ship (health bar, reload and ready rings, guide dots) are full size from `fullZoom` in
 * and shrink with the zoom below it down to `min`, so at the whole map they do not swamp a ship 18 px across. */
export const HUD_SCALE = { min: 0.6, fullZoom: 0.6 } as const;

/** The size of the marks over a ship at `zoom`, `HUD_SCALE.min` to 1. */
export function hudScale(zoom: number): number {
  const k = zoom / HUD_SCALE.fullZoom;
  return Number.isNaN(k) ? 1 : Math.min(1, Math.max(HUD_SCALE.min, k));
}

/** The scale (never below 1) that keeps something `size` world px across at least `minPx` screen px at `zoom`. */
export function minScreenScale(
  size: number,
  zoom: number,
  minPx: number,
): number {
  const shown = size * zoom;
  return shown > 0 && shown < minPx ? minPx / shown : 1;
}
