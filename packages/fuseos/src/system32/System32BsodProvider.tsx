import type { ReactNode } from "react";
import { useContext, useMemo } from "react";

import { useBsod } from "../bsod/bsodContext";

import type { System32Deps } from "./system32Deps";
import { System32DepsContext } from "./system32Deps";
import { System32Provider } from "./System32Provider";

/**
 * `System32Provider` with the desktop's own Blue Screen of Death at the end of the fold: the gag crashes into
 * the same screen Ctrl+Alt+Delete raises, and the fake restart follows the key or click that dismisses it. Deps
 * that already carry a `showBsod` (a test's) keep theirs. Mounted inside `BsodProvider` by `Shell`.
 */
export function System32BsodProvider({ children }: { children: ReactNode }) {
  const deps = useContext(System32DepsContext);
  const { showBsod } = useBsod();
  const wired = useMemo<System32Deps>(
    () => (deps.showBsod ? deps : { ...deps, showBsod }),
    [deps, showBsod],
  );
  return (
    <System32DepsContext.Provider value={wired}>
      <System32Provider>{children}</System32Provider>
    </System32DepsContext.Provider>
  );
}
