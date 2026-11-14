import { useEffect, useState } from "react";

export type BootHoldDeps = {
  setTimeout: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
};

const defaultDeps: BootHoldDeps = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

/** Keeps the boot screen up for at least `minimumMs`, so the animation is seen even on fast hosts. */
export function useBootHold(
  minimumMs: number,
  deps: BootHoldDeps = defaultDeps,
): boolean {
  const [held, setHeld] = useState(minimumMs > 0);
  useEffect(() => {
    if (minimumMs <= 0) return undefined;
    const handle = deps.setTimeout(() => setHeld(false), minimumMs);
    return () => deps.clearTimeout(handle);
  }, [minimumMs, deps]);
  return held;
}
