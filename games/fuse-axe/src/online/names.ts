import { memberId } from "fuse-netcode";
import { HERO_KINDS, type HeroKind } from "../engine/index.js";

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

/**
 * A seat's avatar is the hero it plays: a member names one with its join (the netcode's `avatarId`) and may change it
 * with a `HERO` entry outside a run. Duplicates are allowed.
 */
export const isHero = (value: unknown): value is HeroKind =>
  (HERO_KINDS as readonly unknown[]).includes(value);
export const DEFAULT_HERO: HeroKind = "brakka";
/** What a bot's seat records in place of a hero: a bot plays its seat's hero (`seatHero`). */
export const BOT_AVATAR = "bot";
/** The hero each seat brings when nobody chooses: Brakka, Rhea, Gorm, Brakka, Rhea. */
export const seatHero = (slot: number): HeroKind =>
  HERO_KINDS[slot % HERO_KINDS.length]!;

export const BOT_PREFIX = "bot:";
export const BOT_NAMES = [
  "Ironhide",
  "Ashwyn",
  "Bramble",
  "Korrin",
  "Sable",
] as const;
