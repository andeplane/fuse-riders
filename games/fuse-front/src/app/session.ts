import type { SafeStorage } from "fuse-ui/safe-storage";

export const GAME_ID = "fuse-front";
/** Storage keys: this browser's name, and its member token per room (the creator's marks it the host). */
export const keys = {
  name: `${GAME_ID}-name`,
  host: (code: string) => `${GAME_ID}-host-${code}`,
  peer: (code: string) => `${GAME_ID}-peer-${code}`,
};

/** Where this page is: the landing page, a solo match, or a room as its creator, a joiner or the shared screen. */
export type Session =
  | { kind: "landing" }
  | { kind: "solo" }
  | { kind: "invalid"; code: string }
  | {
      kind: "room";
      code: string;
      role: "host" | "joiner" | "display";
      token: string;
    };

/**
 * Reads the page's query. Only CREATE ROOM stores a host token, so its presence makes this browser the creator; a
 * joiner keeps one token per room so a refresh is the same member; the shared screen takes a fresh one every load.
 * Nothing about the world is stored: it always comes from the room's peers.
 */
export function sessionFor(
  search: string,
  store: SafeStorage,
  valid: (code: string) => boolean,
  secret: () => string,
): Session {
  const query = new URLSearchParams(search);
  const raw = query.get("room");
  if (raw === null) return { kind: query.has("solo") ? "solo" : "landing" };
  const code = raw.trim().toUpperCase();
  if (!valid(code)) return { kind: "invalid", code };
  if (query.get("display") === "1")
    return { kind: "room", code, role: "display", token: secret() };
  const host = store.getItem(keys.host(code));
  if (host) return { kind: "room", code, role: "host", token: host };
  let token = store.getItem(keys.peer(code));
  if (!token) {
    token = secret();
    store.setItem(keys.peer(code), token);
  }
  return { kind: "room", code, role: "joiner", token };
}

/** A room service refusal, in the words this page shows. */
export function roomFailure(message: string): string {
  if (/unknown game/i.test(message))
    return "Online rooms are not open for Fuse Front on this server yet. Play solo meanwhile.";
  if (/another game/i.test(message))
    return "That code is a room of another game.";
  return message;
}
