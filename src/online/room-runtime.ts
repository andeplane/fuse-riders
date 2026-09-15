import { StatusNotices } from './status-notices.js';
import { TickClock } from './clock.js';
import { World, type Frame } from './rollback.js';
import { STALL_TICKS } from './rollback.js';
import { PACKET_ENTRIES } from './stream.js';
import { decodePacket, encodeNack, encodePacket, roomHash, wrapDelta, wrapMs, type Packet } from './packet.js';
import { SnapshotAssembler, decodeSnapshot, encodeSnapshot } from './snapshot.js';
import { presentWorld } from './prediction.js';
import { BOT_NAMES, RULES, createRoomState, freeSlot, reclaimable } from '../shared/apply-tick.js';
import { ACTION, AIM, AVATAR, BOT, CANCEL, JOIN, LEAVE, MAX_NAME_LENGTH, PRESENCE, PRESS, RELEASE, SETTINGS, STEER, quantizeAim } from '../shared/input-log.js';
import { isAvatarId, type AvatarId } from '../shared/avatars.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import { BOT_ID_PREFIX } from '../shared/bot-controller.js';
import type { AimPoint, GameEvent } from '../shared/protocol.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';

export type RoomCommand =
  | { type: 'join'; name: string; avatarId?: AvatarId }
  | { type: 'input'; seq: number; left: boolean; right: boolean; bomb: boolean; bombAction?: 'press' | 'release' | 'cancel'; aim?: AimPoint }
  | { type: 'avatar'; avatarId: AvatarId }
  | { type: 'action'; action: 'start' | 'lobby' | 'rematch' }
  | { type: 'settings'; settings: RoomSettings }
  | { type: 'bot'; action: 'add' | 'remove'; id?: string };
/** What the runtime needs from a transport; the WebRTC mesh and the test fake both provide it. */
export interface RoomTransport {
  readonly id: string; readonly hostId: string; readonly sentBytes: number;
  connect(): void; close(): void;
  send(id: string, data: unknown): boolean;
  sendFast(id: string, bytes: Uint8Array): boolean;
  linked(id: string): boolean;
  explain(id: string): string;
  stats(): Promise<{ direct: number; relayed: number; buffered: number }>;
}
export interface TransportEvents {
  welcome(id: string, hostId: string): void; peer(id: string, online: boolean): void; link(id: string, open: boolean): void;
  message(id: string, data: unknown): void; fast(id: string, bytes: Uint8Array): void; status(text: string): void;
  revoked(): void; ended(): void; terminated(text: string): void;
}
export interface RuntimeDependencies { now(): number; hidden(): boolean; token(): string; generation(): number; schedule(callback: () => void, intervalMs: number): () => void; onVisibilityChange(callback: () => void): () => void }
export interface Callbacks { state(frame: Frame, settings: RoomSettings): void; event(event: GameEvent, matchId: string, round: number, tick: number): void; status(text: string): void; ready(id: string, host: boolean): void; ended?(): void }
export interface RuntimeOptions { transport?: (events: TransportEvents) => RoomTransport; displayOnly?: boolean; humanName?: string; dependencies?: RuntimeDependencies }
interface Member { generation: number; lastPacketAt: number; lastSentAt: number; lastSentReceivedAt: number; rttMs?: number; full: boolean; nackAt: number; presence?: { connected: boolean; tick: number; at: number } }

export const DISCONNECT_MS = 1000, CREATOR_SILENCE_MS = 5000, LAG_INDICATOR_MS = 250, SNAPSHOT_RETRY_MS = 2000, SNAPSHOT_FAILURES = 3, JOIN_RETRY_MS = 1000;
export const HASH_INTERVAL = 20, HASH_LAG = 40, CATCHUP_TICKS = 8, BEHIND_TICKS = 60, NACK_INTERVAL_MS = 100, DIVERGENCE_WINDOW_MS = 60_000, DIVERGENCE_LIMIT = 3, FRESH_WORLD_WAIT_MS = 3000;
const browserDependencies: RuntimeDependencies = {
  now: () => performance.now(), hidden: () => document.hidden, token: () => crypto.randomUUID(), generation: () => Math.floor(Date.now() / 1000) >>> 0,
  schedule: (callback, ms) => { const timer = setInterval(callback, ms); return () => clearInterval(timer); },
  onVisibilityChange: callback => { document.addEventListener('visibilitychange', callback); return () => document.removeEventListener('visibilitychange', callback); },
};

