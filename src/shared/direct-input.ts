import { validAim, type AimTuple, type BombTuple, type ControlChange, type ReplayState, applyOperation } from './action-log.js';
import type { RoomSettings } from './room-settings.js';
import type { GameEvent } from './protocol.js';

export const DIRECT_RULES = 'fuse-direct-5';
export const UINT32_MAX = 0xffff_ffff;
export const uint32 = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX && !Object.is(value, -0);
/** Independent player stream. Sequence order breaks ties only within that player. */
export type DirectAction =
  | [sequence: number, tick: number, kind: 0, flags: number]
  | [sequence: number, tick: number, kind: 1 | 3, gesture: number]
  | [sequence: number, tick: number, kind: 2, gesture: number, aim: AimTuple]
  | [sequence: number, tick: number, kind: 4, aim: AimTuple];

export function isDirectAction(raw: unknown): raw is DirectAction {
  if (!Array.isArray(raw) || !uint32(raw[0]) || raw[0] === 0 || !uint32(raw[1])) return false;
  switch (raw[2]) {
    case 0: return raw.length === 4 && uint32(raw[3]) && raw[3] <= 3;
    case 1: case 3: return raw.length === 4 && uint32(raw[3]) && raw[3] > 0;
    case 2: return raw.length === 5 && uint32(raw[3]) && raw[3] > 0 && validAim(raw[4]);
    case 4: return raw.length === 4 && validAim(raw[3]);
    default: return false;
  }
}

export interface GestureState { active: number; latest: number }
export interface DirectState extends ReplayState { gestures: Map<number, GestureState>; roundSettings?: RoomSettings }

/** Mutates only the supplied candidate. Networking, clocks and side effects stay outside. */
export function stepDirect(state: DirectState, bySlot: ReadonlyMap<number, readonly DirectAction[]>): GameEvent[] {
  const tick = state.game.tick + 1;
  const changes: ControlChange[] = [];
  for (const player of state.game.players.values()) {
    const records = bySlot.get(player.slot);
    if (!records?.length) continue;
    const previous = state.held.get(player.slot);
    let flags = previous?.flags ?? 0, aim = previous?.aim ?? null;
    const gesture = state.gestures.get(player.slot) ?? { active: 0, latest: 0 };
    const bombs: BombTuple[] = [];
    let sequence = 0;
    for (const action of records) {
      if (!isDirectAction(action) || action[1] !== tick || action[0] <= sequence) throw new Error('Invalid direct tick actions');
      sequence = action[0];
      switch (action[2]) {
        case 0: flags = (flags & 4) | action[3]; break;
        case 1:
          if (action[3] <= gesture.latest) throw new Error('Reused gesture');
          if (gesture.active) bombs.push([2, null]);
          gesture.active = gesture.latest = action[3]; flags |= 4;
          bombs.push([0, aim]); break;
        case 2: case 3:
          if (action[3] !== gesture.active) break;
          gesture.active = 0; flags &= 3;
          if (action[2] === 2) { aim = action[4]; bombs.push([1, aim]); }
          else bombs.push([2, null]);
          break;
        case 4: aim = action[3]; break;
      }
    }
    state.gestures.set(player.slot, gesture);
    changes.push([player.slot, tick, flags, aim, bombs]);
  }
  const events=applyOperation(state, [0, tick, changes]);
  // The shared game ignores bomb commands outside play. Retain stream identity,
  // but a finished/countdown phase must not retain a charge after its gesture ends.
  if(state.game.phase!=='playing')for(const player of state.game.players.values()){
    player.bombChargeStartedTick=undefined;player.bombTarget=undefined;
  }
  if (state.game.phase === 'roundOver' && state.game.phaseEndsAtTick !== undefined && state.game.tick >= state.game.phaseEndsAtTick
    && [...state.game.players.values()].filter(p => p.connected).length >= 2) {
    if (state.roundSettings) applyOperation(state, [4, { ...state.roundSettings, match: state.game.settings?.match ?? 'wins', length: state.game.settings?.length ?? 3 }]);
    applyOperation(state, [5, 1, '']);
    for (const gesture of state.gestures.values()) gesture.active = 0;
  }
  return events;
}
