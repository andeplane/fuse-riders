import { memberId } from "fuse-netcode";
import { AVATAR_ATLAS } from "fuse-ui/assets";
import { MAX_NAME, validName } from "../basics.js";

const CONTROL = /[\u0000-\u001f\u007f]/;
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

/** What a seat without a chosen portrait is drawn as; a bot's too. */
export const AVATAR = "robot";
export const isAvatar = (value: unknown): value is string =>
  AVATAR_ATLAS.frames.some((id) => id === value);

/** A bot's seat name, by the slot it takes. */
export const BOT_NAMES = [
  "Fizz",
  "Volta",
  "Spark",
  "Ohm",
  "Flux",
  "Zap",
] as const;
