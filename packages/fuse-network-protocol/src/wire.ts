/** `welcome.protocol`: a client that reads another value must reload rather than guess at the frames. */
export const ROOM_PROTOCOL_VERSION = 2;
/** Room socket close codes the client acts on. Anything else is a transient drop and is retried. */
export const CLOSE_AUTHORITY_REPLACED = 4001;
export const CLOSE_ROOM_ENDED = 4004;
/** The first frame was missing, late, oversized or not a valid `auth` frame. The client retries, backing off. */
export const CLOSE_UNAUTHENTICATED = 4401;
/** The room has no free seat. Terminal for this page: the client stops retrying and says so; the reason is the service's wording. */
export const CLOSE_ROOM_FULL = 4029;
/** Upper bound on the first (`auth`) frame of a room socket; the real frame is under 100 bytes. */
export const AUTH_FRAME_MAX_BYTES = 256;
/**
 * The first frame of every room socket. A browser cannot set headers on `new WebSocket`, and a URL is recorded by
 * access logs, so the member token travels here and nowhere in the request. See `docs/online/TOKEN-TRANSPORT.md`.
 */
export const authFrame = (token: string): string =>
  JSON.stringify({ type: "auth", token });
