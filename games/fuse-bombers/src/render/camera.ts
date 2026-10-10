// The framing camera: where the world camera looks and how far it zooms, in plain numbers (no Phaser) so it is
// unit-tested. Render only, never fed back into the simulation; docs/engine.md "Camera" has the behaviour and the
// wiring: `cameras.main.setZoom(pose.zoom).centerOn(pose.centerX, pose.centerY)`, the HUD on the UI camera.

export type Size = { readonly width: number; readonly height: number };
export type Point = { readonly x: number; readonly y: number };
type Box = { x0: number; y0: number; x1: number; y1: number };
const EMPTY: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

/** A point to frame. Weight 1 (the default) stays in view; lower pulls the frame part of the way; 0 is ignored. */
export type CameraPoint = Point & { readonly weight?: number };
/** The gunship a personal device follows; its velocity (world px/s) sets the look-ahead. */
export type CameraFocus = Point & { vx?: number; vy?: number };

export interface CameraInput {
  /** Shared screen: everything to frame. Personal device: the opponents. */
  readonly points: readonly CameraPoint[];
  /** Personal-device mode: follow this gunship. */
  readonly focus?: CameraFocus;
}

/** Phaser's `setZoom(zoom)` (screen px per world px) and `centerOn(centerX, centerY)`. */
export interface CameraPose {
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
}

export interface CameraSettings {
  /** The viewport (screen px) and the world (world px). */
  readonly view: Size;
  readonly world: Size;
  /** World px kept around each framed point, for its hull, aim guide and health bar. */
  readonly padding: number;
  /** Zoomed in fully the view still shows this much area (one old arena); on a 16:9 view exactly this rect. */
  readonly minVisible: Size;
  /** Personal device: zoomed out fully to keep opponents, it shows this much area. */
  readonly followMaxVisible: Size;
  /** Personal device: look this many seconds ahead along the focus's velocity, at most `lookAheadMax` world px. */
  readonly lookAheadTime: number;
  readonly lookAheadMax: number;
  /** Time constants (s) of the approach: panning, zooming out (fast) and zooming in (slow). */
  readonly panTime: number;
  readonly zoomOutTime: number;
  readonly zoomInTime: number;
  /** The camera holds still while the target moves less than this many screen px, or this much log zoom. */
  readonly deadZone: number;
  readonly zoomDeadZone: number;
  /** Weight-1 points (or the focus) stay this many world px inside the view whatever the easing, world edge allowing. */
  readonly keepMargin: number;
  /** Longer frames (s) count as this long. */
  readonly maxDt: number;
}

export type CameraOptions = Pick<CameraSettings, "view" | "world"> &
  Partial<CameraSettings>;

export const CAMERA_DEFAULTS: Omit<CameraSettings, "view" | "world"> = {
  padding: 260,
  minVisible: { width: 1600, height: 900 },
  followMaxVisible: { width: 3200, height: 1800 },
  lookAheadTime: 0.6,
  lookAheadMax: 320,
  panTime: 0.35,
  zoomOutTime: 0.3,
  zoomInTime: 1.2,
  deadZone: 6,
  zoomDeadZone: 0.02,
  keepMargin: 120,
  maxDt: 0.1,
};

