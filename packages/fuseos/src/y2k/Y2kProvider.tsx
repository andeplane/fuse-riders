import type { ReactNode } from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ClockDisplayContext } from "../desktop/clockDisplayContext";
import { useWindowCommands } from "../windows/useWindowCommands";

import { Y2kContext } from "./y2kContext";
import { Y2kDepsContext } from "./y2kDeps";
import { Y2kScheduler } from "./y2kScheduler";
import {
  clockTextAt,
  phaseAt,
  TICK_MS,
  TOTAL_MS,
  Y2K_CLIPPY_LINE,
  Y2K_WARNING_MESSAGE,
  Y2K_WARNING_TITLE,
} from "./y2kSequence";

import "./y2k.css";

type Run = {
  startedAt: number;
  elapsed: number;
  /** The clock text at `elapsed`, computed with the tick so a render is pure. */
  clockText: string | null;
  reducedMotion: boolean;
};

/**
 * Runs the millennium bug: arms the scheduler for local midnight (or plays at once with `?y2k=now`),
 * ticks the sequence on the injected timer, overrides the taskbar clock through ClockDisplayContext,
 * opens the compliance warning and hands Clippy his line. Everything below it sees the phase via Y2kContext.
 */
export function Y2kProvider({ children }: { children: ReactNode }) {
  const deps = useContext(Y2kDepsContext);
  const commands = useWindowCommands();
  const [run, setRun] = useState<Run | null>(null);

  const trigger = useCallback(() => {
    const reducedMotion = deps.prefersReducedMotion();
    setRun({
      startedAt: deps.now(),
      elapsed: 0,
      clockText: clockTextAt(0, { random: deps.random, reducedMotion }),
      reducedMotion,
    });
  }, [deps]);

  // The scheduler sleeps while a run plays and is re-armed for the next midnight once it ends.
  const running = run !== null;
  useEffect(() => {
    if (running) return undefined;
    const scheduler = new Y2kScheduler(deps, trigger);
    scheduler.arm();
    return () => scheduler.stop();
  }, [deps, trigger, running]);

  // The hidden trigger plays once, on mount.
  useEffect(() => {
    if (deps.demoOnBoot) trigger();
  }, []);

  // One tick at a time; each reads the real elapsed time so a throttled tab catches up rather than drifting.
  useEffect(() => {
    if (!run) return undefined;
    const handle = deps.setTimeout(() => {
      setRun((current) => {
        if (!current) return current;
        const elapsed = deps.now() - current.startedAt;
        if (elapsed >= TOTAL_MS) return null;
        return {
          ...current,
          elapsed,
          clockText: clockTextAt(elapsed, {
            random: deps.random,
            reducedMotion: current.reducedMotion,
          }),
        };
      });
    }, TICK_MS);
    return () => deps.clearTimeout(handle);
  }, [run, deps]);

  // Entering the aftermath once per run: the warning box and Clippy's line.
  const phase = run ? phaseAt(run.elapsed) : null;
  const announced = useRef<number | null>(null);
  useEffect(() => {
    if (!run || phase !== "aftermath" || announced.current === run.startedAt)
      return;
    announced.current = run.startedAt;
    commands.showError(Y2K_WARNING_TITLE, Y2K_WARNING_MESSAGE);
    deps.notify(Y2K_CLIPPY_LINE);
  }, [run, phase, commands, deps]);

  const view = useMemo(
    () => ({ phase, reducedMotion: run?.reducedMotion ?? false, trigger }),
    [phase, run?.reducedMotion, trigger],
  );
  const clock = useMemo(
    () =>
      run && run.clockText !== null
        ? {
            text: run.clockText,
            className:
              phase === "glitch" && !run.reducedMotion
                ? "y2k-clock y2k-clock-garbled"
                : "y2k-clock",
          }
        : null,
    [run, phase],
  );

  return (
    <Y2kContext.Provider value={view}>
      <ClockDisplayContext.Provider value={clock}>
        {children}
      </ClockDisplayContext.Provider>
    </Y2kContext.Provider>
  );
}
