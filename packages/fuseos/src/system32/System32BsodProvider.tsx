import type { ReactNode } from "react";
import { useContext, useMemo } from "react";

import { useDesktopBsod } from "./desktopBsod";
import type { System32Deps } from "./system32Deps";
import { System32DepsContext } from "./system32Deps";
import { System32Provider } from "./System32Provider";

/**
 * `System32Provider` with the desktop's own Blue Screen of Death at the end of the fold, where the build has
 * one (`desktopBsod.ts`): the gag crashes into the same screen Ctrl+Alt+Delete raises. Without it, or with
 * deps that already carry a `showBsod` (a test's), the gag keeps its own. Mounted by `Shell`.
 */
export function System32BsodProvider({ children }: { children: ReactNode }) {
  const deps = useContext(System32DepsContext);
  const showBsod = useDesktopBsod();
  const wired = useMemo<System32Deps>(
    () => (deps.showBsod || !showBsod ? deps : { ...deps, showBsod }),
    [deps, showBsod],
  );
  return (
    <System32DepsContext.Provider value={wired}>
      <System32Provider>{children}</System32Provider>
    </System32DepsContext.Provider>
  );
}
