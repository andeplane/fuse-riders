import { decode, encode } from '@msgpack/msgpack';
import { validEntry, MAX_ENTRIES_PER_TICK, type LogEntry } from '../shared/action-log.js';

/** Largest packet accepted on the unreliable channel; everything bigger belongs on the reliable one. */
export const FAST_MESSAGE_BYTES = 4096;
export const MAX_STREAMS_PER_PACKET = 8;
const integer = (x: unknown, max = Number.MAX_SAFE_INTEGER): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= max;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** Sender, receiver and link identity are implied by the data channel the bytes arrive on; only the authority fence travels. */
export interface FastEnvelope { id: number; epoch: number; incarnation: number; data: unknown }
export function encodeFast(envelope: FastEnvelope): Uint8Array { return encode([envelope.id, envelope.epoch, envelope.incarnation, envelope.data], { ignoreUndefined: true }); }
export function decodeFast(bytes: ArrayBuffer | Uint8Array): FastEnvelope | undefined {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.byteLength > FAST_MESSAGE_BYTES) return;
  try {
    const v = decode(view, { maxArrayLength: 512, maxMapLength: 64, maxStrLength: 512, maxBinLength: 0, maxExtLength: 0 });
    if (!Array.isArray(v) || v.length !== 4 || !integer(v[0]) || !integer(v[1]) || !integer(v[2])) return;
    return { id: v[0], epoch: v[1], incarnation: v[2], data: v[3] };
  } catch { return; }
}

/** One per tick from every sender: its own stream, plus every other stream the host relays. */
export interface StreamPacket {
  type: 'streams';
  tick: number;          // sender's fractional tick when sent (the host's is the reference)
  sentAt: number;        // sender's monotonic clock, ms
  echoSentAt: number | null; // the recipient's most recent sentAt seen by the sender
  hash: string | null;   // host only: replay hash of its state at floor(tick), every 20 ticks
  streams: { member: number; lastSeq: number; entries: LogEntry[] }[]; // member is hashText(memberId)
}
export interface RepairRequest { type: 'repair'; member: number; firstMissingSeq: number }
export type FastMessage = StreamPacket | RepairRequest;

export function packFast(message: FastMessage): unknown[] {
  if (message.type === 'repair') return [7, message.member, message.firstMissingSeq];
  return [6, message.tick, message.sentAt, message.echoSentAt, message.hash, message.streams.map(s => [s.member, s.lastSeq, s.entries])];
}
export function unpackFast(value: unknown): FastMessage | undefined {
  if (!Array.isArray(value)) return;
  if (value[0] === 7) { return value.length === 3 && integer(value[1]) && integer(value[2]) && value[2] >= 1 ? { type: 'repair', member: value[1], firstMissingSeq: value[2] } : undefined; }
  if (value[0] !== 6 || value.length !== 6) return;
  const [, tick, sentAt, echoSentAt, hash, streams] = value;
  if (!finite(tick) || !finite(sentAt) || !(echoSentAt === null || finite(echoSentAt)) || !(hash === null || typeof hash === 'string' && /^[0-9a-f]{16}$/.test(hash)) || !Array.isArray(streams) || streams.length > MAX_STREAMS_PER_PACKET) return;
  const packet: StreamPacket = { type: 'streams', tick, sentAt, echoSentAt, hash, streams: [] };
  for (const raw of streams) {
    if (!Array.isArray(raw) || raw.length !== 3 || !integer(raw[0]) || !integer(raw[1]) || !Array.isArray(raw[2]) || raw[2].length > MAX_ENTRIES_PER_TICK || !raw[2].every(validEntry)) return;
    packet.streams.push({ member: raw[0], lastSeq: raw[1], entries: raw[2] });
  }
  return packet;
}
