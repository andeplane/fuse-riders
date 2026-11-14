import {
  AUTH_FRAME_MAX_BYTES,
  RESUME_ID_MAX_LENGTH,
  validGameId,
} from "fuse-network-protocol";
import { validToken } from "./room-store.js";

/**
 * How long an upgraded socket may stay silent before its first (`auth`) frame. The client sends it from its `open`
 * handler, so an honest frame is one round trip behind the 101: 2 s covers a 1.5 s round trip (worse than EDGE) plus
 * half a second of a busy main thread, and a link slower than that cannot play. Missing it costs one charged
 * failure and a backed-off retry, not a lockout. See `docs/online/TOKEN-TRANSPORT.md`.
 */
export const AUTH_DEADLINE_MS = 2_000;
/**
 * How long a refused socket gets to answer the close frame before it is dropped; `ws` would wait 30 s. The echo is
 * one round trip, like the `auth` frame, and gets a second more: cutting a slow client off early can cost it the
 * close code that tells it to stop retrying.
 */
export const REFUSED_CLOSE_GRACE_MS = 3_000;

/** The member token out of a room socket's first frame; undefined for anything but one small, valid `auth` frame. */
export function authToken(raw: string, binary: boolean): string | undefined {
  return readAuthFrame(raw, binary)?.token;
}

/** What a room socket's first frame carries. */
export interface AuthFrame {
  token: string;
  gameId?: string;
  /** The connection id the page was welcomed with before its socket dropped (`RoomStore.admit`). */
  resume?: string;
}
/**
 * A room socket's first frame: the member token and, when the page names them, its game and the connection it would
 * resume. Undefined for anything but one small `auth` frame with a valid token and, if present, a well-formed
 * `gameId` and `resume`.
 */
export function readAuthFrame(
  raw: string,
  binary: boolean,
): AuthFrame | undefined {
  if (binary || Buffer.byteLength(raw) > AUTH_FRAME_MAX_BYTES) return undefined;
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!frame || typeof frame !== "object" || Array.isArray(frame))
    return undefined;
  const { type, token, gameId, resume } = frame as {
    type?: unknown;
    token?: unknown;
    gameId?: unknown;
    resume?: unknown;
  };
  if (type !== "auth" || typeof token !== "string" || !validToken(token))
    return undefined;
  if (gameId !== undefined && !validGameId(gameId)) return undefined;
  if (
    resume !== undefined &&
    !(
      typeof resume === "string" &&
      resume.length > 0 &&
      resume.length <= RESUME_ID_MAX_LENGTH
    )
  )
    return undefined;
  return {
    token,
    ...(gameId === undefined ? {} : { gameId }),
    ...(resume === undefined ? {} : { resume }),
  };
}
