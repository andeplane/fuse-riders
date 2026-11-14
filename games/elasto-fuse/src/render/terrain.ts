import type { Level } from "../engine/view-kit.js";
import type { Camera, Pane } from "./camera.js";
import {
  CYAN,
  DUSK_LOW,
  DUSK_MID,
  DUSK_TOP,
  GROUND,
  GROUND_TRACE,
  HORIZON,
  WHITE,
  hexA,
} from "./palette.js";

/**
 * A level's ground and sky in one pane. A point is in the air when it is inside an odd number of the level's
 * polygons, which is the canvas's even-odd rule: the pane is filled with ground, then clipped to all the polygons
 * with that rule and painted with sky, then every edge is stroked as a glowing line. Only polygons whose box meets
 * the pane are traced (one that does not cannot hold any of its points).
 */
type G = CanvasRenderingContext2D;

export interface TerrainArt {
  ground?: CanvasImageSource;
  sky?: CanvasImageSource;
}
/** One pane's window on the level, in device pixels. */
export interface Window {
  pane: Pane;
  camera: Camera;
  /** Device pixels per world unit. */
  scale: number;
}

/** A canvas to draw a tile on; the page supplies the browser's, a test none. */
export interface TileCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | null;
}
export type CanvasFactory = (
  width: number,
  height: number,
) => (TileCanvas & CanvasImageSource) | undefined;

/** World units one ground tile covers, and the generated tile's side in pixels. */
export const GROUND_TILE_UNITS = 6,
  TILE_PX = 384;

/** The world point (x, y) on the canvas. */
export const toScreen = (
  view: Window,
  x: number,
  y: number,
): { x: number; y: number } => ({
  x: view.pane.x + view.pane.w / 2 + (x - view.camera.x) * view.scale,
  y: view.pane.y + view.pane.h / 2 - (y - view.camera.y) * view.scale,
});

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
const boxes = new WeakMap<Level, Box[]>();
function polygonBoxes(level: Level): Box[] {
  let known = boxes.get(level);
  if (!known) {
    known = level.polygons.map((polygon) => {
      const box = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
      };
      for (const point of polygon) {
        box.minX = Math.min(box.minX, point.x);
        box.maxX = Math.max(box.maxX, point.x);
        box.minY = Math.min(box.minY, point.y);
        box.maxY = Math.max(box.maxY, point.y);
      }
      return box;
    });
    boxes.set(level, known);
  }
  return known;
}

/** The indices of the polygons that may show in `view`, with a margin for the stroke. */
export function visiblePolygons(level: Level, view: Window): number[] {
  const halfW = view.pane.w / 2 / view.scale + 0.5,
    halfH = view.pane.h / 2 / view.scale + 0.5;
  const seen: number[] = [];
  polygonBoxes(level).forEach((box, index) => {
    if (
      box.maxX >= view.camera.x - halfW &&
      box.minX <= view.camera.x + halfW &&
      box.maxY >= view.camera.y - halfH &&
      box.minY <= view.camera.y + halfH
    )
      seen.push(index);
  });
  return seen;
}

