import { encode } from '@msgpack/msgpack';
import { addPlayer, removePlayer, setPlayerConnected, startMatch, startNextRound, returnToLobby, resetMatch, step, type GameState, type InputIntent, type PlayerIdentity, SLOT_COLORS } from './game.js';
import { isAvatarId, type AvatarId } from './avatars.js';
import { parseRoomSettings, type RoomSettings } from './room-settings.js';
import type { GameEvent } from './protocol.js';

export const REPLAY_RULES = 'fuse-actions-3';
export type AimTuple = [number, number] | null;
export type BombTuple = [number, AimTuple];
/** Self-contained action timestamp; must equal the containing step's absolute tick. */
export type ControlChange = [slot:number, appliedTick:number, flags:number, aim:AimTuple, bombs:BombTuple[]];
export type GameOperation = [0, number, ControlChange[]] | [1, PlayerIdentity] | [2, string] |
  [3, string, boolean] | [4, RoomSettings] | [5, number, string] | [6, string, AvatarId];
export interface HeldControl { at: number; flags: number; aim: AimTuple }
export interface ReplayState { game: GameState; held: Map<number, HeldControl> }
const actions = ['press', 'release', 'cancel'] as const;
const integer = (x: unknown, max = Number.MAX_SAFE_INTEGER): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= max;
const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128;
const aimTuple = (aim:{x:number;y:number}|undefined):AimTuple => aim ? [aim.x===0?0:aim.x,aim.y===0?0:aim.y] : null;
export const validAim = (x: unknown): x is AimTuple => x === null || Array.isArray(x) && x.length === 2 && x.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 && !Object.is(n,-0));
export function validOperation(value: unknown): value is GameOperation {
  if (!Array.isArray(value)) return false;
  const [kind, a, b] = value;
  switch (kind) {
    case 0: return value.length === 3 && integer(a) && Array.isArray(b) && b.length <= 5 && b.every(c => Array.isArray(c) && c.length === 5 && integer(c[0], 4) && integer(c[1]) && c[1] === a && integer(c[2], 7) && validAim(c[3]) && Array.isArray(c[4]) && c[4].length <= 128 && c[4].every((v: unknown) => Array.isArray(v) && v.length === 2 && integer(v[0], 2) && validAim(v[1])));
    case 1: return value.length === 2 && a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).every(k => ['id','name','slot','color','avatarId','connected'].includes(k)) && text(a.id) && text(a.name) && a.name.trim().length > 0 && a.name.length <= 20 && integer(a.slot, 4) && a.color === SLOT_COLORS[a.slot] && (a.avatarId === undefined || isAvatarId(a.avatarId)) && (a.connected === undefined || typeof a.connected === 'boolean');
    case 2: return value.length === 2 && text(a);
    case 3: return value.length === 3 && text(a) && typeof b === 'boolean';
    case 4: return value.length === 2 && parseRoomSettings(a) !== undefined;
    case 5: return value.length === 3 && integer(a, 3) && typeof b === 'string' && b.length <= 128 && (a < 2 || b.length > 0);
    case 6: return value.length === 3 && text(a) && isAvatarId(b);
    default: return false;
  }
}
/** All gameplay mutation is deterministic; callers validate a transaction before committing it. */
export function applyOperation(state: ReplayState, op: GameOperation): GameEvent[] {
  const game = state.game;
  switch (op[0]) {
    case 0: {
      if (op[1] !== game.tick + 1) throw new Error('Noncontiguous simulation tick');
      const inputs = new Map<string, InputIntent>();
      const changed = new Set<number>();
      for (const [slot, appliedTick, flags, aim, bombs] of op[2]) {
        if (changed.has(slot) || ![...game.players.values()].some(p => p.slot === slot) || appliedTick !== op[1]) throw new Error('Invalid player action tick');
        changed.add(slot); state.held.set(slot, {at: op[1], flags, aim});
        const player = [...game.players.values()].find(p => p.slot === slot)!;
        inputs.set(player.id, {left: !!(flags & 1), right: !!(flags & 2), bomb: !!(flags & 4), ...(aim ? {aim:{x:aim[0],y:aim[1]}} : {}), bombCommands: bombs.map(([action, target]) => ({action: actions[action]!, ...(target ? {aim:{x:target[0],y:target[1]}} : {})}))});
      }
      for (const player of game.players.values()) if (!inputs.has(player.id)) {
        const held = state.held.get(player.slot);
        const flags = held?.flags ?? 0, aim = held?.aim;
        inputs.set(player.id, {left:!!(flags & 1),right:!!(flags & 2),bomb:!!(flags & 4), ...(aim ? {aim:{x:aim[0],y:aim[1]}} : {})});
      }
      return step(game, inputs).events;
    }
    case 1: addPlayer(game, op[1]); state.held.delete(op[1].slot); break;
    case 2: { const slot = game.players.get(op[1])?.slot; removePlayer(game, op[1]); if (slot !== undefined) state.held.delete(slot); break; }
    case 3: setPlayerConnected(game, op[1], op[2]); break;
    case 4: game.settings = structuredClone(op[1]); break;
    case 5:
      if (op[1] === 0) startMatch(game);
      else if (op[1] === 1) startNextRound(game);
      else if (op[1] === 2) { const tick = game.tick; returnToLobby(game, op[2]); game.tick = tick; }
      else resetMatch(game, op[2]);
      state.held.clear(); break;
    case 6: { const player = game.players.get(op[1]); if (!player) throw new Error('Unknown avatar player'); player.avatarId = op[2]; break; }
  }
  return [];
}

