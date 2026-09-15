import { RULES, hashRoomState, type Fold, type RoomState } from '../shared/apply-tick.js';
import { BOT_ID_PREFIX } from '../shared/bot-controller.js';
import { isEntry, memberId, uint32, type Entry } from '../shared/input-log.js';
import { parseRoomSettings } from '../shared/room-settings.js';
import { decodeGameState, encodeGameState } from './checkpoint.js';
import { packMessage, unpackMessage } from './packet.js';
import type { World } from './rollback.js';

export const SNAPSHOT_CHUNK_BYTES = 16_000, MAX_SNAPSHOT_BYTES = 2_000_000, MAX_SNAPSHOT_ENTRIES = 512;
export interface SnapshotChunk { type: 'snapshot'; tick: number; rules: string; room: number; chunk: number; total: number; data: string }
export interface SnapshotStream { id: string; generation: number; seq: number; gesture: number; entries: Entry[] }
export interface DecodedSnapshot { state: RoomState; streams: SnapshotStream[] }

const toBase64 = (bytes: Uint8Array): string => { let text = ''; for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192)); return btoa(text); };
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), char => char.charCodeAt(0));

/** The whole world at the sender's servable tick (complete for every rider) plus every stream's entries after it, in ≤16 KB chunks. */
export function encodeSnapshot(world: World, room: number): SnapshotChunk[] {
  const { state, tick } = world.servable();
  const folds = [...state.folds].map(([id, fold]) => [id, fold.generation, fold.flags, fold.aim?.x ?? null, fold.aim?.y ?? null, fold.activeGesture, fold.latestGesture]);
  const streams = [...world.streams].map(([id, stream]) => { const base = stream.baseAt(tick); return [id, stream.generation, base.seq, base.gesture, stream.entriesAfter(base.seq, tick).slice(0, MAX_SNAPSHOT_ENTRIES)]; });
  const bytes = packMessage([RULES, room, tick, encodeGameState(state.game), state.settings, folds, [...state.bots], streams, hashRoomState(state)]);
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot too large');
  // One base64 text split by characters: chunking the bytes first would leave padding in the middle.
  const text = toBase64(bytes), span = Math.ceil(SNAPSHOT_CHUNK_BYTES * 4 / 3), total = Math.max(1, Math.ceil(text.length / span));
  return Array.from({ length: total }, (_, chunk) => ({ type: 'snapshot', tick, rules: RULES, room, chunk, total, data: text.slice(chunk * span, (chunk + 1) * span) }));
}

/** Reassembles one snapshot at a time; any inconsistency drops the partial transfer. */
export class SnapshotAssembler {
  private parts: string[] = [];
  private tick = -1;
  private total = 0;
  constructor(private readonly room: number) {}
  reset(): void { this.parts = []; this.tick = -1; this.total = 0; }
  accept(raw: unknown): { tick: number; bytes: Uint8Array } | undefined {
    const message = raw as SnapshotChunk;
    if (!message || typeof message !== 'object' || message.type !== 'snapshot' || message.rules !== RULES || message.room !== this.room || !uint32(message.tick) || !uint32(message.chunk) || !uint32(message.total) || message.total === 0 || message.chunk >= message.total || typeof message.data !== 'string' || message.data.length > SNAPSHOT_CHUNK_BYTES * 2) { this.reset(); return; }
    if (message.chunk === 0) { this.reset(); this.tick = message.tick; this.total = message.total; }
    else if (message.tick !== this.tick || message.total !== this.total || message.chunk !== this.parts.length) { this.reset(); return; }
    if (this.total * SNAPSHOT_CHUNK_BYTES > MAX_SNAPSHOT_BYTES * 1.4) { this.reset(); return; }
    this.parts.push(message.data);
    if (this.parts.length < this.total) return;
    const text = this.parts.join(''), tick = this.tick; this.reset();
    try { const bytes = fromBase64(text); return bytes.byteLength <= MAX_SNAPSHOT_BYTES ? { tick, bytes } : undefined; } catch { return; }
  }
}

/** Every field is checked against the game it describes before anything is installed. */
export function decodeSnapshot(bytes: Uint8Array, room: number): DecodedSnapshot | undefined {
  let value: unknown;
  try { value = unpackMessage(bytes); } catch { return; }
  if (!Array.isArray(value) || value.length !== 9 || value[0] !== RULES || value[1] !== room || !uint32(value[2])) return;
  const [, , tick, gameJson, rawSettings, rawFolds, rawBots, rawStreams, hash] = value;
  const game = decodeGameState(gameJson), settings = parseRoomSettings(rawSettings);
  if (!game || !settings || game.tick !== tick || !Array.isArray(rawFolds) || !Array.isArray(rawBots) || !Array.isArray(rawStreams) || typeof hash !== 'string') return;
  const bots = new Set<string>();
  for (const id of rawBots) { if (typeof id !== 'string' || !id.startsWith(BOT_ID_PREFIX) || !game.players.has(id) || bots.has(id)) return; bots.add(id); }
  const folds = new Map<string, Fold>();
  const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  for (const raw of rawFolds) {
    if (!Array.isArray(raw) || raw.length !== 7) return;
    const [id, generation, flags, x, y, active, latest] = raw;
    if (!memberId(id) || !game.players.has(id) || bots.has(id) || folds.has(id) || !uint32(generation) || !uint32(flags) || flags > 3 || !uint32(active) || !uint32(latest) || (active !== 0 && active !== latest)) return;
    if (!((x === null && y === null) || (unit(x) && unit(y)))) return;
    folds.set(id, { generation, flags, activeGesture: active, latestGesture: latest, ...(x === null ? {} : { aim: { x, y: y as number } }) });
  }
  for (const player of game.players.values()) if (!bots.has(player.id) && !folds.has(player.id)) return;
  const state: RoomState = { game, settings, folds, bots };
  if (hashRoomState(state) !== hash) return;
  const streams: SnapshotStream[] = [], seen = new Set<string>();
  for (const raw of rawStreams) {
    if (!Array.isArray(raw) || raw.length !== 5) return;
    const [id, generation, seq, gesture, entries] = raw;
    if (!memberId(id) || seen.has(id) || !uint32(generation) || !uint32(seq) || !uint32(gesture) || !Array.isArray(entries) || entries.length > MAX_SNAPSHOT_ENTRIES) return;
    let previous = seq;
    for (const entry of entries) { if (!isEntry(entry) || entry[0] <= previous) return; previous = entry[0]; }
    seen.add(id); streams.push({ id, generation, seq, gesture, entries: entries as Entry[] });
  }
  return { state, streams };
}
