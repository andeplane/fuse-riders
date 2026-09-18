import { AUTH_FRAME_MAX_BYTES } from "fuse-network-protocol";
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
  if (binary || Buffer.byteLength(raw) > AUTH_FRAME_MAX_BYTES) return undefined;
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!frame || typeof frame !== "object" || Array.isArray(frame))
    return undefined;
  const { type, token } = frame as { type?: unknown; token?: unknown };
  return type === "auth" && typeof token === "string" && validToken(token)
    ? token
    : undefined;
}