/**
 * One runtime for solo and online play: every member simulates the shared log locally, sends one packet per tick to
 * every other member, and rolls back when a late entry changes history. The creator additionally logs the room's
 * management entries; any member can serve the world to a joiner.
 */
export class RoomRuntime {
  readonly transport?: RoomTransport;
  private readonly deps: RuntimeDependencies;
  private readonly status: StatusNotices;
  private readonly clock: TickClock;
  private readonly members = new Map<string, Member>();
  private readonly generation: number;
  private world?: World;
  private id = '';
  private hostId = '';
  private room = 0;
  private welcomeAt = -Infinity;
  private noWorld = new Set<string>();
  private held = { flags: -1, aim: undefined as [number, number] | undefined, aimTick: -1, active: 0, latest: 0 };
  private lastOwnTick = 0;
  private lastPacketTick = -1;
  private lastFrameTick = -1;
  private pendingJoin?: { name: string; avatarId?: AvatarId; sentAt: number };
  private snapshotRequest?: { to: string; at: number; failures: number };
  private assembler?: SnapshotAssembler;
  private mismatches: number[] = [];
  private outOfSync = false;
  private full = true;
  private hiddenState = false;
  private cancelTick?: () => void;
  private cancelVisibility?: () => void;
  constructor(readonly code: string, private readonly settings: RoomSettings, private readonly callbacks: Callbacks, private readonly options: RuntimeOptions = {}) {
    this.deps = options.dependencies ?? browserDependencies;
    this.status = new StatusNotices(() => this.deps.now(), text => callbacks.status(text));
    this.clock = new TickClock(() => this.deps.now());
    this.generation = this.deps.generation();
    if (options.transport) this.transport = options.transport({
      welcome: (id, hostId) => this.welcome(id, hostId), peer: (id, online) => this.peer(id, online), link: (id, open) => this.link(id, open),
      message: (id, data) => this.message(id, data), fast: (id, bytes) => this.fast(id, bytes), status: text => this.status.recurring(text),
      revoked: () => { this.halt(); this.status.terminal('This host tab was replaced — use the newer tab'); },
      ended: () => { this.halt(); this.callbacks.ended?.(); },
      terminated: text => { this.halt(); this.status.terminal(text); },
    });
  }
  get solo(): boolean { return !this.transport; }
  get creator(): boolean { return this.id !== '' && this.id === this.hostId; }
  get tick(): number { return this.world?.tick ?? 0; }
  start(): void {
    if (this.cancelTick) return;
    if (this.transport) this.transport.connect();
    else {
      this.id = this.hostId = 'solo'; this.room = roomHash('solo');
      this.createWorld({ ...this.settings, mode: 'devices', weights: { ...this.settings.weights } });
      this.callbacks.ready('solo', true); this.status.recurring('Solo · you and four AI riders');
      const name = this.options.humanName?.trim().slice(0, MAX_NAME_LENGTH) || 'You';
      this.join('solo', name, undefined);
      for (let index = 0; index < 4; index++) this.command({ type: 'bot', action: 'add' });
      this.command({ type: 'action', action: 'start' });
      this.world!.advance(this.lastOwnTick); // The first frame already seats everyone; the clock catches up within a tick.
      this.publish();
    }
    this.hiddenState = this.deps.hidden(); if (this.hiddenState && this.solo) this.clock.pause();
    this.cancelVisibility = this.deps.onVisibilityChange(() => this.visibilityChanged());
    this.cancelTick = this.deps.schedule(() => this.tickLoop(), 10);
  }
  stop(): void { this.halt(); this.transport?.close(); }
  private halt(): void { this.cancelTick?.(); this.cancelVisibility?.(); this.cancelTick = this.cancelVisibility = undefined; }

