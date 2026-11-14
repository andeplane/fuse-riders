export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type RectState = Record<string, Rect>;

export const TASKBAR_HEIGHT = 28;
export const MIN_WINDOW_WIDTH = 240;
export const MIN_WINDOW_HEIGHT = 160;

/**
 * Narrower than this (a phone, a tablet held upright), windows open maximized: a draggable
 * frame on a 390px screen is all title bar and no content. The same cut-off decides where a
 * Fuse game opens by default (`settings/fuseosPrefsStore.ts`, `WINDOW_LAUNCH_MIN_WIDTH`).
 */
export const COMPACT_MAX_WIDTH = 900;

/** Whether the physical viewport is too narrow for free-floating windows. */
export function isCompactViewport(viewport: Size): boolean {
  return viewport.width < COMPACT_MAX_WIDTH;
}

/**
 * Cascaded default placement for the n-th window, sized relative to the
 * viewport unless the window asks for a size of its own (games that need room).
 */
export function defaultRect(index: number, viewport: Size, size?: Size): Rect {
  const width =
    size?.width ??
    Math.max(MIN_WINDOW_WIDTH, Math.min(760, Math.round(viewport.width * 0.7)));
  const height =
    size?.height ??
    Math.max(
      MIN_WINDOW_HEIGHT,
      Math.min(520, Math.round((viewport.height - TASKBAR_HEIGHT) * 0.7)),
    );
  const offset = 24 * (index % 8);
  return clampRect({ x: 48 + offset, y: 32 + offset, width, height }, viewport);
}

/** Keeps a window inside the desktop area (above the taskbar). */
export function clampRect(rect: Rect, viewport: Size): Rect {
  const areaHeight = Math.max(
    MIN_WINDOW_HEIGHT,
    viewport.height - TASKBAR_HEIGHT,
  );
  const width = Math.max(
    MIN_WINDOW_WIDTH,
    Math.min(rect.width, viewport.width),
  );
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(rect.height, areaHeight));
  const x = Math.max(0, Math.min(rect.x, viewport.width - width));
  const y = Math.max(0, Math.min(rect.y, areaHeight - height));
  return { x, y, width, height };
}
