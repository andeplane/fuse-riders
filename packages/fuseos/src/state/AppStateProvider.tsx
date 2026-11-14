import type { ReactNode } from "react";
import { useContext, useEffect, useMemo, useReducer, useRef } from "react";

import type { AppState, WindowContent } from "./appState";
import { appStateReducer, serializeAppState } from "./appState";
import { AppStateContext, AppStateDepsContext } from "./appStateContext";
import type { StateStore } from "./stateStore";

type AppStateProviderProps = {
  store: StateStore;
  /** Windows a deep link (`?open=`) asks for, opened on top of the stored ones before the first render. */
  initialOpen?: readonly WindowContent[];
  children: ReactNode;
};

/** The stored state plus the deep link's windows, in one pass so nothing flashes. */
function initialState(
  store: StateStore,
  initialOpen: readonly WindowContent[],
): AppState {
  return initialOpen.reduce(
    (state, content) => appStateReducer(state, { type: "open", content }),
    store.load(),
  );
}

/**
 * The one window store. Seeds from the store (localStorage in production) and writes every change back,
 * debounced, so a reload restores the same windows.
 */
export function AppStateProvider({
  store,
  initialOpen = [],
  children,
}: AppStateProviderProps) {
  const deps = useContext(AppStateDepsContext);
  const [state, dispatch] = useReducer(appStateReducer, undefined, () =>
    initialState(store, initialOpen),
  );
  const lastSaved = useRef<string | undefined>(undefined);

  useEffect(() => {
    const serialized = serializeAppState(state);
    if (serialized === lastSaved.current) return undefined;
    const handle = deps.setTimeout(() => {
      lastSaved.current = serialized;
      store.save(state);
    }, deps.syncDelayMs);
    return () => deps.clearTimeout(handle);
  }, [store, state, deps]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}
