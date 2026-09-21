import { validRoomCode } from "fuse-network-fe";

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const NAME_KEY = "ball-bros-name";
const hostKey = (code: string) => `ball-bros-host-${code}`;
const peerKey = (code: string) => `ball-bros-peer-${code}`;
export type Session =
  | { kind: "landing" | "solo" | "invalid" }
  | {
      kind: "room";
      code: string;
      token: string;
      display: boolean;
      shared: boolean;
    };
/** Only identities/preferences are stored. The world always comes from live peers. */
export function session(
  search: string,
  store: Store,
  secret: () => string,
): Session {
  const q = new URLSearchParams(search);
  const raw = q.get("room");
  if (raw === null) return { kind: q.has("solo") ? "solo" : "landing" };
  const code = raw.trim().toUpperCase();
  if (!validRoomCode(code)) return { kind: "invalid" };
  const display = q.get("display") === "1";
  let token = display
    ? secret()
    : (store.getItem(hostKey(code)) ?? store.getItem(peerKey(code)));
  if (!token) {
    token = secret();
    store.setItem(peerKey(code), token);
  }
  return {
    kind: "room",
    code,
    token,
    display,
    shared: store.getItem(`ball-bros-shared-${code}`) === "1",
  };
}
export function rememberRoom(
  store: Store,
  code: string,
  token: string,
  shared: boolean,
): void {
  store.setItem(hostKey(code), token);
  store.setItem(`ball-bros-shared-${code}`, shared ? "1" : "0");
}
export function safeStore(open: () => Store): Store {
  const memory = new Map<string, string>();
  let backing: Store | undefined;
  try {
    backing = open();
  } catch {
    /* private browsing */
  }
  return {
    getItem(key) {
      if (memory.has(key)) return memory.get(key)!;
      try {
        return backing?.getItem(key) ?? memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      memory.set(key, value);
      try {
        backing?.setItem(key, value);
      } catch {
        /* page-local identity remains usable */
      }
    },
  };
}
export function roomFailure(text: string): string {
  if (/unknown game/i.test(text))
    return "Online rooms are not open for Ball Bros on this server yet. You can still play solo.";
  if (/another game/i.test(text))
    return "That room belongs to another game. Check the Ball Bros invite.";
  return text;
}
