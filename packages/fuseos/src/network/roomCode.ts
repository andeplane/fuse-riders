/**
 * A room code as the room service issues it (`packages/fuse-network-protocol/src/room-code.ts`):
 * two capital letters then two digits, e.g. "AB42". Mirrored here because the OS package does not
 * depend on the protocol package; the shape has been stable since the service's first release.
 */
export const ROOM_CODE_PATTERN = /^[A-Z]{2}[0-9]{2}$/;

export const ROOM_CODE_LENGTH = 4;

/** What a person typed, as a code: trimmed, upper-cased. Not validated. */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isRoomCode(value: unknown): value is string {
  return typeof value === "string" && ROOM_CODE_PATTERN.test(value);
}

/** The query parameter every Fuse game reads to join a room. */
export const ROOM_PARAM = "room";

/** The game's page URL with the room joined: `<embedUrl>?room=CODE`, keeping any `?mute` the OS added. */
export function roomUrl(embedUrl: string, code: string): string {
  const separator = embedUrl.includes("?") ? "&" : "?";
  return `${embedUrl}${separator}${ROOM_PARAM}=${encodeURIComponent(code)}`;
}

/** The room a page URL names, when it names a valid one; null otherwise. */
export function roomCodeInUrl(search: string): string | null {
  const raw = new URLSearchParams(search).get(ROOM_PARAM);
  if (raw === null) return null;
  const code = normalizeRoomCode(raw);
  return isRoomCode(code) ? code : null;
}
