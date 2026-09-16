import { isDeviceProfile, type DeviceProfile } from './device-profile.js';
import { isAvatarId, type AvatarId } from './avatars.js';
import { parseRoomSettings, type RoomSettings } from './room-settings.js';
import type { AimPoint, BombActionCommand } from './protocol.js';
import type { InputIntent } from './game.js';

/** Entry kinds. Player kinds come from any member's own stream; management kinds only from the creator's. */
export const STEER = 0, AIM = 1, PRESS = 2, RELEASE = 3, CANCEL = 4, AVATAR = 5, DEVICE = 6;
export const JOIN = 10, LEAVE = 11, PRESENCE = 12, SETTINGS = 13, ACTION = 14, BOT = 15;
export const UINT16_MAX = 0xffff, UINT32_MAX = 0xffff_ffff;
export const MAX_NAME_LENGTH = 20;
export type RoomAction = 'start' | 'rematch' | 'lobby';
export type Entry =
  | [seq: number, tick: number, kind: 0, flags: number]
  | [seq: number, tick: number, kind: 1, x: number, y: number]
  | [seq: number, tick: number, kind: 2, gesture: number]
  | [seq: number, tick: number, kind: 3, gesture: number]
  | [seq: number, tick: number, kind: 3, gesture: number, x: number, y: number]
  | [seq: number, tick: number, kind: 4, gesture: number]
  | [seq: number, tick: number, kind: 5, avatarId: AvatarId]
  | [seq: number, tick: number, kind: 6, device: DeviceProfile['device'], input: DeviceProfile['input']]
  | [seq: number, tick: number, kind: 10, memberId: string, name: string, slot: number, avatarId: AvatarId, generation: number]
  | [seq: number, tick: number, kind: 11, memberId: string]
  | [seq: number, tick: number, kind: 12, memberId: string, connected: boolean, generation: number]
  | [seq: number, tick: number, kind: 13, settings: RoomSettings]
  | [seq: number, tick: number, kind: 14, action: RoomAction, newMatchId: string]
  | [seq: number, tick: number, kind: 15, action: 'add', botId: string, name: string, slot: number]
  | [seq: number, tick: number, kind: 15, action: 'remove', botId: string];

export const uint32 = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX && !Object.is(value, -0);
const uint16 = (value: unknown): value is number => uint32(value) && value <= UINT16_MAX;
const slot = (value: unknown): value is number => uint32(value) && value <= 4;
export const memberId = (value: unknown): value is string => typeof value === 'string' && /^[\w:.-]{1,64}$/.test(value);
const name = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH && !/[\x00-\x1f\x7f]/.test(value);
const matchId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64;

export function isManagementKind(kind: number): boolean { return kind >= JOIN && kind <= BOT; }

/** Shape and bounds only. Sequence, tick order and gesture monotony are stream properties checked by the receiver. */
export function isEntry(raw: unknown): raw is Entry {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 8 || !uint32(raw[0]) || raw[0] === 0 || !uint32(raw[1]) || raw[1] === 0) return false;
  switch (raw[2]) {
    case STEER: return raw.length === 4 && uint32(raw[3]) && raw[3] <= 3;
    case AIM: return raw.length === 5 && uint16(raw[3]) && uint16(raw[4]);
    case PRESS: case CANCEL: return raw.length === 4 && uint32(raw[3]) && raw[3] > 0;
    case RELEASE: return (raw.length === 4 || (raw.length === 6 && uint16(raw[4]) && uint16(raw[5]))) && uint32(raw[3]) && raw[3] > 0;
    case DEVICE: return raw.length === 5 && isDeviceProfile({ device: raw[3], input: raw[4] });
    case AVATAR: return raw.length === 4 && isAvatarId(raw[3]);
    case JOIN: return raw.length === 8 && memberId(raw[3]) && name(raw[4]) && slot(raw[5]) && isAvatarId(raw[6]) && uint32(raw[7]);
    case LEAVE: return raw.length === 4 && memberId(raw[3]);
    case PRESENCE: return raw.length === 6 && memberId(raw[3]) && typeof raw[4] === 'boolean' && uint32(raw[5]);
    case SETTINGS: return raw.length === 4 && parseRoomSettings(raw[3]) !== undefined;
    case ACTION: return raw.length === 5 && ['start', 'rematch', 'lobby'].includes(raw[3] as string) && matchId(raw[4]);
    case BOT: return raw[3] === 'add' ? raw.length === 7 && memberId(raw[4]) && name(raw[5]) && slot(raw[6]) : raw[3] === 'remove' && raw.length === 5 && memberId(raw[4]);
    default: return false;
  }
}

export function quantizeAim(aim: AimPoint): [number, number] {
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * UINT16_MAX);
  return [clamp(aim.x), clamp(aim.y)];
}
export function dequantizeAim(x: number, y: number): AimPoint { return { x: x / UINT16_MAX, y: y / UINT16_MAX }; }

/** Per-player controls between entries; the reducer folds one tick of entries into an intent. */
export interface HeldControls { flags: number; aim?: AimPoint; activeGesture: number; latestGesture: number }
export const neutralControls = (): HeldControls => ({ flags: 0, activeGesture: 0, latestGesture: 0 });

/**
 * Reproduces the LAN BombInputBuffer semantics from log entries: a press allocates a gesture and enqueues `press`;
 * a press while one is active enqueues `cancel` then `press`; release or cancel with the active gesture id enqueues
 * that command; a mismatched id is a no-op; aim updates the held aim. Mutates `held`.
 */
export function foldPlayerEntries(held: HeldControls, entries: readonly Entry[]): InputIntent {
  const commands: BombActionCommand[] = [];
  const withAim = (action: BombActionCommand['action']): BombActionCommand => ({ action, ...(held.aim ? { aim: { ...held.aim } } : {}) });
  for (const entry of entries) {
    switch (entry[2]) {
      case STEER: held.flags = entry[3]; break;
      case AIM: held.aim = dequantizeAim(entry[3], entry[4]); break;
      case PRESS:
        if (entry[3] <= held.latestGesture) break;
        if (held.activeGesture) commands.push({ action: 'cancel' });
        held.activeGesture = held.latestGesture = entry[3];
        commands.push(withAim('press'));
        break;
      case RELEASE:
        if (entry[3] !== held.activeGesture) break;
        if (entry.length === 6) held.aim = dequantizeAim(entry[4], entry[5]);
        held.activeGesture = 0;
        commands.push(withAim('release'));
        held.aim = undefined;
        break;
      case CANCEL:
        if (entry[3] !== held.activeGesture) break;
        held.activeGesture = 0;
        commands.push({ action: 'cancel' });
        held.aim = undefined;
        break;
      default: break;
    }
  }
  return intentOf(held, commands);
}

export function intentOf(held: HeldControls, commands: readonly BombActionCommand[] = []): InputIntent {
  return { left: (held.flags & 1) !== 0, right: (held.flags & 2) !== 0, bomb: held.activeGesture > 0, ...(held.aim ? { aim: { ...held.aim } } : {}), ...(commands.length ? { bombCommands: commands } : {}) };
}
