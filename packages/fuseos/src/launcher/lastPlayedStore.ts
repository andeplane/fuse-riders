/** When each game was last launched from the launcher, by game id (UTC milliseconds). Local to this browser. */
export type LastPlayed = Readonly<Record<string, number>>;

export interface LastPlayedStore {
  get(): LastPlayed;
  /** Records a launch; replaces the game's previous time. */
  record(gameId: string, playedAt: number): void;
}

export const LAST_PLAYED_KEY = "fuseos.launcher.lastPlayed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a stored map; entries that are not finite timestamps are dropped, and anything else means an empty map. */
export function parseLastPlayed(raw: string | null | undefined): LastPlayed {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
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
export class LocalStorageLastPlayedStore implements LastPlayedStore {
  constructor(
    private readonly storage: KeyValueStorage | undefined = safeLocalStorage(),
    private readonly key: string = LAST_PLAYED_KEY,
  ) {}

  get(): LastPlayed {
    try {
      return parseLastPlayed(this.storage?.getItem(this.key));
    } catch {
      return {};
    }
  }

  record(gameId: string, playedAt: number): void {
    try {
      this.storage?.setItem(
        this.key,
        JSON.stringify({ ...this.get(), [gameId]: playedAt }),
      );
    } catch {
      // Storage blocked or full: the launch simply is not remembered.
    }
  }
}

export class MemoryLastPlayedStore implements LastPlayedStore {
  constructor(private played: LastPlayed = {}) {}

  get(): LastPlayed {
    return this.played;
  }

  record(gameId: string, playedAt: number): void {
    this.played = { ...this.played, [gameId]: playedAt };
  }
}
