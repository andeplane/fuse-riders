import { memberId } from "fuse-netcode";

/** The account name rule every Fuse game shares: trimmed, 1–18 code points, no control characters or lone surrogates. */
export const MAX_NAME = 18;
const CONTROL = /[\u0000-\u001f\u007f]/;
const LONE_SURROGATE = /\p{Cs}/u;
export function validName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    Array.from(value).length <= MAX_NAME &&
    !CONTROL.test(value) &&
    !LONE_SURROGATE.test(value)
  );
}
/** What a player typed, as it is seated: trimmed and cut to `MAX_NAME` code points, or refused. */
export function seatName(raw: string): string | undefined {
  if (CONTROL.test(raw)) return;
  const name = Array.from(raw.replace(/\p{Cs}/gu, "").trim())
    .slice(0, MAX_NAME)
    .join("")
    .trim();
  return validName(name) ? name : undefined;
}

/** A match id as every replica accepts it: 1–64 printable ASCII characters. */
export const validMatchId = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,64}$/.test(value);

/** A member id that is safe as a record key: never one of `Object.prototype`'s names. */
export const playerKey = (value: unknown): value is string =>
  memberId(value) && !(value in Object.prototype);

export const AVATAR = "train";
export const isAvatar = (value: unknown): value is string => value === AVATAR;

export const BOT_PREFIX = "bot:";
export const BOT_NAMES = [
  "Loco Lola",
  "Steamy Sam",
  "Boxcar Bea",
  "Coal Cole",
  "Whistle Wu",
] as const;
