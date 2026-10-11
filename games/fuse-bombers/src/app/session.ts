/** What `localStorage` offers. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage keys, per game, so two games on one origin never share a room token or a name (as Fuse Choppers keeps them). */
export const keys = (gameId: string) => ({
  name: `${gameId}-player-name`,
  shared: `${gameId}-shared-screen`, // the landing's "Shared TV" choice
  sharedRoom: (code: string) => `${gameId}-shared-${code}`, // what a room was created with
  host: (code: string) => `${gameId}-room-${code}`,
  peer: (code: string) => `${gameId}-peer-${code}`,
});

/** Where this page is: the landing, the local lobby, a match against bots, or a room with this page's member token, as
 * its creator (`host`), a joiner, or the shared TV (`display`, `?display=1`), which never takes a seat. */
export type Session =
  | { kind: "landing" }
  | { kind: "local" }
  | { kind: "solo" }
  | { kind: "invalid"; code: string }
  | {
      kind: "room";
      code: string;
      token: string;
      role: "host" | "joiner" | "display";
    };

/** `?local`, or without a room a debug flag of the local game (main.ts), opens the lobby on this screen. */
const LOCAL_FLAGS = ["local", "seed", "speed", "debug", "touch", "inputdebug"];

/** Options of one load that follow the player from page to page. */
const CARRIED = ["mute", "calm"];

/** `query` (no `?`) for a page of this game opened from the page at `search`: the same, keeping `?mute` and `?calm`
 * as typed (so `?mute=0` stays on). */
export function carry(search: string, query = ""): string {
  const flags = new URLSearchParams(search);
  const kept = CARRIED.filter((flag) => flags.has(flag)).map((flag) => {
    const value = flags.get(flag);
    return value ? `${flag}=${encodeURIComponent(value)}` : flag;
  });
  return [query, ...kept].filter(Boolean).join("&");
}

/** Reads the query. CREATE ROOM stored the creator's token; a joiner keeps one per room, so a reload is the same member;
 * the TV takes a fresh token every load, as it holds no seat (as Fuse Choppers'). */
export function sessionFor(
  search: string,
  store: Store,
  gameId: string,
  valid: (code: string) => boolean,
  secret: () => string,
): Session {
  const query = new URLSearchParams(search);
  const local = LOCAL_FLAGS.some((flag) => query.has(flag));
  if (query.has("local")) return { kind: "local" };
  if (query.get("solo") === "1") return { kind: "solo" };
  const code = query.get("room")?.trim().toUpperCase();
  if (code === undefined) return { kind: local ? "local" : "landing" };
  if (!valid(code)) return { kind: "invalid", code };
  if (query.has("display"))
    return { kind: "room", code, token: secret(), role: "display" };
  const names = keys(gameId);
  const host = store.getItem(names.host(code));
  if (host) return { kind: "room", code, token: host, role: "host" };
  let token = store.getItem(names.peer(code));
  if (!token) store.setItem(names.peer(code), (token = secret()));
  return { kind: "room", code, token, role: "joiner" };
}

/** Storage that never throws: where the browser refuses it (Safari, every cookie blocked), this page's memory. */
export function safeStore(open: () => Store): Store {
  const memory = new Map<string, string>();
  const attempt = <T>(use: (store: Store) => T, fallback: () => T): T => {
    try {
      return use(open());
    } catch {
      return fallback();
    }
  };
  return {
    getItem: (key) =>
      attempt(
        (s) => s.getItem(key),
        () => memory.get(key) ?? null,
      ),
    setItem: (key, value) =>
      attempt(
        (s) => s.setItem(key, value),
        () => void memory.set(key, value),
      ),
  };
}
