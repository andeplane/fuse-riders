import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopArea } from "../../desktop/displayModes";

import type { DisplayEffectsDeps, TimerHandle } from "./effectsDeps";
import { KEEP_SETTINGS_SECONDS } from "./resolutionEmulation";

export type PendingResolution = {
  /** The resolution to go back to if the new one is not kept. */
  previous: DesktopArea;
  secondsLeft: number;
};

export type ResolutionRevert = {
  pending: PendingResolution | null;
  keep: () => void;
  revert: () => void;
};

/**
 * The classic "Keep these settings?" countdown: whenever the resolution changes, from wherever
 * (the Effects tab, or the legacy Desktop area select), it is applied at once and the previous
 * one comes back after `KEEP_SETTINGS_SECONDS` unless kept. A further change while the dialog
 * is up restarts the clock but still reverts to the resolution in force before the first change.
 */
export function useResolutionRevert(
  area: DesktopArea,
  setArea: (area: DesktopArea) => void,
  timers: Pick<DisplayEffectsDeps, "setTimeout" | "clearTimeout">,
): ResolutionRevert {
  const [pending, setPendingState] = useState<PendingResolution | null>(null);
  // Mirrors `pending` for the timer chain, which runs outside React's render cycle.
  const pendingRef = useRef<PendingResolution | null>(null);
  const setPending = useCallback((next: PendingResolution | null) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);
  // Bumped whenever a countdown (re)starts; the timer chain is keyed on it.
  const [session, setSession] = useState(0);
  const handle = useRef<TimerHandle | undefined>(undefined);
  const lastArea = useRef(area);
  const reverting = useRef(false);

  const stop = useCallback(() => {
    if (handle.current !== undefined) timers.clearTimeout(handle.current);
    handle.current = undefined;
  }, [timers]);

  useEffect(() => {
    if (area === lastArea.current) return;
    const previous = lastArea.current;
    lastArea.current = area;
    if (reverting.current) {
      reverting.current = false;
      return;
    }
    setPending({
      previous: pendingRef.current?.previous ?? previous,
      secondsLeft: KEEP_SETTINGS_SECONDS,
    });
    setSession((current) => current + 1);
  }, [area, setPending]);

  const keep = useCallback(() => {
    stop();
    setPending(null);
  }, [stop, setPending]);

  const revert = useCallback(() => {
    const current = pendingRef.current;
    if (!current) return;
    stop();
    setPending(null);
    if (current.previous === area) return;
    reverting.current = true;
    setArea(current.previous);
  }, [stop, setPending, area, setArea]);

  const revertRef = useRef(revert);
  revertRef.current = revert;

  useEffect(() => {
    if (session === 0) return;
    const tick = () => {
      const current = pendingRef.current;
      if (!current) return;
      if (current.secondsLeft > 1) {
        setPending({ ...current, secondsLeft: current.secondsLeft - 1 });
        handle.current = timers.setTimeout(tick, 1000);
      } else revertRef.current();
    };
    handle.current = timers.setTimeout(tick, 1000);
    return stop;
  }, [session, timers, setPending, stop]);

  return { pending, keep, revert };
}
