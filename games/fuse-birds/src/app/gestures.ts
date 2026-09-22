import { quantize, MAX_VX, MAX_VY } from "../engine/view-kit.js";
import type { Vector } from "../engine/view.js";
import {
  constrainCamera,
  fitScale,
  screenToWorld,
  zoomAt,
  type Camera,
  type MapSize,
  type Viewport,
} from "../render/camera.js";

export interface Point {
  x: number;
  y: number;
}
interface Pointer extends Point {
  id: number;
}
export interface GestureState {
  camera: Camera;
  aim?: Vector;
  pointers: Map<number, Point>;
  mode: "idle" | "aim" | "pan" | "pinch";
  start?: Pointer;
  initialCamera?: Camera;
  initialDistance?: number;
  midpoint?: Point;
  /** A two-finger gesture suppresses release-to-fire until every finger has left. */
  cancelled: boolean;
}
export function createGestures(camera: Camera): GestureState {
  return {
    camera: { ...camera },
    pointers: new Map(),
    mode: "idle",
    cancelled: false,
  };
}
export function cancelGesture(state: GestureState): void {
  state.aim = undefined;
  state.start = undefined;
  state.initialCamera = undefined;
  state.initialDistance = undefined;
  state.midpoint = undefined;
  state.mode = "idle";
  state.cancelled = state.pointers.size > 0;
}
const center = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
export function pointerDown(
  state: GestureState,
  pointer: Pointer,
  canAim: boolean,
  map: MapSize,
  viewport: Viewport,
  bird?: Point,
): void {
  state.pointers.set(pointer.id, { x: pointer.x, y: pointer.y });
  if (state.pointers.size === 2) {
    const [a, b] = [...state.pointers.values()] as [Point, Point];
    state.aim = undefined;
    state.mode = "pinch";
    state.cancelled = true;
    state.initialCamera = { ...state.camera };
    state.initialDistance = Math.max(1, distance(a, b));
    state.midpoint = center(a, b);
    return;
  }
  if (state.pointers.size !== 1 || state.cancelled) return;
  const scale = fitScale(map, viewport) * state.camera.zoom;
  const world = screenToWorld(pointer, state.camera, map, viewport);
  state.mode =
    canAim && bird && distance(world, bird) * scale <= 48 ? "aim" : "pan";
  state.start = pointer;
  state.initialCamera = { ...state.camera };
}
export function pointerMove(
  state: GestureState,
  pointer: Pointer,
  map: MapSize,
  viewport: Viewport,
): void {
  if (!state.pointers.has(pointer.id)) return;
  state.pointers.set(pointer.id, { x: pointer.x, y: pointer.y });
  if (
    state.mode === "pinch" &&
    state.pointers.size >= 2 &&
    state.initialCamera &&
    state.midpoint &&
    state.initialDistance
  ) {
    const [a, b] = [...state.pointers.values()] as [Point, Point],
      point = center(a, b);
    const zoomed = zoomAt(
      state.initialCamera,
      (state.initialCamera.zoom * distance(a, b)) / state.initialDistance,
      state.midpoint,
      map,
      viewport,
    );
    const scale = fitScale(map, viewport) * zoomed.zoom;
    state.camera = constrainCamera(
      {
        ...zoomed,
        x: zoomed.x - (point.x - state.midpoint.x) / scale,
        y: zoomed.y - (point.y - state.midpoint.y) / scale,
      },
      map,
      viewport,
    );
    return;
  }
  if (!state.start || state.start.id !== pointer.id || !state.initialCamera)
    return;
  const dx = state.start.x - pointer.x,
    dy = state.start.y - pointer.y;
  if (state.mode === "aim" && !state.cancelled) {
    // CSS drag distance determines power; zoom never alters an otherwise identical shot.
    const pull = Math.max(
      90,
      Math.min(160, Math.min(viewport.width, viewport.height) * 0.35),
    );
    state.aim = quantize((dx * MAX_VX) / pull, (dy * MAX_VY) / pull);
  } else if (state.mode === "pan") {
    const scale = fitScale(map, viewport) * state.initialCamera.zoom;
    state.camera = constrainCamera(
      {
        ...state.initialCamera,
        x: state.initialCamera.x + dx / scale,
        y: state.initialCamera.y + dy / scale,
      },
      map,
      viewport,
    );
  }
}
export function pointerUp(state: GestureState, id: number): Vector | undefined {
  const shot =
    state.mode === "aim" && state.start?.id === id && !state.cancelled
      ? state.aim
      : undefined;
  state.pointers.delete(id);
  cancelGesture(state);
  return shot;
}