  // ---- transport events -------------------------------------------------------------------------------------------
  private welcome(id: string, hostId: string): void {
    this.id = id; this.hostId = hostId; this.room = roomHash(`${this.code}:${hostId}`); this.welcomeAt = this.deps.now(); this.noWorld.clear();
    if (!this.world) this.status.recurring(id === hostId ? 'Connected · preparing the room' : 'Connected · waiting for the game');
    this.callbacks.ready(id, id === hostId);
  }
  private peer(id: string, online: boolean): void {
    if (online) { if (!this.members.has(id)) this.members.set(id, { generation: 0, lastPacketAt: -Infinity, lastSentAt: 0, lastSentReceivedAt: 0, full: true, nackAt: -Infinity }); return; }
    this.members.delete(id); this.noWorld.delete(id);
    if (this.snapshotRequest?.to === id) this.snapshotRequest = undefined;
    if (this.creator && this.world?.state.game.players.has(id)) this.append(LEAVE, id);
  }
  private link(id: string, open: boolean): void {
    if (!open) return;
    this.transport!.send(id, { type: 'hello', generation: this.generation, full: this.full, rules: RULES });
    if (this.needsWorld() && !this.snapshotRequest) this.requestSnapshot(id);
    if (this.pendingJoin && id === this.hostId) this.sendJoin();
  }
  private message(id: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const data = raw as { type?: unknown; generation?: unknown; full?: unknown; rules?: unknown; name?: unknown; avatarId?: unknown; error?: unknown };
    const member = this.members.get(id); if (!member) return;
    switch (data.type) {
      case 'hello':
        if (data.rules !== RULES) { this.status.notice('A rider is on a different game version — everyone should reload'); return; }
        if (typeof data.generation === 'number' && Number.isSafeInteger(data.generation) && data.generation >= 0) this.bump(id, member, data.generation);
        member.full = data.full === true; return;
      case 'join': if (this.creator && typeof data.name === 'string') { const error = this.join(id, data.name, isAvatarId(data.avatarId) ? data.avatarId : undefined); if (error) this.transport!.send(id, { type: 'error', error }); } return;
      case 'snapshotRequest': if (this.world) { for (const chunk of encodeSnapshot(this.world, this.room)) this.transport!.send(id, chunk); } else this.transport!.send(id, { type: 'noWorld' }); return;
      case 'noWorld': this.noWorld.add(id); return;
      case 'snapshot': this.acceptSnapshotChunk(id, raw); return;
      case 'error': if (typeof data.error === 'string') this.status.notice(data.error.slice(0, 120)); return;
      default: return;
    }
  }
  private fast(id: string, bytes: Uint8Array): void {
    const decoded = decodePacket(bytes), member = this.members.get(id); if (!decoded || !member) return;
    const now = this.deps.now();
    if ('nack' in decoded) {
      if (decoded.nack.room !== this.room || decoded.nack.from !== id || !this.world) return;
      const entries = this.own().repairEntries(decoded.nack.firstMissingSeq);
      if (entries.length) this.sendPacket(id, member, entries, now);
      return;
    }
    const packet = decoded.packet;
    if (packet.room !== this.room || packet.from !== id) return;
    if (packet.generation < member.generation) return;
    this.bump(id, member, packet.generation);
    member.lastPacketAt = now; member.lastSentAt = packet.sentAt; member.lastSentReceivedAt = now;
    if (packet.echoSentAt !== 0) {
      const rtt = wrapDelta(wrapMs(now), packet.echoSentAt) - packet.echoHeld;
      if (rtt >= 0 && rtt < 10_000) { member.rttMs = rtt; if (id === this.authority()) this.clock.sample(packet.clockTick, rtt); }
    }
    if (!this.world) return;
    const result = this.world.receive(id, packet.entries, packet.lastSeq, packet.through, Math.floor(this.clock.tick()));
    if (result.status === 'unrepairable') { this.requestSnapshot(); return; }
    if (result.status === 'invalid') return;
    if (result.rollbackTicks > 0) this.lastFrameTick = -1;
    for (const event of result.events) this.callbacks.event(event.event, event.matchId, event.round, event.tick);
    const stream = this.world.streams.get(id);
    if (stream?.gap && now - member.nackAt >= NACK_INTERVAL_MS) { member.nackAt = now; this.transport!.sendFast(id, encodeNack({ room: this.room, from: this.id, firstMissingSeq: stream.firstMissing()! })); }
    if (packet.hash && id === this.authority()) this.compareHash(packet.hash[0], packet.hash[1], now);
    if (result.rollbackTicks > 0) this.publish();
  }
  private bump(id: string, member: Member, generation: number): void {
    if (generation > member.generation) member.generation = generation;
    this.ensureStream(id, member);
  }
  /** Every known member with a generation has a stream in the world, whichever of hello, packet or snapshot came first. */
  private ensureStream(id: string, member: Member): void {
    if (!this.world || member.generation === 0) return;
    const existing = this.world.streams.get(id);
    if (existing && existing.generation === member.generation) return;
    this.world.stream(id, member.generation, { seq: 0, tick: Math.max(0, this.world.tick - STALL_TICKS) });
    if (this.creator) this.ensurePresence(id, member);
  }

