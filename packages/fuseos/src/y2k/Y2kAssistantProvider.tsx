import type { ReactNode } from "react";
import { useContext, useMemo } from "react";

import { DesktopUiContext } from "../desktop/desktopUiContext";

import { createAssistantY2kNotifier } from "./assistantNotifier";
import type { Y2kDeps } from "./y2kDeps";
import { Y2kDepsContext } from "./y2kDeps";
import { Y2kProvider } from "./Y2kProvider";

/**
 * `Y2kProvider` with Clippy wired in: the sequence's line goes to whatever notifier the deps carry (a
 * recorder in tests, nothing in the app) and to the Office Assistant, who says it in his balloon.
 */
export function Y2kAssistantProvider({ children }: { children: ReactNode }) {
  const deps = useContext(Y2kDepsContext);
  const { assistantDispatch } = useContext(DesktopUiContext);
  const wired = useMemo<Y2kDeps>(() => {
    const tellAssistant = createAssistantY2kNotifier(assistantDispatch);
    return {
      ...deps,
      notify: (text) => {
        deps.notify(text);
        tellAssistant(text);
      },
    };
  }, [deps, assistantDispatch]);
  return (
    <Y2kDepsContext.Provider value={wired}>
      <Y2kProvider>{children}</Y2kProvider>
    </Y2kDepsContext.Provider>
  );
}
