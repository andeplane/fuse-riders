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
/** The longest connection id a client offers to resume; the service mints UUIDs, and the `auth` frame stays under its bound. */
export const RESUME_ID_MAX_LENGTH = 64;
/**
 * The first frame of every room socket. A browser cannot set headers on `new WebSocket`, and a URL is recorded by
 * access logs, so the member token travels here and nowhere in the request. See `docs/online/TOKEN-TRANSPORT.md`.
 * `gameId` names the game the page plays; a room of another game refuses it. Absent means `LEGACY_GAME_ID`, which a
 * service from before games ignores, so the frame is compatible in both directions.
 *
 * `resume` is the connection id this page was welcomed with before its socket dropped. A service that still holds
 * that seat welcomes the page back under the same id, so the other members hear nothing and every healthy peer link
 * stays up; any other answer (a service from before resumption ignores the field) is a fresh connection id, and the
 * page rebuilds its links as it always did. See "Resuming a connection" in `docs/online/PROTOCOL.md`.
 */
export const authFrame = (
  token: string,
  gameId?: string,
  resume?: string,
): string =>
  JSON.stringify({
    type: "auth",
    token,
    ...(gameId ? { gameId } : {}),
    ...(resume && resume.length <= RESUME_ID_MAX_LENGTH ? { resume } : {}),
  });
