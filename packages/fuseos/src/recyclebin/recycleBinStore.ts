import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

import type { RecycleBinItem } from "./recycleBinItems";
import { RECYCLE_BIN_ITEMS } from "./recycleBinItems";

/**
 * What the bin remembers per browser: the ids of the pre-installed items that are gone, whether
 * restored or emptied. The catalogue itself is code (recycleBinItems.ts), so a new joke file
 * in a later build shows up without a migration.
 */
export type RecycleBinState = {
  version: 1;
  removed: readonly string[];
};

export const EMPTY_RECYCLE_BIN_STATE: RecycleBinState = {
  version: 1,
  removed: [],
};

export interface RecycleBinStore {
  get(): RecycleBinState;
  set(state: RecycleBinState): void;
  /** Calls back after every `set`; returns an unsubscribe. Lets the desktop icon and the window share one bin. */
  subscribe(listener: () => void): () => void;
}

export const RECYCLE_BIN_KEY = "fuseos.recyclebin";

export function isRecycleBinState(value: unknown): value is RecycleBinState {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    record.version === 1 &&
    Array.isArray(record.removed) &&
    record.removed.every((id) => typeof id === "string")
  );
}

/** Parses a stored state; anything unexpected (an old shape, a corrupt entry) means a full bin. */
export function parseRecycleBinState(
  raw: string | null | undefined,
): RecycleBinState {
  if (!raw) return EMPTY_RECYCLE_BIN_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecycleBinState(parsed)
      ? { version: 1, removed: [...new Set(parsed.removed)] }
      : EMPTY_RECYCLE_BIN_STATE;
  } catch {
    return EMPTY_RECYCLE_BIN_STATE;
  }
}

/** The items still in the bin, in catalogue order. */
export function binContents(
  state: RecycleBinState,
  catalogue: readonly RecycleBinItem[] = RECYCLE_BIN_ITEMS,
): RecycleBinItem[] {
  const removed = new Set(state.removed);
  return catalogue.filter((item) => !removed.has(item.id));
}

/** The state after the given items leave the bin (restored or deleted for good). */
export function withoutItems(
  state: RecycleBinState,
  ids: readonly string[],
): RecycleBinState {
  return { version: 1, removed: [...new Set([...state.removed, ...ids])] };
}

abstract class ObservableRecycleBinStore implements RecycleBinStore {
  private readonly listeners = new Set<() => void>();

  abstract get(): RecycleBinState;
  protected abstract write(state: RecycleBinState): void;

  set(state: RecycleBinState): void {
    this.write(state);
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function safeLocalStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** localStorage backed; every access is guarded because storage can be unavailable. */
export class LocalStorageRecycleBinStore extends ObservableRecycleBinStore {
  private cached: RecycleBinState | undefined;

  constructor(
    private readonly storage: KeyValueStorage | undefined = safeLocalStorage(),
  ) {
    super();
  }

  get(): RecycleBinState {
    if (this.cached) return this.cached;
    try {
      this.cached = parseRecycleBinState(
        this.storage?.getItem(RECYCLE_BIN_KEY),
      );
    } catch {
      this.cached = EMPTY_RECYCLE_BIN_STATE;
    }
    return this.cached;
  }

  protected write(state: RecycleBinState): void {
    this.cached = state;
    try {
      this.storage?.setItem(RECYCLE_BIN_KEY, JSON.stringify(state));
    } catch {
      // Storage blocked or full: the bin refills on the next visit.
    }
  }
}

export class MemoryRecycleBinStore extends ObservableRecycleBinStore {
  constructor(private state: RecycleBinState = EMPTY_RECYCLE_BIN_STATE) {
    super();
  }

  get(): RecycleBinState {
    return this.state;
  }

  protected write(state: RecycleBinState): void {
    this.state = state;
  }
}

export const RecycleBinStoreContext = createContext<RecycleBinStore>(
  new LocalStorageRecycleBinStore(),
);

/** The bin's current state, re-rendering on every change from any window. */
export function useRecycleBinState(): RecycleBinState {
  const store = useContext(RecycleBinStoreContext);
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  return useSyncExternalStore(subscribe, () => store.get());
}
