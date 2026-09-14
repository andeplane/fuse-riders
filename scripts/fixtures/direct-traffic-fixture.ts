import { RoomRuntime, type OnlineInput } from '../../src/online/runtime.js';
import { defaultRoomSettings } from '../../src/shared/room-settings.js';
import { unpackMessage } from '../../src/online/action-replication.js';
import type { ViewSnapshot } from '../../src/client/snapshot-stream.js';

interface Count { bytes: number; packets: number; maxBytes: number }
type Counts = Record<string, Count>;
export interface TrafficSnapshot {
  id: string; index: number; start: number; end: number; now: number;
  phase?: string; round?: number; tick?: number; players: number;
  outcome?: Pick<ViewSnapshot, 'leaderboard' | 'roundPlacements' | 'matchStats'>;
  diagnostics: RoomRuntime['replicationDiagnostics'];
  tx: Counts; rx: Counts; phases: { at: number; phase: string; round: number; tick: number }[];
  notices: { at: number; text: string }[]; acceptedInputs: number; rejectedInputs: number;
}
export interface TrafficFixture {
  ready(): boolean;
  begin(at: number): void;
  finish(at: number): void;
  snapshot(): TrafficSnapshot;
  stop(): void;
}
export interface TrafficWindow {
  startTraffic(code: string, token: string, index: number): void;
  traffic: TrafficFixture;
}

function classify(raw: unknown): string {
  if (Array.isArray(raw)) {
    if (typeof raw[2] === 'number') {
      if (raw[2] === 10 || raw[2] === 11) return 'heartbeat';
      if (raw[2] === 12) return 'pause';
      if (raw[2] === 8 || raw[2] === 9) return 'liveness';
      return raw.length === 4 ? 'receipt' : Array.isArray(raw[3]) && raw[3].length ? 'actions' : 'progress';
    }
    return `control:${String(raw[2])}`;
  }
  if (raw && typeof raw === 'object') {
    if ('data' in raw && 'incarnation' in raw) return classify(raw.data);
    if ('type' in raw) return String(raw.type);
  }
  return 'unclassified';
}

(globalThis as unknown as TrafficWindow).startTraffic = (code, token, index) => {
  let start = Infinity, end = Infinity, view: ViewSnapshot | undefined, sequence = 0, started = false;
  let acceptedInputs = 0, rejectedInputs = 0, lastInput = '';
  const tx: Counts = {}, rx: Counts = {}, phases: TrafficSnapshot['phases'] = [], notices: TrafficSnapshot['notices'] = [];
  const encoder = new TextEncoder();
  const count = (target: Counts, lane: string, data: unknown) => {
    const now = Date.now(); if (now < start || now >= end) return;
    let bytes: number, raw: unknown;
    if (typeof data === 'string') { bytes = encoder.encode(data).byteLength; try { raw = JSON.parse(data); } catch { raw = null; } }
    else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      bytes = buffer.byteLength; try { raw = unpackMessage(buffer); } catch { raw = null; }
    } else { throw new Error('Uncounted transport payload type'); }
    const key = `${lane}:${classify(raw)}`, entry = target[key] ??= { bytes: 0, packets: 0, maxBytes: 0 };
    entry.bytes += bytes; entry.packets++; entry.maxBytes = Math.max(entry.maxBytes, bytes);
  };
  // Browser measurement instrumentation: counts bytes accepted by native send and
  // delivered messages. These are application bytes, not SCTP/DTLS/IP wire bytes.
  const originalSend = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function(data: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>) {
    Reflect.apply(originalSend, this, [data]);
    count(tx, 'rtc', data);
  };
  const tracked = new WeakSet<RTCDataChannel>();
  const track = (channel: RTCDataChannel) => {
    if (tracked.has(channel)) return; tracked.add(channel);
    channel.addEventListener('message', event => count(rx, 'rtc', event.data));
  };
  const OriginalPeer = RTCPeerConnection;
  globalThis.RTCPeerConnection = class extends OriginalPeer {
    constructor(configuration?: RTCConfiguration) { super(configuration); this.addEventListener('datachannel', event => track(event.channel)); }
    override createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel { const channel = super.createDataChannel(label, options); track(channel); return channel; }
  };
  const OriginalSocket = WebSocket;
  globalThis.WebSocket = class extends OriginalSocket {
    constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); this.addEventListener('message', event => count(rx, 'ws', event.data)); }
    override send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void { super.send(data); count(tx, 'ws', data); }
  };
  const runtime = new RoomRuntime(code, token, { ...defaultRoomSettings(), match: 'rounds', length: 3 }, {
    ready: () => { if (index < 5) runtime.command({ type: 'join', name: `Rider ${index + 1}` }); },
    state: value => {
      if (view?.phase !== value.phase || view?.round !== value.round) phases.push({ at: Date.now(), phase: value.phase, round: value.round, tick: value.tick });
      view = value;
    }, event: () => {}, status: text => { notices.push({ at: Date.now(), text }); if (notices.length > 100) notices.shift(); },
    controlsReset: () => { lastInput = ''; },
  });
  const timer = setInterval(() => {
    if (Date.now() < start || Date.now() >= end) return;
    if (index === 0 && !started) { started = true; runtime.command({ type: 'action', action: 'start' }); }
    if (index === 5 || view?.phase !== 'playing' || runtime.replicationDiagnostics.barrier) return;
    const tick = view.tick, turn = (Math.floor(tick / 14) + index) % 5 === 0;
    const bomb = (tick + index * 7) % 40 < 3;
    const previous = lastInput ? JSON.parse(lastInput) as { bomb: boolean } : undefined;
    const controls = { left: turn && index % 2 === 0, right: turn && index % 2 === 1, bomb };
    const key = JSON.stringify(controls); if (key === lastInput) return;
    const input: OnlineInput = { type: 'input', seq: ++sequence, ...controls, ...(bomb !== (previous?.bomb ?? false) ? { bombAction: bomb ? 'press' : 'release' } : {}) };
    if (runtime.command(input)) { acceptedInputs++; lastInput = key; } else rejectedInputs++;
  }, 20);
  runtime.start();
  (globalThis as unknown as TrafficWindow).traffic = {
    ready: () => view?.phase === 'lobby' && view.players.length === 5 && !runtime.replicationDiagnostics.barrier && !runtime.replicationDiagnostics.fault && !runtime.replicationDiagnostics.recoveryRequired,
    begin: at => { start = at; }, finish: at => { end = at; },
    snapshot: () => ({ id: runtime.transport.id, index, start, end, now: Date.now(), phase: view?.phase, round: view?.round, tick: view?.tick, players: view?.players.length ?? 0, outcome: view ? { leaderboard: view.leaderboard, roundPlacements: view.roundPlacements, matchStats: view.matchStats } : undefined, diagnostics: runtime.replicationDiagnostics, tx, rx, phases, notices, acceptedInputs, rejectedInputs }),
    stop: () => { clearInterval(timer); runtime.stop(); },
  };
};
