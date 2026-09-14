import { PICKUP_WEIGHTS } from './pickup-weights.js';
import { BOMB_MAX_CHARGE_TICKS, isBombChargeTicks } from './bomb-launch.js';
import type { PickupType } from './game.js';
export interface RoomSettings {
  version: 1;
  mode: 'shared' | 'devices';
  match: 'wins' | 'rounds';
  length: number;
  bombChargeTicks: number;
  weights: Partial<Record<PickupType, number>>;
}
export const SETTINGS_KEY = 'fuse-riders-room-settings-v1';
export function defaultRoomSettings(): RoomSettings {
  return { version: 1, mode: 'devices', match: 'wins', length: 3, bombChargeTicks: BOMB_MAX_CHARGE_TICKS, weights: Object.fromEntries(PICKUP_WEIGHTS.map(row => [row.type, row.weight])) };
}
export function parseRoomSettings(raw: unknown): RoomSettings | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as RoomSettings;
  const bombChargeTicks = value.bombChargeTicks === undefined ? BOMB_MAX_CHARGE_TICKS : value.bombChargeTicks;
  if (!isBombChargeTicks(bombChargeTicks)) return;
  if (value.version !== 1 || !['shared','devices'].includes(value.mode) || !['wins','rounds'].includes(value.match) || !Number.isInteger(value.length) || value.length < 1 || value.length > 20 || !value.weights || typeof value.weights !== 'object') return;
  const allowed = new Set([...PICKUP_WEIGHTS.map(row => row.type), 'star']);
  const weights: RoomSettings['weights'] = {};
  for (const [type, weight] of Object.entries(value.weights)) {
    if (!allowed.has(type as PickupType) || typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 10000) return;
    weights[type as PickupType] = weight;
  }
  return { version: 1, mode: value.mode, match: value.match, length: value.length, bombChargeTicks, weights };
}
export function loadRoomSettings(storage: Pick<Storage,'getItem'>): RoomSettings {
  try { return parseRoomSettings(JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null')) ?? defaultRoomSettings(); } catch { return defaultRoomSettings(); }
}
export function roomPickup(roll: number, weights: RoomSettings['weights']): PickupType | undefined {
  const entries = Object.entries(weights) as [PickupType,number][];
  const total = entries.reduce((sum,[,weight])=>sum+weight,0);
  if (!total) return;
  let remaining = roll*total;
  for(const [type,weight] of entries) { remaining-=weight; if(remaining<0)return type; }
}
