export const ROOM_RECONNECT_GRACE_MS = 90_000;
export const ROOM_CODE_SPACE = 26 * 26 * 100;
export const validRoomCode = (code: string): boolean =>
  /^[A-Z]{2}[0-9]{2}$/.test(code);
/** Uniform cryptographic mapping; injectable uint32 source keeps tests deterministic. */
export function generateRoomCode(
  nextUint32: () => number = () =>
    crypto.getRandomValues(new Uint32Array(1))[0]!,
): string {
  const limit = Math.floor(2 ** 32 / ROOM_CODE_SPACE) * ROOM_CODE_SPACE;
  for (let attempt = 0; attempt < 16; attempt++) {
    const value = nextUint32();
    if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** 32)
      throw new Error("Invalid random source");
    if (value >= limit) continue;
    const n = value % ROOM_CODE_SPACE;
    return (
      String.fromCharCode(
        65 + Math.floor(n / 2600),
        65 + (Math.floor(n / 100) % 26),
      ) + String(n % 100).padStart(2, "0")
    );
  }
  throw new Error("Random source rejection limit");
}
/** Reservation must be transactional. False means only a live-code collision; other errors propagate. */
export async function reserveRoomCode(
  reserve: (code: string) => Promise<boolean>,
  nextCode: () => string = generateRoomCode,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = nextCode();
    if (await reserve(code)) return code;
  }
  return undefined;
}
