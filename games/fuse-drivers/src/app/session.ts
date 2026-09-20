/** What `localStorage` offers, or a stand-in when the browser refuses it (Safari with every cookie blocked). */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Storage keys, per game, so two games on one origin never share a room token or a name. */
export const keys = (gameId: string) => ({
  name: `${gameId}-player-name`,
  shared: `${gameId}-shared-screen`,
  host: (code: string) => `${gameId}-room-${code}`,
  peer: (code: string) => `${gameId}-peer-${code}`,
});

/** Where this page is: the landing page, a solo match, or a room as its creator, a joiner or the shared screen. */
export type Session =
  | { kind: "landing" }
  | { kind: "solo" }
  | { kind: "invalid"; code: string }
  | {
      kind: "room";
      code: string;
      role: "host" | "joiner" | "display";
      /** The member token this page connects with: the creator's, this browser's for the room, or a fresh one. */
      token: string;
    };

/**
 * Reads the page's query. The creator's token is stored only by CREATE ROOM, so its presence makes this browser the
 * room's creator; a joiner keeps one token per room so a refresh is the same member; the shared screen takes a fresh
 * token every load, since it holds no seat.
 */
export function sessionFor(
  search: string,
  store: Store,
  gameId: string,
  valid: (code: string) => boolean,
  secret: () => string,
): Session {
  const query = new URLSearchParams(search);
  if (query.get("solo") === "1") return { kind: "solo" };
  const raw = query.get("room");
  if (raw === null) return { kind: "landing" };
  const code = raw.trim().toUpperCase();
  if (!valid(code)) return { kind: "invalid", code };
  const names = keys(gameId);
  if (query.has("display"))
    return { kind: "room", code, role: "display", token: secret() };
  const host = store.getItem(names.host(code));
  if (host) return { kind: "room", code, role: "host", token: host };
  let token = store.getItem(names.peer(code));
  if (!token) {
    token = secret();
    store.setItem(names.peer(code), token);
  }
  return { kind: "room", code, role: "joiner", token };
}

/** Storage that never throws: a browser that refuses it gets an in-memory map for this page's life. */
export function safeStore(open: () => Storage): Store {
  const memory = new Map<string, string>();
  let backing: Storage | undefined;
  try {
    backing = open();
    backing.getItem("probe");
  } catch {
    backing = undefined;
  }
  const attempt = <T>(use: (storage: Storage) => T, fallback: () => T): T => {
    if (!backing) return fallback();
    try {
      return use(backing);
    } catch {
      return fallback();
    }
  };
  return {
    getItem: (key) =>
      attempt(
        (storage) => storage.getItem(key),
        () => memory.get(key) ?? null,
      ),
    setItem: (key, value) =>
      attempt(
        (storage) => storage.setItem(key, value),
        () => void memory.set(key, value),
      ),
    removeItem: (key) =>
      attempt(
        (storage) => storage.removeItem(key),
        () => void memory.delete(key),
      ),
  };
}

/** What a player is told when the room service does not host this game yet (a production service before launch). */
export const NOT_OPEN =
  "Online rooms are not open yet for this game. Play solo against bots meanwhile.";
/** A room service refusal, in the words this page shows. */
export function roomFailure(message: string): string {
  if (/unknown game/i.test(message)) return NOT_OPEN;
  if (/another game/i.test(message))
    return "That code is a room of another game";
  return message;
}
