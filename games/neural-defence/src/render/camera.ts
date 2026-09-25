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
export interface BoardCamera {
  dispose(): void;
  fit(): void;
  focusCell(width: number, cell: number): void;
  ensureCellVisible(width: number, cell: number): void;
  refresh(): void;
}
export type CameraFactory = (
  svg: SVGSVGElement,
  viewport: HTMLElement,
) => BoardCamera;

/** Camera coordinates are presentation state; no simulation coordinates are changed. */
export function createCameraModel(
  world: Size,
  initialSize: Size,
  insets: Insets,
) {
  let size = initialSize;
  let scale = Math.max(size.width / world.width, size.height / world.height);
  let fitted = false;
  let view: ViewBox = {
    x: 0,
    y: 0,
    width: size.width / scale,
    height: size.height / scale,
  };
  const fitScale = () =>
    Math.min(
      Math.max(1, size.width - insets.left - insets.right) / world.width,
      Math.max(1, size.height - insets.top - insets.bottom) / world.height,
    );
  function clamp() {
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
  function fit() {
    fitted = true;
    scale = fitScale();
    view.x =
      -insets.left / scale -
      (Math.max(1, size.width - insets.left - insets.right) / scale -
        world.width) /
        2;
    view.y =
      -insets.top / scale -
      (Math.max(1, size.height - insets.top - insets.bottom) / scale -
        world.height) /
        2;
    clamp();
  }
  function zoom(
    factor: number,
    anchor = {
      x: size.width / 2,
      y: (size.height + insets.top - insets.bottom) / 2,
    },
  ) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    fitted = false;
    const x = view.x + anchor.x / scale,
      y = view.y + anchor.y / scale;
    scale = Math.max(fitScale() * 0.75, Math.min(8, scale * factor));
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
    fit,
    zoom,
    focus,
    pan(dx: number, dy: number) {
      fitted = false;
      view.x -= dx / scale;
      view.y -= dy / scale;
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
      if (fitted) fit();
      else {
        view.x = center.x - size.width / (2 * scale);
        view.y = center.y - size.height / (2 * scale);
        clamp();
      }
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
    } | null = null;
    let suppressClick = false;
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
      if (event.button !== 0) return;
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
      suppressClick = false;
      gesture = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        dragged: false,
      };
      svg.focus({ preventScroll: true });
    }
    function move(event: PointerEvent) {
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
          };
        }
        suppressClick = true;
        return;
      }
      if (!gesture || gesture.id !== event.pointerId) return;
      suppressClick = gesture.dragged;
      gesture = null;
      viewport.classList.remove("is-panning");
      if (viewport.hasPointerCapture(event.pointerId))
        viewport.releasePointerCapture(event.pointerId);
    }
    function click(event: MouseEvent) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
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
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", up);
    viewport.addEventListener("click", click, true);
    viewport.addEventListener("wheel", wheel, { passive: false });
    const stopResize = dependencies.observeResize(viewport, refresh);
    refresh();
    return {
      refresh,
      fit() {
        model.fit();
        refresh();
      },
      focusCell(width, cell) {
        model.focus(hexCenter(width, cell));
        refresh();
      },
      ensureCellVisible(width, cell) {
        model.ensureVisible(hexCenter(width, cell));
        refresh();
      },
      dispose() {
        disposed = true;
        stopResize();
        viewport.removeEventListener("pointerdown", down);
        viewport.removeEventListener("pointermove", move);
        viewport.removeEventListener("pointerup", up);
        viewport.removeEventListener("pointercancel", up);
        viewport.removeEventListener("click", click, true);
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
