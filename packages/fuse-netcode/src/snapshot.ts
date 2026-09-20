import type { LogEntry, RollbackGame, RoomClock } from "./game.js";
import { packMessage, unpackMessage } from "./packet.js";
import type { World } from "./rollback.js";
import type { StreamLog } from "./stream.js";
import { memberId, uint32 } from "./wire.js";

export const SNAPSHOT_CHUNK_BYTES = 16_000,
  MAX_SNAPSHOT_BYTES = 2_000_000,
  MAX_SNAPSHOT_ENTRIES = 512;
export interface SnapshotChunk {
  type: "snapshot";
  tick: number;
  rules: string;
  room: number;
  chunk: number;
  total: number;
  data: string;
}
export interface SnapshotStream<Entry extends LogEntry = LogEntry> {
  id: string;
  generation: number;
  seq: number;
  /** The stream's ordinal floor at the snapshot tick (Fuse Riders: the press gesture id). */
  ordinal: number;
  entries: Entry[];
}
export interface DecodedSnapshot<Room, Entry extends LogEntry = LogEntry> {
  state: Room;
  streams: SnapshotStream<Entry>[];
}

const toBase64 = (bytes: Uint8Array): string => {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
};
const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/**
 * The whole world at the sender's servable tick (complete for every member) plus every stream's entries after it, in
 * ≤16 KB chunks. The message is `[rules, room, tick, ...leading game fields, streams, hash, ...trailing game fields]`,
 * split at `checkpoint.leading` (Fuse Riders added its spectators after the hash, and the bytes stay as they were).
 */
export function encodeSnapshot<
  Room extends RoomClock,
  Entry extends LogEntry,
  View extends { tick: number },
  Event,
  Settings,
>(
  world: World<Room, Entry, View, Event, Settings>,
  room: number,
): SnapshotChunk[] {
  const game = world.game;
  const { state, tick } = world.servable();
  const encodeStream = (id: string, stream: StreamLog<Entry>) => {
    const base = stream.baseAt(tick);
    return [
      id,
      stream.generation,
      base.seq,
      base.ordinal,
      stream.entriesAfter(base.seq, tick).slice(0, MAX_SNAPSHOT_ENTRIES),
    ];
  };
  // Retired generations first, so a joiner installing in order ends with the current stream; only those with entries left to replay travel.
  const streams = [
    ...world
      .retiredStreams()
      .filter(
        ({ stream }) =>
          stream.entriesAfter(stream.baseAt(tick).seq, tick).length,
      )
      .map(({ id, stream }) => encodeStream(id, stream)),
    ...[...world.streams].map(([id, stream]) => encodeStream(id, stream)),
  ];
  const fields = game.checkpoint.encode(state),
    leading = game.checkpoint.leading;
  const bytes = packMessage([
    game.rules,
    room,
    tick,
    ...fields.slice(0, leading),
    streams,
    game.hash(state),
    ...fields.slice(leading),
  ]);
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES)
    throw new Error("Snapshot too large");
  // One base64 text split by characters: chunking the bytes first would leave padding in the middle.
  const text = toBase64(bytes),
    span = Math.ceil((SNAPSHOT_CHUNK_BYTES * 4) / 3),
    total = Math.max(1, Math.ceil(text.length / span));
  return Array.from({ length: total }, (_, chunk) => ({
    type: "snapshot",
    tick,
    rules: game.rules,
    room,
    chunk,
    total,
    data: text.slice(chunk * span, (chunk + 1) * span),
  }));
}

/** Reassembles one snapshot at a time; any inconsistency drops the partial transfer. */
export class SnapshotAssembler {
  private parts: string[] = [];
  private tick = -1;
  private total = 0;
  constructor(
    private readonly game: { readonly rules: string },
    private readonly room: number,
  ) {}
  reset(): void {
    this.parts = [];
    this.tick = -1;
    this.total = 0;
  }
  accept(raw: unknown): { tick: number; bytes: Uint8Array } | undefined {
    const message = raw as SnapshotChunk;
    if (
      !message ||
      typeof message !== "object" ||
      message.type !== "snapshot" ||
      message.rules !== this.game.rules ||
      message.room !== this.room ||
      !uint32(message.tick) ||
      !uint32(message.chunk) ||
      !uint32(message.total) ||
      message.total === 0 ||
      message.chunk >= message.total ||
      typeof message.data !== "string" ||
      message.data.length > SNAPSHOT_CHUNK_BYTES * 2
    ) {
      this.reset();
      return;
    }
    if (message.chunk === 0) {
      this.reset();
      this.tick = message.tick;
      this.total = message.total;
    } else if (
      message.tick !== this.tick ||
      message.total !== this.total ||
      message.chunk !== this.parts.length
    ) {
      this.reset();
      return;
    }
    if (this.total * SNAPSHOT_CHUNK_BYTES > MAX_SNAPSHOT_BYTES * 1.4) {
      this.reset();
      return;
    }
    this.parts.push(message.data);
    if (this.parts.length < this.total) return;
    const text = this.parts.join(""),
      tick = this.tick;
    this.reset();
    try {
      const bytes = fromBase64(text);
      return bytes.byteLength <= MAX_SNAPSHOT_BYTES
        ? { tick, bytes }
        : undefined;
    } catch {
      return;
    }
  }
}

/** Every field is checked against the game it describes before anything is installed. */
export function decodeSnapshot<
  Room extends RoomClock,
  Entry extends LogEntry,
  View extends { tick: number },
  Event,
  Settings,
>(
  game: RollbackGame<Room, Entry, View, Event, Settings>,
  bytes: Uint8Array,
  room: number,
): DecodedSnapshot<Room, Entry> | undefined {
  let value: unknown;
  try {
    value = unpackMessage(bytes);
  } catch {
    return;
  }
  const leading = game.checkpoint.leading;
  if (
    !Array.isArray(value) ||
    value.length < 5 + leading ||
    value[0] !== game.rules ||
    value[1] !== room ||
    !uint32(value[2])
  )
    return;
  const tick = value[2],
    rawStreams: unknown = value[3 + leading],
    hash: unknown = value[4 + leading];
  if (!Array.isArray(rawStreams) || typeof hash !== "string") return;
  const state = game.checkpoint.decode(
    [...value.slice(3, 3 + leading), ...value.slice(5 + leading)],
    tick,
  );
  if (!state || state.tick !== tick || game.hash(state) !== hash) return;
  const streams: SnapshotStream<Entry>[] = [],
    seen = new Set<string>();
  for (const raw of rawStreams) {
    if (!Array.isArray(raw) || raw.length !== 5) return;
    const [id, generation, seq, ordinal, entries] = raw;
    // One stream per member and generation; a member's retired generations precede its current one.
    if (
      !memberId(id) ||
      !uint32(generation) ||
      seen.has(`${id}:${generation}`) ||
      !uint32(seq) ||
      !uint32(ordinal) ||
      !Array.isArray(entries) ||
      entries.length > MAX_SNAPSHOT_ENTRIES
    )
      return;
    let previous = seq;
    for (const entry of entries) {
      if (!game.isEntry(entry) || entry[0] <= previous) return;
      previous = entry[0];
    }
    let previousGeneration: number | undefined;
    for (const stream of streams)
      if (stream.id === id) previousGeneration = stream.generation;
    if (previousGeneration !== undefined && previousGeneration >= generation)
      return;
    seen.add(`${id}:${generation}`);
    streams.push({ id, generation, seq, ordinal, entries: entries as Entry[] });
  }
  return { state, streams };
}
