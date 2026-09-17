import { authFrame } from "fuse-network-protocol";

/** The credentials of a new room. The token is the creator's identity: keep it on the creator's device and out of invites. */
export interface CreatedRoom {
  code: string;
  token: string;
}
/** A member's own identity for a room it did not create: 32 random bytes, hex. */
export function memberToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function failure(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => undefined)) as
    { error?: unknown } | undefined;
  return new Error(typeof body?.error === "string" ? body.error : fallback);
}
export async function createRoom(
  apiUrl: (path: string) => string,
  fetcher: typeof fetch = fetch,
): Promise<CreatedRoom> {
  const response = await fetcher(apiUrl("/api/rooms"), { method: "POST" });
  if (!response.ok) throw await failure(response, "Could not create room");
  const body = (await response.json()) as Partial<CreatedRoom>;
  if (typeof body.code !== "string" || typeof body.token !== "string")
    throw new Error("Could not create room");
  return { code: body.code, token: body.token };
}
/** Creator only: the room closes for every member and the code is never retried. `init` carries an abort signal or `keepalive` for a page that is leaving. */
export async function endRoom(
  apiUrl: (path: string) => string,
  code: string,
  token: string,
  init: Pick<RequestInit, "signal" | "keepalive"> = {},
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(apiUrl(`/api/rooms/${code}/end`), {
    ...init,
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await failure(response, "Could not end room");
}
/** Members only. The token is a bearer header, never part of the URL: request URLs are recorded by access logs. */
export async function fetchIceServers(
  apiUrl: (path: string) => string,
  code: string,
  token: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetcher(apiUrl(`/api/rooms/${code}/ice`), {
    signal,
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}
/** What `openRoomSocket` needs of a WebSocket; a browser `WebSocket` satisfies it. */
export interface RoomSocket {
  addEventListener(
    type: "open",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  send(data: string): void;
}
/** The room socket address. It names the room and nothing else: no token, no query. */
export function roomSocketUrl(
  apiUrl: (path: string) => string,
  code: string,
): string {
  const url = new URL(apiUrl(`/api/rooms/${code}/ws`));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
/**
 * Opens the room socket and authenticates it with its first frame. A browser cannot put a header on a WebSocket and
 * a URL is logged, so the token is sent as `{type:"auth",token}` once the socket opens; the service reads nothing
 * else first and closes a socket that stays silent. See `docs/online/TOKEN-TRANSPORT.md`.
 */
export function openRoomSocket<S extends RoomSocket>(
  apiUrl: (path: string) => string,
  code: string,
  token: string,
  create: (url: string) => S,
): S {
  const socket = create(roomSocketUrl(apiUrl, code));
  socket.addEventListener("open", () => socket.send(authFrame(token)), {
    once: true,
  });
  return socket;
}
