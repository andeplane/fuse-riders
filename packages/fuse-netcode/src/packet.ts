import { encode, decode } from "@msgpack/msgpack";
import type { EntryRules, LogEntry } from "./game.js";
import { memberId, uint32 } from "./wire.js";

export const PACKET_VERSION = 1,
  NACK_VERSION = 2;
/** One datagram under the 1,280-byte IPv6 minimum MTU with DTLS/SCTP headers to spare; a SETTINGS entry is ~230 bytes. */
export const MAX_PACKET_BYTES = 1100,
  MAX_PACKET_ENTRIES = 6,
  MAX_MESSAGE_BYTES = 2_000_000;
/** The per-tick packet from one member to another; echo fields make every packet a clock and RTT sample. */
export interface Packet<Entry extends LogEntry = LogEntry> {
  room: number;
  from: string;
  generation: number;
  through: number;
  lastSeq: number;
  entries: Entry[];
  sentAt: number;
  echoSentAt: number;
  echoHeld: number;
  clockTick: number;
  hash: [tick: number, hash: string] | null;
}
export interface Nack {
  room: number;
  from: string;
  firstMissingSeq: number;
}

export function packMessage(value: unknown): Uint8Array {
  return encode(value, { ignoreUndefined: true, maxDepth: 32 });
}
/** Bounded decode: nesting and declared collection sizes are checked before MessagePack allocates containers. */
export function unpackMessage(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_MESSAGE_BYTES)
    throw new Error("Message too large");
  preflight(bytes);
  return decode(bytes, {
    maxStrLength: MAX_MESSAGE_BYTES,
    maxBinLength: 0,
    maxArrayLength: 4096,
    maxMapLength: 64,
    maxExtLength: 0,
  });
}
function preflight(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0,
    nodes = 0,
    capacity = 0;
  const skip = (count: number) => {
    if (count < 0 || offset + count > bytes.length)
      throw new Error("Truncated MessagePack");
    offset += count;
  };
  const length = (width: 1 | 2 | 4) => {
    const at = offset;
    skip(width);
    return width === 1
      ? view.getUint8(at)
      : width === 2
        ? view.getUint16(at)
        : view.getUint32(at);
  };
  const visit = (depth: number): void => {
    if (depth > 32 || ++nodes > 200_000)
      throw new Error("Message complexity limit");
    const tag = length(1);
    let array = -1,
      map = -1;
    if (
      tag <= 0x7f ||
      tag >= 0xe0 ||
      tag === 0xc0 ||
      tag === 0xc2 ||
      tag === 0xc3
    )
      return;
    if (tag >= 0xa0 && tag <= 0xbf) {
      skip(tag & 31);
      return;
    }
    if (tag >= 0x90 && tag <= 0x9f) array = tag & 15;
    else if (tag >= 0x80 && tag <= 0x8f) map = tag & 15;
    else if (tag === 0xdc || tag === 0xdd) array = length(tag === 0xdc ? 2 : 4);
    else if (tag === 0xde || tag === 0xdf) map = length(tag === 0xde ? 2 : 4);
    else if ([0xd9, 0xda, 0xdb].includes(tag)) {
      skip(length(tag === 0xd9 ? 1 : tag === 0xda ? 2 : 4));
      return;
    } else {
      const widths: Record<number, number> = {
        0xca: 4,
        0xcb: 8,
        0xcc: 1,
        0xcd: 2,
        0xce: 4,
        0xcf: 8,
        0xd0: 1,
        0xd1: 2,
        0xd2: 4,
        0xd3: 8,
      };
      const width = widths[tag];
      if (!width) throw new Error("Unsupported MessagePack type");
      skip(width);
      return;
    }
    if (array > 4096 || map > 64) throw new Error("Collection limit");
    const count = array >= 0 ? array : map * 2;
    capacity += count;
    if (capacity > 200_000) throw new Error("Allocation limit");
    for (let index = 0; index < count; index++) visit(depth + 1);
  };
  visit(0);
  if (offset !== bytes.length) throw new Error("Trailing MessagePack data");
}

