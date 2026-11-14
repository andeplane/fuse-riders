/**
 * Choosing a role in a solo room.
 *
 * `fuse-netcode` opens a solo room already playing: it seats this device in the first slot and starts a match on the
 * first frame, so a player who asked for bots never saw the six slots and was always the Cyan Queen. Killer Fuse
 * wants the choice a room gives: the page sends that first match back to the lobby, takes the slot this device chose
 * last, and then leaves the player alone with the ordinary room layout — tap a slot to take it, START to play.
 *
 * This lives in the game's own files, built on commands the page already sends (`lobby`, `seat`), so no shared
 * menu or room-layout code has to know about it.
 */
import { CAPACITY } from "../online/index.js";
import { isQueenSlot } from "../engine/index.js";

/** What the page must do before the player chooses; "none" means the page stops steering for good. */
export type SoloSetup = "lobby" | "seat" | "none";

/** The part of the room this decision reads. */
export interface SoloRoom {
  stage: "lobby" | "running" | "between" | "over";
  /** The slot this device holds, or -1. */
  slot: number;
}

/**
 * How far the page has got with the opening. It is carried frame to frame rather than latched inside, so a command
 * that does not land is simply asked for again on the next frame, and a bounded number of tries ends it either way.
 */
export interface SoloSteer {
  /** The player is in charge now: the page never steers a solo room again. */
  done: boolean;
  /** Frames spent steering, so a seat the room will not give cannot hold the player in the lobby forever. */
  tries: number;
}
export const FRESH_STEER: SoloSteer = { done: false, tries: 0 };
const DONE: SoloSteer = { done: true, tries: 0 };
/** About three seconds of frames: long enough for the room to settle, short enough never to trap anyone. */
export const SOLO_SETUP_TRIES = 180;

export function soloSetup(
  room: SoloRoom,
  remembered: number | undefined,
  steer: SoloSteer,
): { action: SoloSetup; steer: SoloSteer } {
  if (steer.done) return { action: "none", steer };
  if (steer.tries >= SOLO_SETUP_TRIES) return { action: "none", steer: DONE };
  const tries = steer.tries + 1;
  // The room opened mid-match: back to the lobby, where the six slots are.
  if (room.stage !== "lobby")
    return { action: "lobby", steer: { done: false, tries } };
  // In the lobby: take the slot this device played last, then hand the room over.
  if (remembered !== undefined && remembered !== room.slot)
    return { action: "seat", steer: { done: false, tries } };
  return { action: "none", steer: DONE };
}

/** The last role chosen on this device, so a solo player who likes a Worker is not put back on the Queen. */
export const SOLO_SLOT_KEY = "killer-fuse-solo-slot";
export interface SlotStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const isSoloSlot = (slot: number): boolean =>
  Number.isInteger(slot) && slot >= 0 && slot < CAPACITY;
export function readSoloSlot(store: SlotStore): number | undefined {
  // `Number(null)` and `Number("")` are both 0, which is a real slot: nothing stored must not read as the Queen.
  const raw = store.getItem(SOLO_SLOT_KEY);
  if (raw === null || raw.trim() === "") return undefined;
  const slot = Number(raw);
  return isSoloSlot(slot) ? slot : undefined;
}
/** Records a slot the player actually asked for; anything else is not a choice and is not written. */
export function writeSoloSlot(store: SlotStore, slot: number): void {
  if (isSoloSlot(slot)) store.setItem(SOLO_SLOT_KEY, String(slot));
}

/**
 * What a role does, in the few words a slot's own label has room for: the slot is where the choice is made, so it
 * cannot say only "Queen" and leave the rest to a panel the player has not opened.
 */
export const QUEEN_HINT = "flies, fights";
export const WORKER_HINT = "berries, snail, gates";
export const roleHint = (slot: number): string =>
  isQueenSlot(slot) ? QUEEN_HINT : WORKER_HINT;
/**
 * The fuller lines beside the slots. The Queen's says what she cannot do, because the three ways to win promise a
 * berry hive and a snail ride to everyone who reads them, and only a Worker can take either.
 */
export const ROLE_LEGEND: readonly string[] = [
  "QUEEN (slots 1 and 2) fights and flies, and cannot carry berries or ride the snail.",
  "WORKER (slots 3 to 6) carries berries, rides the snail and takes gates to become a Warrior.",
];
