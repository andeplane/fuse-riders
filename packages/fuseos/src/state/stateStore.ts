import type { AppState } from "./appState";
import { DEFAULT_STATE, parseAppState, serializeAppState } from "./appState";

/** Where the desktop's windows live between visits. The provider debounces `save`; a store writes what it is given. */
export interface StateStore {
  load(): AppState;
  save(state: AppState): void;
}

/** `localStorage` key; the `v1` is the `AppState.version` the payload carries, so a later shape can migrate or ignore it. */
export const STATE_KEY = "fuseos.state.v1";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function safeLocalStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** localStorage backed; every access is guarded because storage can be unavailable (private mode, a blocked origin). */
export class LocalStorageStateStore implements StateStore {
  constructor(
    private readonly storage: KeyValueStorage | undefined = safeLocalStorage(),
    private readonly key: string = STATE_KEY,
  ) {}

  load(): AppState {
    try {
      return parseAppState(this.storage?.getItem(this.key));
    } catch {
      return DEFAULT_STATE;
    }
  }

  save(state: AppState): void {
    try {
      this.storage?.setItem(this.key, serializeAppState(state));
    } catch {
      // Storage blocked or full: the windows simply are not remembered.
    }
  }
}

/** In-memory store for tests and for a desktop that must not persist. `saved` counts the writes. */
export class MemoryStateStore implements StateStore {
  saved = 0;
  constructor(private state: AppState = DEFAULT_STATE) {}

  load(): AppState {
    return this.state;
  }

  save(state: AppState): void {
    this.saved += 1;
    this.state = parseAppState(serializeAppState(state));
  }
}