/** The camera's state; `snapCamera` and `updateCamera` own `pose` (shown now) and `goal` (eased toward). */
export interface Camera {
  readonly settings: CameraSettings;
  pose: CameraPose;
  goal: CameraPose;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const finite = (v: number | undefined) =>
  v !== undefined && Number.isFinite(v) ? v : 0;
const areaZoom = (view: Size, visible: Size) =>
  Math.sqrt((view.width * view.height) / (visible.width * visible.height));

/** The zoom range: the whole world fitted to the view .. `minVisible`. */
export function zoomLimits(s: CameraSettings): { min: number; max: number } {
  const { view: v, world: w } = s;
  const min = Math.min(v.width / w.width, v.height / w.height);
  return { min, max: Math.max(min, areaZoom(v, s.minVisible)) };
}

/** The world rect a pose shows. */
export function visibleRect(pose: CameraPose, view: Size): Point & Size {
  const [width, height] = [view.width / pose.zoom, view.height / pose.zoom];
  const [x, y] = [pose.centerX - width / 2, pose.centerY - height / 2];
  return { x, y, width, height };
}

export function createCamera(options: CameraOptions): Camera {
  const settings = { ...CAMERA_DEFAULTS, ...options };
  const whole = cameraTarget({ settings }, { points: [] });
  return { settings, pose: whole, goal: whole };
}

/** Jumps straight to the target (a round's first frame). */
export function snapCamera(camera: Camera, input: CameraInput): CameraPose {
  return (camera.pose = camera.goal = cameraTarget(camera, input));
}

/** Eases the camera toward this frame's target over `dt` seconds and returns the pose to apply. */
export function updateCamera(camera: Camera, input: CameraInput, dt: number) {
  const { settings: s, pose } = camera;
  const time = Number.isNaN(dt) ? 0 : clamp(dt, 0, s.maxDt);
  const ease = (tau: number) => (tau > 0 ? 1 - Math.exp(-time / tau) : 1);
  const goal = hold(camera.goal, cameraTarget(camera, input), s);
  const zoomTime = goal.zoom < pose.zoom ? s.zoomOutTime : s.zoomInTime;
  // In log space, so 0.4 → 0.8 takes as long as 0.2 → 0.4.
  const zoom =
    pose.zoom * Math.exp(Math.log(goal.zoom / pose.zoom) * ease(zoomTime));
  const pan = ease(s.panTime);
  const x = lerp(pose.centerX, goal.centerX, pan);
  const y = lerp(pose.centerY, goal.centerY, pan);
  const f = focusOf(input);
  const kept = f ? [f] : live(input.points).filter((p) => weight(p) >= 1);
  camera.goal = goal;
  camera.pose = keepInView(inWorld(x, y, zoom, s), kept, s);
  return camera.pose;
}

/** An edge arrow: where on the HUD camera (screen px) and its angle toward the point (0 right, y down). */
export type OffscreenMarker<T> = Point & { point: T; angle: number };

/** For each point outside the view, its edge arrow, `inset` inside the view's edges. */
export function offscreenMarkers<T extends Point>(
  pose: CameraPose,
  view: Size,
  points: readonly T[],
  inset = 28,
): OffscreenMarker<T>[] {
  const markers: OffscreenMarker<T>[] = [];
  for (const point of points) {
    const sx = (point.x - pose.centerX) * pose.zoom + view.width / 2;
    const sy = (point.y - pose.centerY) * pose.zoom + view.height / 2;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
    if (sx >= 0 && sx <= view.width && sy >= 0 && sy <= view.height) continue;
    const x = clamp(sx, inset, view.width - inset);
    const y = clamp(sy, inset, view.height - inset);
    markers.push({ point, x, y, angle: Math.atan2(sy - y, sx - x) });
  }
  return markers;
}

const weight = (p: CameraPoint) => Math.min(1, p.weight ?? 1);
const live = (points: readonly CameraPoint[]) =>
  points.filter((p) => Number.isFinite(p.x + p.y) && weight(p) > 0);
const focusOf = ({ focus: f }: CameraInput) =>
  f && Number.isFinite(f.x + f.y) ? f : undefined;

/** Moves each point to `anchor + weight · (point − anchor)`. */
const pull = (points: readonly CameraPoint[], anchor: Point): Point[] =>
  points.map((p) => ({
    x: lerp(anchor.x, p.x, weight(p)),
    y: lerp(anchor.y, p.y, weight(p)),
  }));

/** The bounding box grown by `pad` (inside out, infinitely, for no points). */
function boxOf(points: readonly Point[], pad: number, box?: Box): Box {
  const out = { ...(box ?? EMPTY) };
  for (const p of points) {
    out.x0 = Math.min(out.x0, p.x - pad);
    out.y0 = Math.min(out.y0, p.y - pad);
    out.x1 = Math.max(out.x1, p.x + pad);
    out.y1 = Math.max(out.y1, p.y + pad);
  }
  return out;
}

const fitZoom = (b: Box, s: CameraSettings) =>
  Math.min(s.view.width / (b.x1 - b.x0), s.view.height / (b.y1 - b.y0));

/** Centres the view on `x, y` at `zoom`, slid inside the world (centred on an axis the view is wider than). */
function inWorld(x: number, y: number, zoom: number, s: CameraSettings) {
  const axis = (c: number, view: number, world: number) => {
    const half = view / zoom / 2;
    return 2 * half >= world ? world / 2 : clamp(c, half, world - half);
  };
  return {
    centerX: axis(x, s.view.width, s.world.width),
    centerY: axis(y, s.view.height, s.world.height),
    zoom,
  };
}

function frame(b: Box, s: CameraSettings, min: number, max: number) {
  const zoom = clamp(fitZoom(b, s), min, max);
  return inWorld((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, zoom, s);
}

/** Where the camera would settle for this input, before easing and dead zones. */
export function cameraTarget(
  { settings: s }: Pick<Camera, "settings">,
  input: CameraInput,
): CameraPose {
  const { min, max } = zoomLimits(s);
  const points = live(input.points);
  const f = focusOf(input);
  if (f) {
    const [vx, vy] = [finite(f.vx), finite(f.vy)];
    const speed = Math.hypot(vx, vy) || 1;
    const t = Math.min(s.lookAheadTime, s.lookAheadMax / speed);
    let box = boxOf([f, { x: f.x + vx * t, y: f.y + vy * t }], s.padding);
    const widest = clamp(areaZoom(s.view, s.followMaxVisible), min, max);
    const dist = (p: Point) => Math.hypot(p.x - f.x, p.y - f.y);
    // The nearest opponents, while they fit.
    for (const p of pull(points, f).sort((a, b) => dist(a) - dist(b))) {
      const wider = boxOf([p], s.padding, box);
      if (fitZoom(wider, s) < widest) break;
      box = wider;
    }
    return frame(box, s, widest, max);
  }
  if (points.length === 0) {
    return inWorld(s.world.width / 2, s.world.height / 2, min, s);
  }
  // Weights pull toward the weighted mean, so weight-1 points stay exact.
  const sum = points.reduce((n, p) => n + weight(p), 0);
  const anchor = {
    x: points.reduce((n, p) => n + weight(p) * p.x, 0) / sum,
    y: points.reduce((n, p) => n + weight(p) * p.y, 0) / sum,
  };
  return frame(boxOf(pull(points, anchor), s.padding), s, min, max);
}

/** Moves the goal toward the target only by what exceeds the dead zones. */
function hold(goal: CameraPose, to: CameraPose, s: CameraSettings) {
  const dz = Math.log(to.zoom / goal.zoom);
  const over = Math.max(0, Math.abs(dz) - s.zoomDeadZone);
  const zoom = goal.zoom * Math.exp(Math.sign(dz) * over);
  const [dx, dy] = [to.centerX - goal.centerX, to.centerY - goal.centerY];
  const screen = Math.hypot(dx, dy) * zoom;
  const t = screen <= s.deadZone ? 0 : 1 - s.deadZone / screen;
  return inWorld(goal.centerX + dx * t, goal.centerY + dy * t, zoom, s);
}

/** Widens and slides the view as little as needed to keep every point `keepMargin` inside it. */
function keepInView(pose: CameraPose, points: Point[], s: CameraSettings) {
  if (points.length === 0) return pose;
  const [w, h] = [s.world.width, s.world.height];
  const b = boxOf(points, s.keepMargin);
  const [x0, x1] = [clamp(b.x0, 0, w), clamp(b.x1, 0, w)];
  const [y0, y1] = [clamp(b.y0, 0, h), clamp(b.y1, 0, h)];
  const fit = fitZoom({ x0, y0, x1, y1 }, s);
  const zoom = Math.max(zoomLimits(s).min, Math.min(pose.zoom, fit));
  const axis = (c: number, lo: number, hi: number, view: number) => {
    const half = view / zoom / 2;
    return hi - lo >= 2 * half ? (lo + hi) / 2 : clamp(c, hi - half, lo + half);
  };
  return inWorld(
    axis(pose.centerX, x0, x1, s.view.width),
    axis(pose.centerY, y0, y1, s.view.height),
    zoom,
    s,
  );
}
