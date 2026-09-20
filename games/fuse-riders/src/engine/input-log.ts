import { isAvatarId, type AvatarId } from "../shared/avatars.js";
import { parseRoomSettings, type RoomSettings } from "./room-settings.js";
import type { BombActionCommand } from "./primitives.js";
import {
  cancelGesture,
  pressGesture,
  releaseGesture,
  type GestureControls,
} from "./bomb-gesture.js";
import type { InputIntent } from "./state.js";
import { loggedRiderName } from "./rider-name.js";
import { RIDER_COLORS } from "./tuning.js";

/**
 * Entry kinds. Player kinds come from any member's own stream; management kinds only from the creator's.
 * Kind 1 carried Target Bomb aim and is retired: it is refused like any unknown kind, and the number stays unused.
 */
export const STEER = 0,
  PRESS = 2,
  RELEASE = 3,
  CANCEL = 4,
  AVATAR = 5,
  READY = 6,
  COLOR = 7;
export const JOIN = 10,
  LEAVE = 11,
  PRESENCE = 12,
  SETTINGS = 13,
  ACTION = 14,
  BOT = 15,
  SPECTATOR = 16;
export const UINT32_MAX = 0xffff_ffff;
export type RoomAction = "start" | "rematch" | "lobby";
export type Entry =
  | [seq: number, tick: number, kind: 0, flags: number]
  | [seq: number, tick: number, kind: 2, gesture: number]
  | [seq: number, tick: number, kind: 3, gesture: number]
  | [seq: number, tick: number, kind: 4, gesture: number]
  | [seq: number, tick: number, kind: 5, avatarId: AvatarId]
  | [
      seq: number,
      tick: number,
      kind: 6,
      ready: boolean,
      matchId: string,
      phase: "lobby" | "matchOver",
    ]
  | [seq: number, tick: number, kind: 7, colorIndex: number]
  | [
      seq: number,
      tick: number,
      kind: 10,
      memberId: string,
      name: string,
      slot: number,
      avatarId: AvatarId,
      generation: number,
    ]
  | [seq: number, tick: number, kind: 11, memberId: string]
  | [
      seq: number,
      tick: number,
      kind: 12,
      memberId: string,
      connected: boolean,
      generation: number,
    ]
  | [seq: number, tick: number, kind: 13, settings: RoomSettings]
  | [
      seq: number,
      tick: number,
      kind: 14,
      action: RoomAction,
      newMatchId: string,
    ]
  | [
      seq: number,
      tick: number,
      kind: 15,
      action: "add",
      botId: string,
      name: string,
      slot: number,
    ]
  | [seq: number, tick: number, kind: 15, action: "remove", botId: string]
  | [
      seq: number,
      tick: number,
      kind: 16,
      action: "join",
      memberId: string,
      name: string,
      generation: number,
    ]
  | [seq: number, tick: number, kind: 16, action: "leave", memberId: string];

export const uint32 = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= UINT32_MAX &&
  !Object.is(value, -0);
const slot = (value: unknown): value is number => uint32(value) && value <= 4;
export const memberId = (value: unknown): value is string =>
  typeof value === "string" && /^[\w:.-]{1,64}$/.test(value);
const matchId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;

export function isManagementKind(kind: number): boolean {
  return kind >= JOIN && kind <= SPECTATOR;
}

/** Shape and bounds only. Sequence, tick order and gesture monotony are stream properties checked by the receiver. */
export function isEntry(raw: unknown): raw is Entry {
  if (
    !Array.isArray(raw) ||
    raw.length < 3 ||
    raw.length > 8 ||
    !uint32(raw[0]) ||
    raw[0] === 0 ||
    !uint32(raw[1]) ||
    raw[1] === 0
  )
    return false;
  switch (raw[2]) {
    case STEER:
      return raw.length === 4 && uint32(raw[3]) && raw[3] <= 3;
    case PRESS:
    case RELEASE:
    case CANCEL:
      return raw.length === 4 && uint32(raw[3]) && raw[3] > 0;
    case AVATAR:
      return raw.length === 4 && isAvatarId(raw[3]);
    case READY:
      return (
        raw.length === 6 &&
        typeof raw[3] === "boolean" &&
        matchId(raw[4]) &&
        (raw[5] === "lobby" || raw[5] === "matchOver")
      );
    case COLOR:
      return raw.length === 4 && uint32(raw[3]) && raw[3] < RIDER_COLORS.length;
    case JOIN:
      return (
        raw.length === 8 &&
        memberId(raw[3]) &&
        loggedRiderName(raw[4]) &&
        slot(raw[5]) &&
        isAvatarId(raw[6]) &&
        uint32(raw[7])
      );
    case LEAVE:
      return raw.length === 4 && memberId(raw[3]);
    case PRESENCE:
      return (
        raw.length === 6 &&
        memberId(raw[3]) &&
        typeof raw[4] === "boolean" &&
        uint32(raw[5])
      );
    case SETTINGS:
      return raw.length === 4 && parseRoomSettings(raw[3]) !== undefined;
    case ACTION:
      return (
        raw.length === 5 &&
        ["start", "rematch", "lobby"].includes(raw[3] as string) &&
        matchId(raw[4])
      );
    case BOT:
      return raw[3] === "add"
        ? raw.length === 7 &&
            memberId(raw[4]) &&
            loggedRiderName(raw[5]) &&
            slot(raw[6])
        : raw[3] === "remove" && raw.length === 5 && memberId(raw[4]);
    case SPECTATOR:
      return raw[3] === "join"
        ? raw.length === 7 &&
            memberId(raw[4]) &&
            loggedRiderName(raw[5]) &&
            uint32(raw[6])
        : raw[3] === "leave" && raw.length === 5 && memberId(raw[4]);
    default:
      return false;
  }
}

/** Per-player controls between entries; the reducer folds one tick of entries into an intent. */
export interface HeldControls extends GestureControls {
  flags: number;
}
export const neutralControls = (): HeldControls => ({
  flags: 0,
  activeGesture: 0,
  latestGesture: 0,
});

/**
 * Folds one tick of a rider's entries into its held controls and the tick's intent. The bomb button goes through the
 * gesture core (`bomb-gesture.ts`) with the ids the entries carry: a press over a held gesture yields `cancel` then
 * `press`, and a repeated press or a release or cancel of another gesture is a no-op. Mutates `held`.
 */
export function foldPlayerEntries(
  held: HeldControls,
  entries: readonly Entry[],
): InputIntent {
  const commands: BombActionCommand[] = [];
  for (const entry of entries) {
    switch (entry[2]) {
      case STEER:
        held.flags = entry[3];
        break;
      case PRESS:
        pressGesture(held, entry[3], commands);
        break;
      case RELEASE:
        releaseGesture(held, entry[3], commands);
        break;
      case CANCEL:
        cancelGesture(held, entry[3], commands);
        break;
      default:
        break;
    }
  }
  return intentOf(held, commands);
}

export function intentOf(
  held: HeldControls,
  commands: readonly BombActionCommand[] = [],
): InputIntent {
  return {
    left: (held.flags & 1) !== 0,
    right: (held.flags & 2) !== 0,
    bomb: held.activeGesture > 0,
    ...(commands.length ? { bombCommands: commands } : {}),
  };
}