function trace(g: G, level: Level, view: Window, which: number[]): void {
  g.beginPath();
  const ox = view.pane.x + view.pane.w / 2 - view.camera.x * view.scale,
    oy = view.pane.y + view.pane.h / 2 + view.camera.y * view.scale;
  for (const index of which) {
    const polygon = level.polygons[index]!;
    for (let i = 0; i < polygon.length; i++) {
      const point = polygon[i]!;
      const x = ox + point.x * view.scale,
        y = oy - point.y * view.scale;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
  }
}

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** A dark circuit-board tile that repeats in both directions, drawn once. */
export function groundTile(
  create: CanvasFactory,
): CanvasImageSource | undefined {
  const canvas = create(TILE_PX, TILE_PX);
  const g = canvas?.getContext("2d");
  if (!canvas || !g) return undefined;
  g.fillStyle = GROUND;
  g.fillRect(0, 0, TILE_PX, TILE_PX);
  const cell = TILE_PX / 12;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let n = 0; n < 34; n++) {
    let x = Math.floor(hash(n) * 12) * cell,
      y = Math.floor(hash(n + 50) * 12) * cell;
    const points = [[x, y]];
    const turns = 2 + Math.floor(hash(n + 90) * 3);
    for (let i = 0; i < turns; i++) {
      const way = Math.floor(hash(n * 7 + i) * 4),
        far = (1 + Math.floor(hash(n * 13 + i) * 3)) * cell;
      // Runs along the grid and at 45°, like tracks on a board.
      x += way === 0 ? far : way === 1 ? 0 : way === 2 ? far : -far;
      y += way === 0 ? 0 : way === 1 ? far : way === 2 ? far : far;
      points.push([x, y]);
    }
    const bright = hash(n + 200) > 0.82;
    // Drawn on the tile and on its eight neighbours, so a track that leaves one edge comes in at the other.
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        g.beginPath();
        points.forEach(([px, py], i) => {
          const sx = px! + dx * TILE_PX,
            sy = py! + dy * TILE_PX;
          if (i) g.lineTo(sx, sy);
          else g.moveTo(sx, sy);
        });
        g.strokeStyle = bright ? hexA(CYAN, 0.16) : hexA(GROUND_TRACE, 0.7);
        g.lineWidth = bright ? 1.5 : 2;
        g.stroke();
        const [ex, ey] = points[points.length - 1]!;
        g.beginPath();
        g.arc(ex! + dx * TILE_PX, ey! + dy * TILE_PX, 3, 0, Math.PI * 2);
        g.fillStyle = bright ? hexA(CYAN, 0.3) : GROUND_TRACE;
        g.fill();
      }
  }
  return canvas;
}

function drawGround(g: G, view: Window, tile: CanvasImageSource | undefined) {
  const { pane } = view;
  g.fillStyle = GROUND;
  g.fillRect(pane.x, pane.y, pane.w, pane.h);
  if (!tile) return;
  const pattern = g.createPattern(tile, "repeat");
  if (!pattern) return;
  const size = tile as { width?: unknown; naturalWidth?: unknown };
  const px =
    typeof size.naturalWidth === "number" && size.naturalWidth > 0
      ? size.naturalWidth
      : typeof size.width === "number" && size.width > 0
        ? size.width
        : TILE_PX;
  // The tile is pinned to the world, so the ground moves with the terrain.
  const k = (GROUND_TILE_UNITS * view.scale) / px,
    origin = toScreen(view, 0, 0);
  g.save();
  g.translate(origin.x, origin.y);
  g.scale(k, k);
  g.fillStyle = pattern;
  g.fillRect(
    (pane.x - origin.x) / k,
    (pane.y - origin.y) / k,
    pane.w / k,
    pane.h / k,
  );
  g.restore();
}

function ridge(
  g: G,
  view: Window,
  parallax: number,
  base: number,
  height: number,
  fill: string,
  edge: string,
): void {
  const { pane, camera, scale } = view;
  const unit = pane.h / 10,
    floor = pane.y + pane.h * base + camera.y * parallax * scale * 0.4;
  g.beginPath();
  g.moveTo(pane.x, pane.y + pane.h);
  const step = Math.max(6, pane.w / 90);
  for (let sx = 0; sx <= pane.w + step; sx += step) {
    const wx = sx / unit + camera.x * parallax * (scale / unit);
    const rise =
      Math.sin(wx * 0.45 + base * 9) * 0.5 +
      Math.sin(wx * 1.07 + 1.3) * 0.3 +
      Math.sin(wx * 2.3 + 0.4) * 0.12;
    g.lineTo(pane.x + sx, floor - (rise + 0.9) * height * unit);
  }
  g.lineTo(pane.x + pane.w, pane.y + pane.h);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = edge;
  g.lineWidth = Math.max(1, scale * 0.03);
  g.stroke();
}

