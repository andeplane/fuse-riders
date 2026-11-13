import { memberId } from "fuse-netcode";
import { CAPACITY, MAX_NAME, validName } from "./basics.js";

export { MAX_NAME, validName };

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

/** Every seat is drawn as the unit of its slot, so there is one avatar. */
export const AVATAR = "bee";
export const isAvatar = (value: unknown): value is string => value === AVATAR;

/** What the screens call the bot that plays a slot nobody sits in. */
export const BOT_NAMES = ["Vex", "Juno", "Bolt", "Miso", "Pip", "Dot"];
export const botName = (slot: number): string =>
  `${BOT_NAMES[slot % CAPACITY]!} (bot)`;