  // ---- world lifecycle --------------------------------------------------------------------------------------------
  private needsWorld(): boolean { return !this.world && this.id !== ''; }
  private createWorld(settings: RoomSettings): void {
    this.world = new World(createRoomState(this.deps.token(), settings), this.hostId, this.id);
    this.world.stream(this.id, this.generation);
    this.clock.start(0); this.lastOwnTick = 0; this.resetHeld();
    this.status.recurring(this.solo ? 'Solo · you and four AI riders' : 'Connected · direct game link');
    if (this.pendingJoin) this.sendJoin();
  }
  private requestSnapshot(preferred?: string): void {
    if (!this.transport) return;
    const linked = [...this.members.keys()].filter(id => this.transport!.linked(id)).sort();
    if (!linked.length) return;
    const authority = this.authority();
    const previous = this.snapshotRequest?.to, next = linked[(linked.indexOf(previous ?? '') + 1) % linked.length]!;
    const to = preferred && linked.includes(preferred) ? preferred : authority !== this.id && linked.includes(authority) && previous !== authority ? authority : next;
    this.snapshotRequest = { to, at: this.deps.now(), failures: this.snapshotRequest?.failures ?? 0 };
    this.assembler = new SnapshotAssembler(this.room);
    this.transport.send(to, { type: 'snapshotRequest' });
  }
  private acceptSnapshotChunk(id: string, raw: unknown): void {
    if (!this.snapshotRequest || this.snapshotRequest.to !== id || !this.assembler) return;
    const complete = this.assembler.accept(raw); if (!complete) return;
    const decoded = decodeSnapshot(complete.bytes, this.room);
    if (!decoded) { this.snapshotRequest.failures++; this.requestSnapshot(); return; }
    const tick = decoded.state.game.tick;
    if (this.world) this.world.install(decoded.state); else this.world = new World(decoded.state, this.hostId, this.id);
    for (const stream of decoded.streams) {
      if (stream.id === this.id) continue;
      const log = this.world.stream(stream.id, stream.generation, { seq: stream.seq, tick, gesture: stream.gesture });
      const member = this.members.get(stream.id); if (member && member.generation < stream.generation) member.generation = stream.generation;
      for (let offset = 0; offset < stream.entries.length; offset += PACKET_ENTRIES) { const part = stream.entries.slice(offset, offset + PACKET_ENTRIES); log.receive(part, part.at(-1)![0], tick, tick + 60, tick); }
    }
    this.world.stream(this.id, this.generation, { seq: 0, tick });
    for (const [id, member] of this.members) this.ensureStream(id, member);
    this.lastOwnTick = tick + 1; this.resetHeld(); this.lastFrameTick = -1; this.lastPacketTick = -1;
    // A clock with no samples yet (the returning creator, or a joiner ahead of its first echo) starts from the snapshot
    // tick plus half the request round trip: the sender took it when the request arrived.
    if (!this.clock.started) this.clock.start(tick + (this.deps.now() - this.snapshotRequest.at) / 2 / 50);
    this.snapshotRequest = undefined; this.assembler = undefined; this.noWorld.clear();
    this.status.recurring('Connected · direct game link');
    if (this.pendingJoin) this.sendJoin();
    this.publish();
  }
  private compareHash(tick: number, hash: string, now: number): void {
    if (!this.world || [...this.world.streams.values()].some(stream => stream.gap)) return;
    const mine = this.world.hashAt(tick); if (mine === undefined || mine === hash) return;
    console.warn(`fuse-riders: simulation diverged at tick ${tick}: local ${mine}, authority ${hash}`);
    this.mismatches = this.mismatches.filter(at => now - at <= DIVERGENCE_WINDOW_MS); this.mismatches.push(now);
    if (this.mismatches.length >= DIVERGENCE_LIMIT) { this.outOfSync = true; this.status.notice('Simulation out of sync — reload this page'); return; }
    this.status.transient('Simulation corrected · resyncing'); this.requestSnapshot();
  }

