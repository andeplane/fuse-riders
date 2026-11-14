import type { ReactNode } from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { DesktopUiContext } from "../desktop/desktopUiContext";

import type {
  ScreenSaverControls,
  ScreenSaverSnapshot,
} from "./screenSaverContext";
import { ScreenSaverContext } from "./screenSaverContext";
import { ScreenSaverDepsContext } from "./screenSaverDepsContext";
import {
  normalizeScreenSaverPrefs,
  ScreenSaverStoreContext,
} from "./screenSaverStore";

/**
 * One browser-local preference and idle state for the whole desktop. The idle timer re-arms on every
 * activity event; when it fires over a focused game window (whose iframe keeps the input to itself) it
 * re-arms again instead of starting, so a game being played is never covered.
 */
export function ScreenSaverProvider({ children }: { children: ReactNode }) {
  const store = useContext(ScreenSaverStoreContext);
  const desktop = useContext(DesktopUiContext);
  const deps = useContext(ScreenSaverDepsContext);
  const [snapshot, setSnapshot] = useState<ScreenSaverSnapshot>(() => ({
    prefs: store.get(),
    active: false,
  }));
  const shadow = useRef(snapshot);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const publish = useCallback((next: ScreenSaverSnapshot) => {
    shadow.current = next;
    setSnapshot(next);
  }, []);

  const controls = useMemo<ScreenSaverControls>(
    () => ({
      getSnapshot: () => shadow.current,
      configure: (patch) => {
        const current = shadow.current.prefs;
        const prefs = normalizeScreenSaverPrefs({
          ...current,
          ...patch,
          pipes: { ...current.pipes, ...patch.pipes },
        });
        store.set(prefs);
        publish({ prefs, active: false });
      },
      preview: () => {
        if (desktop.shutdownScreen || !deps.isVisible())
          throw new Error(
            "Wake this desktop before starting the screen saver.",
          );
        if (shadow.current.prefs.saver === "none")
          throw new Error("Choose a screen saver before previewing it.");
        publish({ ...shadow.current, active: true });
      },
      stop: () => publish({ ...shadow.current, active: false }),
    }),
    [store, publish, desktop.shutdownScreen, deps],
  );

  useEffect(() => {
    const clear = () => {
      if (timer.current !== undefined) deps.clearTimeout(timer.current);
      timer.current = undefined;
    };
    const arm = () => {
      clear();
      const current = shadow.current;
      if (desktop.shutdownScreen) {
        if (current.active) publish({ ...current, active: false });
        return;
      }
      if (current.active || current.prefs.saver === "none" || !deps.isVisible())
        return;
      timer.current = deps.setTimeout(() => {
        timer.current = undefined;
        if (!deps.isVisible()) return;
        if (deps.isGameFocused()) {
          arm();
          return;
        }
        publish({ ...shadow.current, active: true });
      }, current.prefs.waitMinutes * 60_000);
    };
    const unsubscribe = deps.subscribeActivity((event: Event) => {
      if (shadow.current.active) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        publish({ ...shadow.current, active: false });
      }
      arm();
    });
    arm();
    return () => {
      clear();
      unsubscribe();
    };
  }, [deps, snapshot, publish, desktop.shutdownScreen]);

  return (
    <ScreenSaverContext.Provider value={{ snapshot, controls }}>
      {children}
    </ScreenSaverContext.Provider>
  );
}