function drawSky(
  g: G,
  view: Window,
  seconds: number,
  image: CanvasImageSource | undefined,
): void {
  const { pane, camera, scale } = view;
  if (image) {
    // The backdrop fills the pane's height and drifts a quarter as fast as the level.
    const size = image as {
      naturalWidth?: number;
      naturalHeight?: number;
      width?: unknown;
      height?: unknown;
    };
    const iw =
        size.naturalWidth ||
        (typeof size.width === "number" ? size.width : 2048),
      ih =
        size.naturalHeight ||
        (typeof size.height === "number" ? size.height : 1024);
    const h = pane.h * 1.2,
      w = (iw / ih) * h;
    const drift = camera.x * scale * 0.25;
    let x = pane.x - (((drift % w) + w) % w);
    const y =
      pane.y -
      pane.h * 0.1 +
      Math.max(-0.1, Math.min(0.1, camera.y * 0.004)) * pane.h;
    for (; x < pane.x + pane.w; x += w) g.drawImage(image, x, y, w, h);
    return;
  }
  const sky = g.createLinearGradient(0, pane.y, 0, pane.y + pane.h);
  sky.addColorStop(0, DUSK_TOP);
  sky.addColorStop(0.5, DUSK_MID);
  sky.addColorStop(0.82, DUSK_LOW);
  sky.addColorStop(1, HORIZON);
  g.fillStyle = sky;
  g.fillRect(pane.x, pane.y, pane.w, pane.h);
  // Stars, drifting a tenth as fast as the level.
  const drift = camera.x * scale * 0.1;
  for (let n = 0; n < 70; n++) {
    const sx = (((hash(n) * pane.w * 1.5 - drift) % pane.w) + pane.w) % pane.w,
      sy = hash(n + 300) * pane.h * 0.62,
      twinkle = 0.45 + 0.4 * Math.sin(seconds * (0.8 + hash(n + 7)) + n);
    g.fillStyle = hexA(WHITE, twinkle * (1 - sy / (pane.h * 0.7)));
    const dot = Math.max(1, scale * (0.02 + hash(n + 11) * 0.025));
    g.fillRect(pane.x + sx, pane.y + sy, dot, dot);
  }
  ridge(g, view, 0.12, 0.86, 1.5, "#1d0f47", hexA("#a47bff", 0.5));
  ridge(g, view, 0.28, 0.98, 1.3, "#12093a", hexA(CYAN, 0.35));
}

/** Paints `level` in `view`'s pane; the caller has clipped to the pane. */
export function drawTerrain(
  g: G,
  level: Level,
  view: Window,
  seconds: number,
  art: TerrainArt,
  tile: CanvasImageSource | undefined,
): void {
  drawGround(g, view, art.ground ?? tile);
  const which = visiblePolygons(level, view);
  if (!which.length) return;
  g.save();
  trace(g, level, view, which);
  g.clip("evenodd");
  drawSky(g, view, seconds, art.sky);
  // The ground's shadow on the air beside it: the edge reads as solid.
  trace(g, level, view, which);
  g.lineJoin = "round";
  g.strokeStyle = hexA("#020616", 0.22);
  g.lineWidth = view.scale * 0.3;
  g.stroke();
  g.restore();
  trace(g, level, view, which);
  g.lineJoin = "round";
  g.strokeStyle = hexA(CYAN, 0.16);
  g.lineWidth = view.scale * 0.22;
  g.stroke();
  g.strokeStyle = hexA(CYAN, 0.4);
  g.lineWidth = view.scale * 0.1;
  g.stroke();
  g.strokeStyle = "#c4f9ff";
  g.lineWidth = Math.max(1.5, view.scale * 0.04);
  g.stroke();
}
