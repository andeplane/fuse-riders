import { useContext, useEffect, useRef, useState } from "react";

import type { PipesHandle } from "./pipes/pipes";
import { ScreenSaverContext } from "./screenSaverContext";
import { ScreenSaverDepsContext } from "./screenSaverDepsContext";
import type { PipesPrefs } from "./screenSaverStore";

export const SCREEN_SAVER_LABEL = "3D Pipes screen saver";

/** Covers the whole viewport while the saver is active; any mouse or key wakes the desktop, windows untouched. */
export function ScreenSaverOverlay() {
  const { snapshot, controls } = useContext(ScreenSaverContext);
  return snapshot.active && snapshot.prefs.saver === "pipes" ? (
    <ScreenSaverPlayer pipes={snapshot.prefs.pipes} onWake={controls.stop} />
  ) : null;
}

type PlayerStatus =
  | { kind: "loading" }
  | { kind: "running" }
  | { kind: "failed"; message: string };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ScreenSaverPlayer({
  pipes,
  onWake,
}: {
  pipes: PipesPrefs;
  onWake: () => void;
}) {
  const deps = useContext(ScreenSaverDepsContext);
  const element = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PlayerStatus>({ kind: "loading" });

  useEffect(() => {
    element.current?.focus();
  }, []);

  useEffect(() => {
    const container = stage.current;
    if (!container) return;
    let cancelled = false;
    let handle: PipesHandle | undefined;
    deps
      .loadPipes()
      .then((module) => {
        if (cancelled) return;
        handle = module.startPipes(container, pipes);
        setStatus({ kind: "running" });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setStatus({
            kind: "failed",
            message: `3D Pipes cannot start: ${describe(error)}`,
          });
      });
    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [deps, pipes]);

  const wake = (event: { preventDefault(): void; stopPropagation(): void }) => {
    event.preventDefault();
    event.stopPropagation();
    onWake();
  };

  return (
    <div
      ref={element}
      tabIndex={0}
      role="dialog"
      aria-label={SCREEN_SAVER_LABEL}
      aria-modal="true"
      className="fixed inset-0 z-[1000] cursor-none overflow-hidden bg-black text-white"
      data-testid="screensaver"
      data-status={status.kind}
      onPointerDown={wake}
      onKeyDown={wake}
    >
      <div
        ref={stage}
        className="pointer-events-none absolute inset-0"
        data-testid="screensaver-stage"
      />
      {status.kind === "loading" ? (
        <p
          role="status"
          className="pointer-events-none absolute bottom-4 left-4 opacity-60"
        >
          Loading 3D Pipes...
        </p>
      ) : null}
      {status.kind === "failed" ? (
        <div
          role="alert"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center"
        >
          <p>{status.message}</p>
          <p>Move the mouse or press any key to return.</p>
        </div>
      ) : null}
    </div>
  );
}