  // ---- the creator's management duties -----------------------------------------------------------------------------
  private join(from: string, rawName: string, avatarId: AvatarId | undefined): string | undefined {
    if (!this.world) return 'The room is still loading';
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
    if (!name || /[ -]/.test(name)) return 'Choose a name (1–20 characters)';
    const game = this.world.state.game, member = from === this.id ? undefined : this.members.get(from);
    const generation = from === this.id ? this.generation : member?.generation;
    if (generation === undefined) return 'Reconnect before joining';
    if (game.players.has(from)) { if (from === this.id) this.ensurePresence(from, this.selfMember()); else this.ensurePresence(from, member!); return; }
    if (this.pending().ids.has(from)) return;
    const slot = this.claimSlot(); if (slot < 0) return 'Room is full (5 players)';
    this.append(JOIN, from, name, slot, avatarId ?? 'fox', generation);
    return;
  }
  /** Own management entries logged but not yet applied: seats they will take or free when their tick arrives. */
  private pending(): { slots: Set<number>; freed: Set<string>; ids: Set<string>; seats: number } {
    const slots = new Set<number>(), freed = new Set<string>(), ids = new Set<string>(); let seats = 0;
    for (const entry of this.own().entries.values()) {
      if (entry[1] <= this.world!.tick) continue;
      if (entry[2] === JOIN && !this.world!.state.game.players.has(entry[3])) { slots.add(entry[5]); ids.add(entry[3]); seats++; }
      else if (entry[2] === BOT && entry[3] === 'add') { slots.add(entry[6]); ids.add(entry[4]); seats++; }
      else if (entry[2] === LEAVE) { freed.add(entry[3]); seats--; }
    }
    return { slots, freed, ids, seats };
  }
  /** A free seat, freeing a disconnected rider's seat between rounds first. */
  private claimSlot(): number {
    const game = this.world!.state.game, pending = this.pending();
    const taken = new Set([...[...game.players.values()].filter(player => !pending.freed.has(player.id)).map(player => player.slot), ...pending.slots]);
    const free = [0, 1, 2, 3, 4].find(slot => !taken.has(slot));
    if (free !== undefined || !reclaimable(game)) return free ?? -1;
    const seat = [...game.players.values()].find(player => !player.connected && !pending.freed.has(player.id)); if (!seat) return -1;
    this.append(LEAVE, seat.id); return seat.slot;
  }
  private selfMember(): Member { return { generation: this.generation, lastPacketAt: this.deps.now(), lastSentAt: 0, lastSentReceivedAt: 0, full: this.full, nackAt: 0 }; }
  private ensurePresence(id: string, member: Member): void {
    const player = this.world?.state.game.players.get(id); if (!player || member.generation === 0 && id !== this.id) return;
    const fold = this.world!.state.folds.get(id);
    if (player.connected && fold?.generation === member.generation) return;
    this.logPresence(id, member, true);
  }
  private logPresence(id: string, member: Member, connected: boolean): void {
    const now = this.deps.now(), pending = member.presence;
    if (pending && pending.connected === connected && (this.world!.tick < pending.tick || now - pending.at < 500)) return;
    const tick = this.append(PRESENCE, id, connected, member.generation);
    member.presence = { connected, tick, at: now };
  }
  private creatorDuties(now: number): void {
    const game = this.world!.state.game;
    for (const [id, member] of this.members) {
      const player = game.players.get(id); if (!player) continue;
      const live = now - member.lastPacketAt <= DISCONNECT_MS;
      if (player.connected && !live) this.logPresence(id, member, false);
      else if (!player.connected && live) this.ensurePresence(id, member);
    }
    const self = game.players.get(this.id);
    if (self && !self.connected) this.ensurePresence(this.id, this.selfMember());
  }
  /** While the creator is silent for five seconds the lowest connected rider marks it absent so play can continue. */
  private actingCreatorDuties(now: number): void {
    const game = this.world!.state.game, host = game.players.get(this.hostId), member = this.members.get(this.hostId);
    if (!host?.connected || (member && now - member.lastPacketAt <= CREATOR_SILENCE_MS)) return;
    const candidates = [...game.players.values()].filter(player => player.connected && !this.world!.state.bots.has(player.id) && player.id !== this.hostId && (player.id === this.id || (this.members.get(player.id) && now - this.members.get(player.id)!.lastPacketAt <= DISCONNECT_MS))).map(player => player.id).sort();
    if (candidates[0] !== this.id) return;
    this.logPresence(this.hostId, member ?? this.selfMember(), false);
  }

