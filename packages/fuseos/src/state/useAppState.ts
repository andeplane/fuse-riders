import { useContext } from "react";

import type { AppStore } from "./appStateContext";
import { AppStateContext } from "./appStateContext";

export function useAppState(): AppStore {
  return useContext(AppStateContext);
}
