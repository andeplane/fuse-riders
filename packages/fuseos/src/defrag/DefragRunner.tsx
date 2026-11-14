import { useContext, useEffect, useRef } from "react";

import { useDiskDeps } from "../disk/useDisk";
import { useAppState } from "../state/useAppState";
import { WinampRegistryContext } from "../winamp/winampRegistryContext";

import { DefragDepsContext, DefragSessionsContext } from "./defragDepsContext";
import { hashSeed } from "./defragDisk";
import type { DefragDrive, DefragStage } from "./defragSession";
import { createDefragSession, FALLBACK_FILES } from "./defragSession";

export type DefragRunnerProps = {
  windowId: string;
  /** What the window was opened with; a drive and `stage: "running"` start a run at once. */
  drive?: DefragDrive;
  stage?: DefragStage;
};

/**
 * Keeps one Disk Defragmenter going for as long as its window exists, minimized or not. Renders nothing:
 * it creates the session, feeds it the C: drive's file list, mirrors the stage and percent into the
 * window's state (title bar, taskbar, size) and closes the window when the program quits.
 */
export function DefragRunner({ windowId, drive, stage }: DefragRunnerProps) {
  const deps = useContext(DefragDepsContext);
  const sessions = useContext(DefragSessionsContext);
  const winamp = useContext(WinampRegistryContext);
  const disk = useDiskDeps();
  const { dispatch } = useAppState();
  const initial = useRef(
    stage === "running" && drive !== undefined ? { drive } : {},
  );

  useEffect(() => {
    const session = sessions.acquire(windowId, () =>
      createDefragSession(
        {
          ...deps,
          winampTrack: () => {
            const status = winamp.first()?.status();
            return status?.playing
              ? (status.currentTrack ?? "a song")
              : undefined;
          },
          floppySound: () => {
            void disk.floppySeek().catch(() => undefined);
          },
        },
        initial.current,
      ),
    );
    let cancelled = false;
    disk.source.manifest().then(
      (manifest) => {
        if (!cancelled)
          session.setHardDrive(manifest.files, hashSeed(manifest.sha));
      },
      () => {
        // No manifest (offline, a preview without one): the drive every such PC had.
        if (!cancelled) session.setHardDrive(FALLBACK_FILES, 1998);
      },
    );

    let mirrored = "";
    const sync = () => {
      const snapshot = session.getSnapshot();
      if (snapshot.exited) {
        dispatch({ type: "close", id: windowId });
        return;
      }
      const key = `${snapshot.stage}|${snapshot.drive}|${snapshot.details}|${snapshot.percent}`;
      if (key === mirrored) return;
      mirrored = key;
      dispatch({
        type: "patch",
        id: windowId,
        patch: (window) =>
          window.kind === "defrag"
            ? {
                ...window,
                stage: snapshot.stage,
                drive: snapshot.drive,
                details: snapshot.details,
                percent: snapshot.percent,
              }
            : window,
      });
    };
    const unsubscribe = session.subscribe(sync);
    sync();
    return () => {
      cancelled = true;
      unsubscribe();
      sessions.release(windowId);
    };
  }, [windowId, sessions, deps, winamp, disk, dispatch]);

  return null;
}
