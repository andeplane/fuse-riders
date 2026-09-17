import { AUTH_FRAME_MAX_BYTES } from "fuse-network-protocol";
import { validToken } from "./room-store.js";

/** How long an upgraded socket may stay silent before its first (`auth`) frame. */
export const AUTH_DEADLINE_MS = 5_000;

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