  // ---- own entries --------------------------------------------------------------------------------------------------
  private own() { return this.world!.streams.get(this.id)!; }
  private ownTick(): number { this.lastOwnTick = Math.max(Math.floor(this.clock.tick()) + 1, this.lastOwnTick); return this.lastOwnTick; }
  private append(...body: unknown[]): number { const tick = this.ownTick(); this.own().append(tick, body); this.lastPacketTick = -1; return tick; }
  private resetHeld(): void { this.held = { flags: -1, aim: undefined, aimTick: -1, active: 0, latest: 0 }; }
  private player() { return this.world?.state.game.players.get(this.id); }
  command(command: RoomCommand): boolean {
    if (!command || typeof command !== 'object') return false;
    if (command.type === 'join') {
      if (this.options.displayOnly) return false;
      this.pendingJoin = { name: command.name, avatarId: command.avatarId, sentAt: -Infinity };
      if (this.creator || this.solo) return this.sendJoin();
      this.sendJoin(); return true;
    }
    if (!this.world) { this.status.notice('Waiting for the game to load'); return false; }
    if (command.type === 'input') return this.input(command);
    if (command.type === 'avatar') { if (!isAvatarId(command.avatarId) || !this.player()) return false; this.append(AVATAR, command.avatarId); this.sendPackets(this.deps.now()); return true; }
    if (!this.creator) { this.status.notice('Only the host can manage the room'); return false; }
    const game = this.world.state.game;
    if (command.type === 'settings') { const settings = parseRoomSettings(command.settings); if (!settings) { this.status.notice('Invalid settings'); return false; } this.append(SETTINGS, this.solo ? { ...settings, mode: 'devices' } : settings); return true; }
    if (command.type === 'action') {
      const connected = [...game.players.values()].filter(player => player.connected).length + this.pending().seats;
      if (command.action === 'start' && (game.phase !== 'lobby' || connected < 2)) { this.status.notice(game.phase !== 'lobby' ? 'A match is already running' : 'Two riders are needed to start'); return false; }
      if (command.action === 'rematch' && (game.phase !== 'matchOver' || connected < 2)) { this.status.notice('Rematch is available after the match ends'); return false; }
      if (!['start', 'rematch', 'lobby'].includes(command.action)) return false;
      this.append(ACTION, command.action, this.deps.token()); return true;
    }
    if (command.type === 'bot') {
      if (command.action === 'add') {
        const slot = this.claimSlot(); if (slot < 0) { this.status.notice('Room is full (5 players including AI)'); return false; }
        const pending = this.pending(); let number = 1; while (game.leaderboard.has(`${BOT_ID_PREFIX}${number}`) || pending.ids.has(`${BOT_ID_PREFIX}${number}`)) number++;
        this.append(BOT, 'add', `${BOT_ID_PREFIX}${number}`, `AI ${BOT_NAMES[slot]}`, slot); return true;
      }
      if (typeof command.id !== 'string' || !this.world.state.bots.has(command.id)) { this.status.notice('AI rider not found'); return false; }
      if (!reclaimable(game)) { this.status.notice('Remove AI between rounds or return to menu'); return false; }
      this.append(BOT, 'remove', command.id); return true;
    }
    return false;
  }
  private sendJoin(): boolean {
    const join = this.pendingJoin; if (!join) return false;
    join.sentAt = this.deps.now();
    if (this.creator || this.solo) { if (!this.world) return true; const error = this.join(this.id, join.name, join.avatarId); if (error) { this.status.notice(error); this.pendingJoin = undefined; return false; } return true; }
    return this.transport!.send(this.hostId, { type: 'join', name: join.name, avatarId: join.avatarId });
  }
  /** Edge-filtered: an unchanged frame produces no entry; each press is a new gesture in the log. */
  private input(command: Extract<RoomCommand, { type: 'input' }>): boolean {
    if (!this.player() || this.hiddenState) return false;
    const flags = (command.left ? 1 : 0) | (command.right ? 2 : 0);
    if (flags !== this.held.flags) { this.append(STEER, flags); this.held.flags = flags; }
    const aim = command.aim ? quantizeAim(command.aim) : undefined;
    if (command.bombAction === 'press') { this.held.active = ++this.held.latest; this.append(PRESS, this.held.active); this.held.aim = undefined; }
    if (aim && this.held.active && command.bombAction !== 'release' && (!this.held.aim || this.held.aim[0] !== aim[0] || this.held.aim[1] !== aim[1]) && this.held.aimTick !== this.lastOwnTick) { this.held.aimTick = this.append(AIM, aim[0], aim[1]); this.held.aim = aim; }
    if (command.bombAction === 'release' && this.held.active) { this.append(RELEASE, this.held.active, ...(aim ?? [])); this.held.active = 0; this.held.aim = undefined; }
    if (command.bombAction === 'cancel' && this.held.active) { this.append(CANCEL, this.held.active); this.held.active = 0; this.held.aim = undefined; }
    if (this.lastPacketTick === -1) this.sendPackets(this.deps.now());
    return true;
  }

