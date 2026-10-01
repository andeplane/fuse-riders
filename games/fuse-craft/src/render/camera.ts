import { hexCenter } from "./board.js";

export interface Size {
  width: number;
  height: number;
}
export interface ViewBox extends Size {
  x: number;
  y: number;
}
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export type PanDirection = "left" | "right" | "up" | "down";
export interface BoardCamera {
  dispose(): void;
  focusCell(width: number, cell: number): void;
  ensureCellVisible(width: number, cell: number): void;
  refresh(): void;
  /** Starts or stops scrolling one way, as while an arrow key is held. */
  hold(direction: PanDirection, held: boolean): void;
  /** Scrolls when the mouse rests at the board's edge (RTS edge scrolling). */
  setEdgeScroll(enabled: boolean): void;
}

/** Screen pixels from the board's edge that start edge scrolling. */
export const EDGE_ZONE = 28;
/**
 * The window's outermost pixels scroll even over the top bar and command
 * dock, as in RTS games: in full screen the mouse stops there.
 */
export const SCREEN_EDGE = 8;
/** Scroll speed for held keys and edge scrolling, in screen pixels a second. */
export const SCROLL_SPEED = 900;

export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Size {
  left: number;
  top: number;
}

/**
 * Which way the mouse asks the camera to scroll, per axis -1, 0 or 1. The
 * pointer is in window pixels. Inside the board, resting within EDGE_ZONE of
 * its sides scrolls; anywhere, including over the HUD, the window's outer
 * SCREEN_EDGE pixels do. A pointer at or past the last pixel row or column
 * still counts. Without a screen size only the board's edges apply.
 */
export function edgeAxes(
  pointer: Point | null,
  board: Rect,
  screen: Size | null,
): Point {
  let x = 0,
    y = 0;
  if (!pointer) return { x, y };
  const bx = pointer.x - board.left,
    by = pointer.y - board.top;
  if (bx >= 0 && by >= 0 && bx < board.width && by < board.height) {
    if (bx < EDGE_ZONE) x = -1;
    else if (bx >= board.width - EDGE_ZONE) x = 1;
    if (by < EDGE_ZONE) y = -1;
    else if (by >= board.height - EDGE_ZONE) y = 1;
  }
  if (screen) {
    if (pointer.x < SCREEN_EDGE) x = -1;
    else if (pointer.x >= screen.width - SCREEN_EDGE) x = 1;
    if (pointer.y < SCREEN_EDGE) y = -1;
    else if (pointer.y >= screen.height - SCREEN_EDGE) y = 1;
  }
  return { x, y };
}

/**
 * Which way the camera scrolls, as unit components: held arrow keys, plus
 * the edge axes from the mouse. Null when nothing asks it to move.
 */
export function scrollDirection(
  held: ReadonlySet<PanDirection>,
  edge: Point = { x: 0, y: 0 },
): Point | null {
  let x = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
  let y = (held.has("down") ? 1 : 0) - (held.has("up") ? 1 : 0);
  if (edge.x) x = edge.x;
  if (edge.y) y = edge.y;
  if (!x && !y) return null;
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
}

/**
 * The window the mouse moves over, for edge scrolling across the HUD as
 * well as the board. `watch` reports the mouse in window pixels, or null
 * when a button is down, it leaves the window, or the window loses focus.
 */
export interface PointerSurface {
  size(): Size;
  watch(listener: (pointer: Point | null) => void): () => void;
}
export type CameraFactory = (
  svg: SVGSVGElement,
  viewport: HTMLElement,
) => BoardCamera;

/**
 * The closest zoom, in screen pixels per board unit: a brain about 216px
 * across. Closer than this shows one building filling the screen and
 * nothing of the battle around it.
 */
export const MAX_SCALE = 3;

