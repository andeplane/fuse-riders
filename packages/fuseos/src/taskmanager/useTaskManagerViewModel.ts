import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { windowMeta } from "../desktop/windowMeta";
import { FuseGamesContext } from "../fusegames/registry";
import type { WindowKind, WindowState } from "../state/appState";
import { useAppState } from "../state/useAppState";
import type { IconName } from "../ui/icons";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { TaskStatus } from "./frameSampler";
import { FrameSampler, History } from "./frameSampler";
import type { HeapSample } from "./taskManagerDeps";
import { TaskManagerDepsContext } from "./taskManagerDeps";

/** Columns on a Performance graph: one sample per tick, so a minute of history at the default tick. */
export const HISTORY_LENGTH = 60;

export type TaskRow = {
  id: string;
  title: string;
  icon: IconName;
  kind: WindowKind;
  status: TaskStatus;
  /** Frames per second of the page inside the window; absent for windows that are not iframes. */
  fps?: number;
};

export type FrameSeries = {
  id: string;
  title: string;
  fps: number;
  history: readonly number[];
};

export type TaskManagerSnapshot = {
  rows: TaskRow[];
  /** The desktop first, then every window whose page reports frames. */
  frames: FrameSeries[];
  heap: HeapSample | undefined;
  heapHistory: readonly number[];
};

export const DESKTOP_SERIES_ID = "desktop";

type Tracked = { sampler: FrameSampler; history: History };

export type TaskManagerViewModel = {
  snapshot: TaskManagerSnapshot;
  selectedId: string | null;
  select: (id: string | null) => void;
  /** Closes the selected window, whatever its page is doing. */
  endTask: () => void;
  /** Brings the selected window to the front, restoring it when minimized. */
  switchTo: () => void;
};

/**
 * Samples every open window once per tick: the page inside an iframe gets a frame sampler
 * on its own `requestAnimationFrame`, so a game that stops painting shows "Not Responding"
 * without the Task Manager itself stalling. Windows drawn by the desktop (Paint, Control
 * Panel) run on the desktop's frames and are always "Running" while this hook can run at all.
 */
export function useTaskManagerViewModel(): TaskManagerViewModel {
  const { state } = useAppState();
  const games = useContext(FuseGamesContext);
  const deps = useContext(TaskManagerDepsContext);
  const commands = useWindowCommands();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [samples, setSamples] = useState<{
    statuses: ReadonlyMap<string, TaskStatus>;
    frames: Map<string, { fps: number; history: readonly number[] }>;
    heap: HeapSample | undefined;
    heapHistory: readonly number[];
  }>({
    statuses: new Map(),
    frames: new Map(),
    heap: undefined,
    heapHistory: [],
  });

  const windowsRef = useRef<readonly WindowState[]>(state.windows);
  windowsRef.current = state.windows;

  useEffect(() => {
    const tracked = new Map<string, Tracked>();
    const desktop: Tracked = {
      sampler: new FrameSampler(deps.desktopFrame, deps.now),
      history: new History(HISTORY_LENGTH),
    };
    const heapHistory = new History(HISTORY_LENGTH);

    const tick = () => {
      const statuses = new Map<string, TaskStatus>();
      const frames = new Map<
        string,
        { fps: number; history: readonly number[] }
      >();
      const desktopSample = desktop.sampler.sample();
      desktop.history.push(desktopSample.fps);
      frames.set(DESKTOP_SERIES_ID, {
        fps: desktopSample.fps,
        history: desktop.history.toArray(),
      });

      const open = new Set(windowsRef.current.map((window) => window.id));
      for (const [id, entry] of tracked) {
        if (!open.has(id)) {
          entry.sampler.dispose();
          tracked.delete(id);
        }
      }
      for (const window of windowsRef.current) {
        const frame = deps.frameWindowFor(window.id);
        let entry = tracked.get(window.id);
        if (entry && (!frame || entry.sampler.frame !== frame)) {
          entry.sampler.dispose();
          tracked.delete(window.id);
          entry = undefined;
        }
        if (!frame) {
          statuses.set(window.id, "running");
          continue;
        }
        if (!entry) {
          // A page found on this tick starts counting now and reports from the next one.
          tracked.set(window.id, {
            sampler: new FrameSampler(frame, deps.now),
            history: new History(HISTORY_LENGTH),
          });
          statuses.set(window.id, "running");
          continue;
        }
        const sample = entry.sampler.sample();
        entry.history.push(sample.fps);
        statuses.set(window.id, sample.status);
        frames.set(window.id, {
          fps: sample.fps,
          history: entry.history.toArray(),
        });
      }

      const heap = deps.heap();
      if (heap) heapHistory.push(heap.usedBytes);
      setSamples({
        statuses,
        frames,
        heap,
        heapHistory: heapHistory.toArray(),
      });
    };

    const unsubscribe = deps.subscribeTicks(tick);
    return () => {
      unsubscribe();
      desktop.sampler.dispose();
      for (const entry of tracked.values()) entry.sampler.dispose();
    };
  }, [deps]);

  const rows: TaskRow[] = state.windows.map((window) => {
    const meta = windowMeta(window, games);
    const frame = samples.frames.get(window.id);
    return {
      id: window.id,
      title: meta.title,
      icon: meta.icon,
      kind: window.kind,
      status: samples.statuses.get(window.id) ?? "running",
      ...(frame ? { fps: frame.fps } : {}),
    };
  });

  const desktopSeries = samples.frames.get(DESKTOP_SERIES_ID);
  const frames: FrameSeries[] = [
    {
      id: DESKTOP_SERIES_ID,
      title: "Desktop",
      fps: desktopSeries?.fps ?? 0,
      history: desktopSeries?.history ?? [],
    },
    ...rows.flatMap((row) => {
      const series = samples.frames.get(row.id);
      return series
        ? [
            {
              id: row.id,
              title: row.title,
              fps: series.fps,
              history: series.history,
            },
          ]
        : [];
    }),
  ];

  const selected =
    selectedId !== null &&
    state.windows.some((window) => window.id === selectedId)
      ? selectedId
      : null;

  const endTask = useCallback(() => {
    if (selected !== null) commands.close(selected);
  }, [commands, selected]);
  const switchTo = useCallback(() => {
    if (selected !== null) commands.focus(selected);
  }, [commands, selected]);

  return {
    snapshot: {
      rows,
      frames,
      heap: samples.heap,
      heapHistory: samples.heapHistory,
    },
    selectedId: selected,
    select: setSelectedId,
    endTask,
    switchTo,
  };
}