export function encodePacket(packet: Packet): Uint8Array {
  if (packet.entries.length > MAX_PACKET_ENTRIES)
    throw new Error("Too many entries");
  const bytes = packMessage([
    PACKET_VERSION,
    packet.room,
    packet.from,
    packet.generation,
    packet.through,
    packet.lastSeq,
    packet.entries,
    packet.sentAt,
    packet.echoSentAt,
    packet.echoHeld,
    packet.clockTick,
    packet.hash,
  ]);
  if (bytes.byteLength > MAX_PACKET_BYTES) throw new Error("Packet too large");
  return bytes;
}
/** Fit a packet by dropping its oldest entries first: the newest entry always travels, the rest recur by rotation. */
export function encodePacketTrimmed(packet: Packet): Uint8Array {
  let entries = packet.entries;
  for (;;) {
    try {
      return encodePacket({ ...packet, entries });
    } catch (error) {
      if (entries.length <= 1) throw error;
      entries = entries.slice(1);
    }
  }
}
export function encodeNack(nack: Nack): Uint8Array {
  return packMessage([
    NACK_VERSION,
    nack.room,
    nack.from,
    nack.firstMissingSeq,
  ]);
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
/** Shape validation only; stream order, generation and room membership are the receiver's business. */
export function decodePacket<Entry extends LogEntry>(
  rules: Pick<EntryRules<Entry>, "isEntry">,
  bytes: Uint8Array,
): { packet: Packet<Entry> } | { nack: Nack } | undefined {
  if (bytes.byteLength > MAX_PACKET_BYTES) return;
  let value: unknown;
  // Maps are allowed for a settings entry (Fuse Riders: its room settings and pickup weights); the game's isEntry validates them.
  try {
    value = decode(bytes, {
      maxStrLength: 128,
      maxBinLength: 0,
      maxArrayLength: 16,
      maxMapLength: 32,
      maxExtLength: 0,
    });
  } catch {
    return;
  }
  if (!Array.isArray(value)) return;
  if (value[0] === NACK_VERSION)
    return value.length === 4 &&
      uint32(value[1]) &&
      memberId(value[2]) &&
      uint32(value[3]) &&
      value[3] > 0
      ? { nack: { room: value[1], from: value[2], firstMissingSeq: value[3] } }
      : undefined;
  if (value[0] !== PACKET_VERSION || value.length !== 12) return;
  const [
    ,
    room,
    from,
    generation,
    through,
    lastSeq,
    entries,
    sentAt,
    echoSentAt,
    echoHeld,
    clockTick,
    hash,
  ] = value;
  if (
    !uint32(room) ||
    !memberId(from) ||
    !uint32(generation) ||
    !uint32(through) ||
    !uint32(lastSeq) ||
    !Array.isArray(entries) ||
    entries.length > MAX_PACKET_ENTRIES ||
    !entries.every((entry) => rules.isEntry(entry))
  )
    return;
  if (
    !uint32(sentAt) ||
    !uint32(echoSentAt) ||
    !uint32(echoHeld) ||
    !finite(clockTick) ||
    clockTick < 0
  )
    return;
  if (
    hash !== null &&
    !(
      Array.isArray(hash) &&
      hash.length === 2 &&
      uint32(hash[0]) &&
      typeof hash[1] === "string" &&
      /^[0-9a-f]{16}$/.test(hash[1])
    )
  )
    return;
  return {
    packet: {
      room,
      from,
      generation,
      through,
      lastSeq,
      entries: entries as Entry[],
      sentAt,
      echoSentAt,
      echoHeld,
      clockTick,
      hash: hash as Packet["hash"],
    },
  };
}

export function roomHash(incarnation: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < incarnation.length; index++)
    hash = Math.imul(hash ^ incarnation.charCodeAt(index), 0x01000193) >>> 0;
  return hash;
}
/** Millisecond stamps wrap at 2^32; the signed 32-bit difference is exact for any interval under 24 days. */
export const wrapMs = (ms: number): number => Math.round(ms) >>> 0;
export const wrapDelta = (later: number, earlier: number): number =>
  (later - earlier) | 0;