  // ---- cadence ----------------------------------------------------------------------------------------------------
  private authority(): string {
    if (this.creator || this.members.has(this.hostId)) return this.hostId;
    const now = this.deps.now();
    return [this.id, ...[...this.members].filter(([, member]) => now - member.lastPacketAt <= CREATOR_SILENCE_MS).map(([id]) => id)].sort()[0]!;
  }
  private visibilityChanged(): void {
    const hidden = this.deps.hidden(); if (hidden === this.hiddenState) return;
    this.hiddenState = hidden;
    if (hidden) {
      if (this.world && this.player()) { if (this.held.flags > 0) { this.append(STEER, 0); this.held.flags = 0; } if (this.held.active) { this.append(CANCEL, this.held.active); this.held.active = 0; } }
      // Solo freezes the clock, so the released controls are folded in now rather than when the tab returns.
      if (this.solo && this.world) { this.world.advance(this.lastOwnTick); this.clock.pause(); this.publish(); }
      return;
    }
    if (this.solo) this.clock.resume();
    else if (this.world && Math.floor(this.clock.tick()) - this.world.tick > BEHIND_TICKS) this.requestSnapshot();
  }
  private tickLoop(): void {
    const now = this.deps.now();
    this.status.refresh();
    if (this.transport && this.id === '') return;
    if (this.needsWorld()) {
      if (this.creator && this.transport && !this.snapshotRequest) {
        const linked = [...this.members.keys()].filter(id => this.transport!.linked(id));
        const nobodyHasIt = linked.length > 0 && linked.every(id => this.noWorld.has(id));
        if (this.members.size === 0 || nobodyHasIt || now - this.welcomeAt > FRESH_WORLD_WAIT_MS) { this.createWorld(this.settings); this.publish(); }
      }
      if (this.snapshotRequest && now - this.snapshotRequest.at > SNAPSHOT_RETRY_MS) this.retrySnapshot();
      else if (!this.snapshotRequest && !this.creator && now - this.welcomeAt > SNAPSHOT_RETRY_MS) this.status.recurring(`Waiting for the game — ${this.transport!.explain(this.hostId)}`);
      if (this.pendingJoin && now - this.pendingJoin.sentAt > JOIN_RETRY_MS) this.sendJoin();
      return;
    }
    const world = this.world!, tick = Math.floor(this.clock.tick());
    if (this.snapshotRequest && now - this.snapshotRequest.at > SNAPSHOT_RETRY_MS) this.retrySnapshot();
    this.own().through = Math.max(this.own().through, tick);
    if (!this.hiddenState && tick > world.tick) {
      if (this.transport && tick - world.tick > BEHIND_TICKS && this.members.size > 0) { if (!this.snapshotRequest) this.requestSnapshot(); }
      else {
        const result = world.advance(Math.min(tick, world.tick + CATCHUP_TICKS));
        for (const event of result.events) this.callbacks.event(event.event, event.matchId, event.round, event.tick);
        if (result.waitingFor !== undefined) this.status.recurring(`Waiting for ${result.waitingFor}`);
        else if (!this.outOfSync) this.status.recurring(this.solo ? 'Solo · you and four AI riders' : this.lagging(now));
      }
    }
    if (this.transport) {
      if (this.creator) this.creatorDuties(now); else this.actingCreatorDuties(now);
      const player = this.player();
      if (player && !player.connected && this.held.flags !== -1) this.resetHeld();
      if (this.pendingJoin) { if (player?.connected) this.pendingJoin = undefined; else if (now - this.pendingJoin.sentAt > JOIN_RETRY_MS) this.sendJoin(); }
      const full = this.options.displayOnly === true || world.state.settings.mode !== 'shared' || !player;
      if (full !== this.full) { this.full = full; for (const id of this.members.keys()) if (this.transport.linked(id)) this.transport.send(id, { type: 'hello', generation: this.generation, full, rules: RULES }); }
      if (tick !== this.lastPacketTick) this.sendPackets(now);
      for (const [id, member] of this.members) { const stream = world.streams.get(id); if (stream?.gap && now - member.nackAt >= NACK_INTERVAL_MS && this.transport.linked(id)) { member.nackAt = now; this.transport.sendFast(id, encodeNack({ room: this.room, from: this.id, firstMissingSeq: stream.firstMissing()! })); } }
    }
    this.publish();
  }
  private lagging(now: number): string {
    const game = this.world!.state.game;
    for (const [id, member] of this.members) { const player = game.players.get(id); if (player?.connected && now - member.lastPacketAt > LAG_INDICATOR_MS && member.lastPacketAt !== -Infinity) return `Connected · ${player.name} lagging`; }
    if (game.settings?.mode === 'shared' && !this.full && ![...this.members.values()].some(member => member.full && now - member.lastPacketAt <= DISCONNECT_MS)) return 'Waiting for a display';
    return 'Connected · direct game link';
  }
  private retrySnapshot(): void {
    const request = this.snapshotRequest!; request.failures++;
    if (request.failures >= SNAPSHOT_FAILURES) this.status.notice('Could not load the game — reload this page');
    this.requestSnapshot();
  }
  private sendPackets(now: number): void {
    if (!this.transport || !this.world) return;
    const tick = Math.floor(this.clock.tick()); this.lastPacketTick = tick;
    const entries = this.own().packetEntries();
    for (const [id, member] of this.members) this.sendPacket(id, member, entries, now, tick);
  }
  private sendPacket(id: string, member: Member, entries: Packet['entries'], now: number, tick = Math.floor(this.clock.tick())): void {
    const hash = tick % HASH_INTERVAL === 0 ? this.world!.hashAt(tick - HASH_LAG) : undefined;
    const packet: Packet = { room: this.room, from: this.id, generation: this.generation, through: Math.max(this.own().through, tick), lastSeq: this.own().lastSeq, entries, sentAt: wrapMs(now),
      echoSentAt: member.lastSentAt, echoHeld: member.lastSentAt ? Math.max(0, Math.round(now - member.lastSentReceivedAt)) >>> 0 : 0, clockTick: Math.max(0, this.clock.tick()), hash: hash === undefined ? null : [tick - HASH_LAG, hash] };
    try { this.transport!.sendFast(id, encodePacket(packet)); } catch { /* An oversized packet is a bug in retention, never a crash. */ }
  }
  private publish(): void {
    const frame = this.world?.view()[0]; if (!frame || frame.tick === this.lastFrameTick) return;
    this.lastFrameTick = frame.tick; this.callbacks.state(frame, this.world!.state.settings);
  }
  /** The frame to draw now: one tick behind the clock, the local rider led by its held controls. */
  view(): ViewSnapshot | undefined {
    const frames = this.world?.view(); if (!frames?.length) return undefined;
    const [newer, older] = frames, clock = this.clock.tick(), presentation = Math.max(older?.tick ?? newer.tick, Math.min(newer.tick, clock - 1));
    const player = this.player(), controls = { left: (this.held.flags & 1) === 1, right: (this.held.flags & 2) === 2 };
    return presentWorld(older, newer, presentation, player && this.held.flags >= 0 ? { id: this.id, controls, lead: Math.max(0, Math.min(1, clock - presentation)) } : undefined);
  }
  metrics(): { tick: number; clockTick: number; rollbacks: number; rollbackTicks: number; rtt: Record<string, number>; clock: ReturnType<TickClock['diagnostics']>; sentBytes: number; snapshotRequest: boolean; mismatches: number } {
    return { tick: this.tick, clockTick: this.clock.tick(), rollbacks: this.world?.rollbacks ?? 0, rollbackTicks: this.world?.rollbackTicks ?? 0, rtt: Object.fromEntries([...this.members].filter(([, member]) => member.rttMs !== undefined).map(([id, member]) => [id, member.rttMs!])), clock: this.clock.diagnostics(), sentBytes: this.transport?.sentBytes ?? 0, snapshotRequest: this.snapshotRequest !== undefined, mismatches: this.mismatches.length };
  }
}