/** Stable object keys, but Map order is semantic and must survive replay. */
export function canonical(value: unknown): string {
  if (value instanceof Map) return `{"$map":${canonical([...value])}}`;
  if (Array.isArray(value)) return `[${value.map(v => canonical(v)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return Object.is(value,-0)?'-0':JSON.stringify(value) ?? 'null';
}
export function replayHash(state: ReplayState): string {
  const raw = canonical(state); let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < raw.length; i++) { const c = raw.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x85ebca6b); }
  return `${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}`;
}
interface Entry { seq:number; tick:number; bytes:number; op:GameOperation }
export class ActionJournal {
  readonly state: ReplayState;
  private entries: Entry[] = [];
  private bytes = 0;
  sequence = 0;
  constructor(game: GameState, readonly capture = false) { this.state = {game, held:new Map()}; }
  apply(op: GameOperation): GameEvent[] {
    const events = applyOperation(this.state, op);
    if (this.capture) {
      const copy = structuredClone(op), bytes = encode(copy, {ignoreUndefined:true}).byteLength;
      this.entries.push({seq:++this.sequence, tick:this.state.game.tick, bytes, op:copy}); this.bytes += bytes;
      while (this.entries.length && (this.entries.length > 400 || this.bytes > 2_000_000 || this.entries[0]!.tick < this.state.game.tick - 400)) this.bytes -= this.entries.shift()!.bytes;
    }
    return events;
  }
  advance(inputs: ReadonlyMap<string, InputIntent>): GameEvent[] {
    if (!this.capture) return step(this.state.game, inputs).events;
    const tick = this.state.game.tick + 1, changes: ControlChange[] = [];
    for (const player of this.state.game.players.values()) {
      const input = inputs.get(player.id) ?? {left:false,right:false,bomb:false};
      const flags = Number(input.left) | Number(input.right)<<1 | Number(input.bomb)<<2;
      const aim = aimTuple(input.aim);
      const bombs: BombTuple[] = (input.bombCommands ?? []).map(b => [actions.indexOf(b.action), aimTuple(b.aim)]);
      const old = this.state.held.get(player.slot);
      if (!old || old.flags !== flags || JSON.stringify(old.aim) !== JSON.stringify(aim) || bombs.length) changes.push([player.slot,tick,flags,aim,bombs]);
    }
    return this.apply([0,tick,changes]);
  }
  since(sequence: number): GameOperation[] | undefined {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > this.sequence || sequence < (this.entries[0]?.seq ?? this.sequence+1)-1) return;
    return this.entries.filter(e => e.seq > sequence).map(e => structuredClone(e.op));
  }
}