/** Camera coordinates are presentation state; no simulation coordinates are changed. */
export function createCameraModel(
  world: Size,
  initialSize: Size,
  insets: Insets,
) {
  let size = initialSize;
  // Begin at a playable unit scale, rather than shrinking large arenas to fit.
  let scale = Math.max(
    size.width / world.width,
    size.height / world.height,
    Math.min(1.8, Math.max(1.1, size.width / 800)),
  );
  let view: ViewBox = {
    x: 0,
    y: 0,
    width: size.width / scale,
    height: size.height / scale,
  };
  // Never shrink the battlefield inside a larger expanse of decorative ground.
  // The minimap provides the overview; the main view stays readable and fills
  // both viewport axes, including after a device rotates or window resizes.
  const minimumScale = () =>
    Math.max(1.1, size.width / world.width, size.height / world.height);
  function clamp() {
    scale = Math.max(minimumScale(), scale);
    view.width = size.width / scale;
    view.height = size.height / scale;
    const cx = (world.width - view.width) / 2;
    const cy = (world.height - view.height) / 2;
    view.x = Math.max(
      Math.min(-insets.left / scale, cx),
      Math.min(
        Math.max(world.width - view.width + insets.right / scale, cx),
        view.x,
      ),
    );
    view.y = Math.max(
      Math.min(-insets.top / scale, cy),
      Math.min(
        Math.max(world.height - view.height + insets.bottom / scale, cy),
        view.y,
      ),
    );
  }
  function zoom(
    factor: number,
    anchor = {
      x: size.width / 2,
      y: (size.height + insets.top - insets.bottom) / 2,
    },
  ) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const x = view.x + anchor.x / scale,
      y = view.y + anchor.y / scale;
    scale = Math.max(minimumScale(), Math.min(MAX_SCALE, scale * factor));
    view.x = x - anchor.x / scale;
    view.y = y - anchor.y / scale;
    clamp();
  }
  function focus(point: { x: number; y: number }) {
    view.x = point.x - size.width / (2 * scale);
    view.y = point.y - (size.height + insets.top - insets.bottom) / (2 * scale);
    clamp();
  }
  clamp();
  return {
    view: (): ViewBox => ({ ...view }),
    zoom,
    focus,
    pan(dx: number, dy: number) {
      view.x -= dx / scale;
      view.y -= dy / scale;
      clamp();
    },
    /** Moves the view itself by screen pixels: positive scrolls right and down. */
    scroll(dx: number, dy: number) {
      view.x += dx / scale;
      view.y += dy / scale;
      clamp();
    },
    resize(next: Size) {
      if (
        next.width <= 0 ||
        next.height <= 0 ||
        (next.width === size.width && next.height === size.height)
      )
        return;
      const center = {
        x: view.x + view.width / 2,
        y: view.y + view.height / 2,
      };
      size = next;
      scale = Math.max(minimumScale(), scale);
      view.x = center.x - size.width / (2 * scale);
      view.y = center.y - size.height / (2 * scale);
      clamp();
    },
    ensureVisible(point: { x: number; y: number }) {
      const margin = 38;
      const left = view.x + (insets.left + margin) / scale;
      const right = view.x + (size.width - insets.right - margin) / scale;
      const top = view.y + (insets.top + margin) / scale;
      const bottom = view.y + (size.height - insets.bottom - margin) / scale;
      if (point.x < left) view.x -= left - point.x;
      if (point.x > right) view.x += point.x - right;
      if (point.y < top) view.y -= top - point.y;
      if (point.y > bottom) view.y += point.y - bottom;
      clamp();
    },
  };
}

export interface CameraDependencies {
  observeResize(element: Element, callback: () => void): () => void;
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(handle: number): void;
  /** Without it, edge scrolling follows the mouse over the board only. */
  screen?: PointerSurface;
}

