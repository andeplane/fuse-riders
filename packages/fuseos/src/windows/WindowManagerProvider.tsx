import type { ReactNode } from "react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import { DisplayViewportContext } from "../desktop/displayViewportContext";

import type { Rect, RectState, Size } from "./windowManager";
import { clampRect, defaultRect, isCompactViewport } from "./windowManager";
import { WindowManagerContext } from "./windowManagerContext";
import { WindowsDepsContext } from "./windowsDepsContext";

/** Owns window rectangles (local only; positions are not shared through links). */
export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const { getViewport, subscribeViewport } = useContext(WindowsDepsContext);
  const [rects, setRects] = useState<RectState>({});
  const [available, setViewport] = useState(getViewport);
  const display = useContext(DisplayViewportContext);
  const viewport = display?.viewport ?? available;
  // Judged on the physical screen, not the emulated desktop area: a 640x480 desktop on a laptop still floats its windows.
  const compact = isCompactViewport(available);

  useEffect(
    () => subscribeViewport(() => setViewport(getViewport())),
    [getViewport, subscribeViewport],
  );

  const rectFor = useCallback(
    (id: string, index: number, size?: Size, fixed = false) => {
      const rect = rects[id] ?? defaultRect(index, viewport, size);
      return clampRect(fixed && size ? { ...rect, ...size } : rect, viewport);
    },
    [rects, viewport],
  );
  const setRect = useCallback(
    (id: string, rect: Rect) =>
      setRects((previous) => ({
        ...previous,
        [id]: clampRect(rect, viewport),
      })),
    [viewport],
  );

  const pruneRects = useCallback((openIds: readonly string[]) => {
    setRects((previous) => {
      const stale = Object.keys(previous).filter((id) => !openIds.includes(id));
      if (stale.length === 0) return previous;
      const next = { ...previous };
      stale.forEach((id) => delete next[id]);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ rects, viewport, compact, rectFor, setRect, pruneRects }),
    [rects, viewport, compact, rectFor, setRect, pruneRects],
  );
  return (
    <WindowManagerContext.Provider value={value}>
      {children}
    </WindowManagerContext.Provider>
  );
}
