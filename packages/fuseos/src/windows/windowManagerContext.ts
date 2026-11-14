import { createContext } from 'react';

import type { Rect, RectState, Size } from './windowManager';

export type WindowManager = {
  rects: RectState;
  viewport: Size;
  /** Current or default rectangle; `size` is the window's preferred size when it has never been placed. */
  rectFor: (id: string, index: number, size?: Size, fixed?: boolean) => Rect;
  setRect: (id: string, rect: Rect) => void;
  /** Drops the rectangles of windows that are no longer open, so a reused window id starts from its default size again. */
  pruneRects: (openIds: readonly string[]) => void;
};

export const WindowManagerContext = createContext<WindowManager>({
  rects: {},
  viewport: { width: 1024, height: 768 },
  rectFor: () => ({ x: 0, y: 0, width: 640, height: 480 }),
  setRect: () => undefined,
  pruneRects: () => undefined,
});