export function createCameraFactory(
  dependencies: CameraDependencies,
): CameraFactory {
  return (svg, viewport) => {
    const numbers = (svg.getAttribute("viewBox") ?? "0 0 1 1")
      .split(/\s+/)
      .map(Number);
    const measure = () => ({
      width: Math.max(1, viewport.clientWidth),
      height: Math.max(1, viewport.clientHeight),
    });
    const size = measure();
    const model = createCameraModel(
      { width: numbers[2]!, height: numbers[3]! },
      size,
      {
        top: 12,
        right: 12,
        bottom: 12,
        left: 12,
      },
    );
    let disposed = false;
    let gesture: {
      id: number;
      startX: number;
      startY: number;
      x: number;
      y: number;
      dragged: boolean;
      panOnly: boolean;
    } | null = null;
    let suppressClick = false;
    const held = new Set<PanDirection>();
    let edgeScroll = false;
    // The mouse in window pixels, for edge scrolling; null when it is away
    // or a button is down.
    let pointer: Point | null = null;
    let frame: number | null = null;
    let lastFrame: number | null = null;
    function tick(now: number) {
      frame = null;
      const rect = viewport.getBoundingClientRect();
      const direction = scrollDirection(
        held,
        edgeAxes(
          edgeScroll ? pointer : null,
          {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
          dependencies.screen?.size() ?? null,
        ),
      );
      if (!direction || disposed) {
        lastFrame = null;
        return;
      }
      // Frame time, capped so a stalled tab does not jump across the map.
      const seconds =
        lastFrame === null ? 1 / 60 : Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      model.scroll(
        direction.x * SCROLL_SPEED * seconds,
        direction.y * SCROLL_SPEED * seconds,
      );
      refresh();
      frame = dependencies.requestFrame(tick);
    }
    function wake() {
      if (frame === null && !disposed) frame = dependencies.requestFrame(tick);
    }
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { x: number; y: number; distance: number } | null = null;
    function touchPair() {
      const [a, b] = [...touches.values()];
      return a && b
        ? {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          }
        : null;
    }
    function refresh() {
      if (disposed) return;
      model.resize(measure());
      const v = model.view();
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.width} ${v.height}`);
      const ground = svg.querySelector(".terrain-backdrop");
      if (ground) {
        ground.setAttribute("x", String(v.x - 1));
        ground.setAttribute("y", String(v.y - 1));
        ground.setAttribute("width", String(v.width + 2));
        ground.setAttribute("height", String(v.height + 2));
      }
    }
    function down(event: PointerEvent) {
      if (event.button !== 0 && event.button !== 2) return;
      const panOnly = event.button === 2 || event.ctrlKey;
      if (event.pointerType === "touch") {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size > 1) {
          pinch = touchPair();
          suppressClick = true;
          viewport.setPointerCapture(event.pointerId);
          if (gesture) viewport.setPointerCapture(gesture.id);
          gesture = null;
          return;
        }
      } else if (!event.isPrimary) return;
      suppressClick = panOnly;
      gesture = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        dragged: false,
        panOnly,
      };
      if (panOnly) {
        event.preventDefault();
        viewport.setPointerCapture(event.pointerId);
      }
      svg.focus({ preventScroll: true });
    }
    // With a screen surface the mouse is followed over the whole window;
    // otherwise only while it is over the board.
    function hover(event: PointerEvent) {
      if (dependencies.screen) return;
      pointerAt(
        event.pointerType !== "mouse" || event.buttons
          ? null
          : { x: event.clientX, y: event.clientY },
      );
    }
    function pointerAt(next: Point | null) {
      pointer = next;
      if (pointer && edgeScroll) wake();
    }
    function leave() {
      if (!dependencies.screen) pointer = null;
    }
    const stopPointer = dependencies.screen?.watch(pointerAt);
    function move(event: PointerEvent) {
      hover(event);
      // A mouse can leave the viewport before crossing the drag threshold.
      // Its release then happens outside our listeners, so hover must cancel it.
      if (event.pointerType !== "touch" && event.buttons === 0 && gesture) {
        up(event);
        return;
      }
      if (touches.has(event.pointerId)) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const next = touchPair();
        if (pinch && next) {
          const rect = viewport.getBoundingClientRect();
          model.zoom(next.distance / pinch.distance, {
            x: pinch.x - rect.left,
            y: pinch.y - rect.top,
          });
          model.pan(next.x - pinch.x, next.y - pinch.y);
          pinch = next;
          event.preventDefault();
          refresh();
          return;
        }
      }
      if (!gesture || gesture.id !== event.pointerId) return;
      if (
        !gesture.dragged &&
        Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        ) < 6
      )
        return;
      if (!gesture.dragged) {
        gesture.dragged = true;
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add("is-panning");
      }
      model.pan(event.clientX - gesture.x, event.clientY - gesture.y);
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      event.preventDefault();
      refresh();
    }
    function up(event: PointerEvent) {
      if (touches.delete(event.pointerId) && pinch) {
        pinch = touchPair();
        if (viewport.hasPointerCapture(event.pointerId))
          viewport.releasePointerCapture(event.pointerId);
        const remaining = [...touches.entries()][0];
        if (!pinch && remaining) {
          const [id, point] = remaining;
          gesture = {
            id,
            startX: point.x,
            startY: point.y,
            x: point.x,
            y: point.y,
            dragged: true,
            panOnly: false,
          };
        }
        suppressClick = true;
        return;
      }
      if (!gesture || gesture.id !== event.pointerId) return;
      suppressClick = gesture.dragged || gesture.panOnly;
      gesture = null;
      viewport.classList.remove("is-panning");
      if (viewport.hasPointerCapture(event.pointerId))
        viewport.releasePointerCapture(event.pointerId);
    }
    function click(event: MouseEvent) {
      if (!suppressClick && event.button !== 2 && !event.ctrlKey) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function contextMenu(event: MouseEvent) {
      event.preventDefault();
    }
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1;
      model.zoom(
        Math.exp(-Math.max(-400, Math.min(400, event.deltaY * unit)) * 0.0015),
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
      );
      refresh();
    }
    viewport.addEventListener("pointerdown", down);
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerleave", leave);
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", up);
    viewport.addEventListener("click", click, true);
    viewport.addEventListener("auxclick", click, true);
    viewport.addEventListener("contextmenu", contextMenu);
    viewport.addEventListener("wheel", wheel, { passive: false });
    const stopResize = dependencies.observeResize(viewport, refresh);
    refresh();
    return {
      refresh,
      focusCell(width, cell) {
        model.focus(hexCenter(width, cell));
        refresh();
      },
      ensureCellVisible(width, cell) {
        model.ensureVisible(hexCenter(width, cell));
        refresh();
      },
      hold(direction, on) {
        if (on) held.add(direction);
        else held.delete(direction);
        if (held.size) wake();
      },
      setEdgeScroll(enabled) {
        edgeScroll = enabled;
        if (!enabled) pointer = null;
      },
      dispose() {
        disposed = true;
        stopResize();
        stopPointer?.();
        viewport.removeEventListener("pointerdown", down);
        viewport.removeEventListener("pointermove", move);
        viewport.removeEventListener("pointerleave", leave);
        if (frame !== null) dependencies.cancelFrame(frame);
        frame = null;
        held.clear();
        viewport.removeEventListener("pointerup", up);
        viewport.removeEventListener("pointercancel", up);
        viewport.removeEventListener("click", click, true);
        viewport.removeEventListener("auxclick", click, true);
        viewport.removeEventListener("contextmenu", contextMenu);
        viewport.removeEventListener("wheel", wheel);
        if (gesture && viewport.hasPointerCapture(gesture.id))
          viewport.releasePointerCapture(gesture.id);
        for (const id of touches.keys()) {
          if (viewport.hasPointerCapture(id))
            viewport.releasePointerCapture(id);
        }
        touches.clear();
        pinch = null;
        gesture = null;
      },
    };
  };
}
