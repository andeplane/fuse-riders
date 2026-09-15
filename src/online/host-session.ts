import { Simulation } from './rollback.js';
import { StreamSender } from './stream.js';
import { InputEdges } from './input-edges.js';
import { createReplayState, edgesFrom, replayHash, validEntry, type EntryBody, type LogEntry, type ReplayState } from '../shared/action-log.js';
import { BotController, BOT_ID_PREFIX, type BotDependencies } from '../shared/bot-controller.js';
import { createGame, toSnapshot, SLOT_COLORS, type GameState } from '../shared/game.js';
import { decodeCheckpoint, encodeCheckpoint, encodeGameState } from './checkpoint.js';
import { isAvatarId, type AvatarId } from '../shared/avatars.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import type { ControllerInputMessage } from '../client/controller-state.js';
import type { GameEvent } from '../shared/protocol.js';

export type RoomCommand =
  | { type: 'join'; name: string; avatarId?: AvatarId }
  | ({ type: 'input'; seq?: number } & Omit<ControllerInputMessage, 'type' | 'seq'>)
  | { type: 'avatar'; avatarId: AvatarId }
  | { type: 'action'; action: 'start' | 'lobby' | 'rematch' }
  | { type: 'settings'; settings: RoomSettings }
  | { type: 'bot'; action: 'add' | 'remove'; id?: string };
export interface HostDependencies { token: () => string; botRandom?: BotDependencies['random'] }
/** A guest's stream as the host tracks it: the guest's own numbering, deduplicated and kept contiguous before relay. */
interface Ingress { expected: number; buffered: Map<number, LogEntry> }
/** A stream's `state` is null while no entry of it has folded yet (a sender that only relays, or a restored host): the view must not invent one, the hash covers the map. */
export interface BaselineMessage { type: 'baseline'; rules: string; tick: number; game: string; pending: RoomSettings; streams: [member: string, folded: number, state: { flags: number; aim: { x: number; y: number } | null; gesture: number | null; bombs: unknown } | null, retained: LogEntry[]][]; hash: string }

/**
 * The creator's authority. It authors management and bot entries, folds every stream through the same rollback
 * core as every full view, relays guest streams under its own numbering, and never refuses input for timing.
 */
export class HostSession {
  sim: Simulation;
  readonly senders = new Map<string, StreamSender>();
  private readonly ingress = new Map<string, Ingress>();
  private readonly edges = new Map<string, InputEdges>();
  private readonly bots = new Set<string>();
  private readonly botController: BotController;
  private botGesture = 0;
  private pendingEvents: GameEvent[] = [];
  constructor(readonly hostId: string, public settings: RoomSettings, private readonly dependencies: HostDependencies) {
    this.sim = new Simulation(createReplayState(createGame(dependencies.token()), settings), hostId);
    this.botController = new BotController(dependencies.botRandom ? { random: dependencies.botRandom } : undefined);
  }
  get game(): GameState { return this.sim.state.game; }
  get tick(): number { return this.sim.tick; }
  botIds(): string[] { return [...this.bots]; }
  private sender(id: string): StreamSender { let s = this.senders.get(id); if (!s) { s = new StreamSender(); this.senders.set(id, s); } return s; }
  /** Authors an entry into a stream this host owns for the next tick; it applies on the next advance, like any other entry. */
  private author(id: string, body: EntryBody): LogEntry { const entry = this.sender(id).append(this.tick + 1, body); this.sim.insert(id, entry, true); return entry; }
  /** Joins authored for the next tick already claim their slot, so two quick commands never collide. */
  private pendingJoins(): { id: string; slot: number }[] {
    return this.sim.retained(this.hostId).filter(e => e[1] > this.tick && e[2] === 10).map(e => ({ id: e[3] as string, slot: e[5] as number }));
  }
  /** Members present now or joining at the next tick. */
  private known(id: string): boolean { return this.game.players.has(id) || this.pendingJoins().some(join => join.id === id); }
  private connectedCount(): number { const pending = this.pendingJoins().filter(join => !this.game.players.has(join.id)).length; return [...this.game.players.values()].filter(player => player.connected).length + pending; }
  /** Between rounds a disconnected rider's seat counts as free: the fold prunes it when the join applies. */
  private freeSlot(): number {
    const reclaimable = ['lobby', 'roundOver', 'matchOver'].includes(this.game.phase);
    const taken = new Set([...[...this.game.players.values()].filter(player => player.connected || !reclaimable).map(player => player.slot), ...this.pendingJoins().map(join => join.slot)]);
    return SLOT_COLORS.findIndex((_, slot) => !taken.has(slot));
  }
  command(memberId: string, raw: unknown): string | undefined {
    if (!raw || typeof raw !== 'object') return 'Invalid command';
    const command = raw as RoomCommand;
    if (command.type === 'bot') {
      if (memberId !== this.hostId) return 'Only the host can manage AI riders';
      if (command.action === 'add') {
        const slot = this.freeSlot(); if (slot < 0) return 'Room is full (5 players including AI)';
        if (this.game.leaderboard.size >= 128) return 'Start a fresh room before adding more riders';
        let number = 1; while (this.game.leaderboard.has(`${BOT_ID_PREFIX}${number}`) || this.known(`${BOT_ID_PREFIX}${number}`)) number++;
        const id = `${BOT_ID_PREFIX}${number}`, names = ['Ada', 'Turing', 'Hopper', 'Nova', 'Byte'];
        this.bots.add(id); this.author(this.hostId, [10, id, `AI ${names[slot]!}`, slot, 'robot']); return;
      }
      if (command.action === 'remove' && typeof command.id === 'string') {
        if (!this.bots.has(command.id)) return 'AI rider not found';
        if (!['lobby', 'roundOver', 'matchOver'].includes(this.game.phase)) return 'Remove AI between rounds or return to menu';
        this.bots.delete(command.id); this.author(this.hostId, [11, command.id]); return;
      }
      return 'Invalid AI command';
    }
    if (this.bots.has(memberId)) return 'AI riders are controlled by the host';
    if (command.type === 'join') {
      if (typeof command.name !== 'string' || !command.name.trim() || command.name.length > 20) return 'Choose a name (1–20 characters)';
      const existing = this.game.players.get(memberId);
      const slot = existing?.slot ?? this.pendingJoins().find(join => join.id === memberId)?.slot ?? this.freeSlot();
      if (slot < 0) return 'Room is full (5 players)';
      if (!existing && !this.game.leaderboard.has(memberId) && this.game.leaderboard.size >= 128) return 'Start a fresh room before adding more riders';
      this.author(this.hostId, [10, memberId, command.name.trim(), slot, isAvatarId(command.avatarId) ? command.avatarId : null]); return;
    }
    if (command.type === 'settings') {
      if (memberId !== this.hostId) return 'Only the host can change settings';
      const settings = parseRoomSettings(command.settings); if (!settings) return 'Invalid settings';
      this.settings = settings; this.author(this.hostId, [13, settings]); return;
    }
    if (command.type === 'action') {
      if (memberId !== this.hostId) return 'Only the host can manage the room';
      const connected = this.connectedCount();
      if (command.action === 'start') { if (this.game.phase !== 'lobby') return 'The race has already started'; if (connected < 2) return 'At least two riders are needed'; }
      else if (command.action === 'rematch') { if (this.game.phase !== 'matchOver') return 'The match is still running'; if (connected < 2) return 'At least two riders are needed'; }
      else if (command.action !== 'lobby') return 'Unknown action';
      this.author(this.hostId, [14, command.action, this.dependencies.token()]); return;
    }
    if (!this.known(memberId)) return 'Join before playing';
    if (command.type === 'avatar') { if (isAvatarId(command.avatarId)) this.author(memberId, [5, command.avatarId]); return; }
    if (command.type !== 'input') return 'Unknown command';
    if (typeof command.left !== 'boolean' || typeof command.right !== 'boolean' || typeof command.bomb !== 'boolean') return 'Invalid input';
    if (command.aim && (!Number.isFinite(command.aim.x) || !Number.isFinite(command.aim.y) || command.aim.x < 0 || command.aim.x > 1 || command.aim.y < 0 || command.aim.y > 1)) return 'Invalid aim';
    let edges = this.edges.get(memberId); if (!edges) { edges = new InputEdges(); this.edges.set(memberId, edges); }
    for (const body of edges.edges(command)) this.author(memberId, body);
    return;
  }
  /**
   * A guest's own entries over the network, in the guest's numbering. Contiguous ones are re-numbered into the host's
   * relay stream for that member and folded with the authority's clamp; a gap is buffered and reported for repair.
   */
  ingest(memberId: string, entries: readonly LogEntry[]): { firstMissing?: number } {
    if (!this.game.players.has(memberId) || this.bots.has(memberId) || memberId === this.hostId) return {};
    let ingress = this.ingress.get(memberId); if (!ingress) { ingress = { expected: 1, buffered: new Map() }; this.ingress.set(memberId, ingress); }
    for (const entry of entries) { if (!validEntry(entry) || entry[0] < ingress.expected || ingress.buffered.has(entry[0]) || ingress.buffered.size >= 256 || entry[2] >= 10) continue; ingress.buffered.set(entry[0], entry); }
    while (ingress.buffered.has(ingress.expected)) {
      const entry = ingress.buffered.get(ingress.expected)!; ingress.buffered.delete(ingress.expected); ingress.expected++;
      const [, tick, ...body] = entry;
      const stored = this.sender(memberId).append(tick, body as EntryBody);
      this.sim.insert(memberId, stored, true);
    }
    return ingress.buffered.size ? { firstMissing: ingress.expected } : {};
  }
  /** A member reconnected on a new connection: its stream numbering restarts at 1. */
  reconnect(memberId: string): void { this.ingress.delete(memberId); if (this.game.players.has(memberId)) this.author(this.hostId, [12, memberId, true]); }
  presence(memberId: string, connected: boolean): void { if (this.game.players.has(memberId) && this.game.players.get(memberId)!.connected !== connected) this.author(this.hostId, [12, memberId, connected]); }
  /** Between rounds a vanished member frees its seat; mid-round its seat waits, as before. */
  disconnect(memberId: string): void {
    if (this.bots.has(memberId) || !this.game.players.has(memberId)) return;
    this.ingress.delete(memberId); this.edges.delete(memberId);
    this.author(this.hostId, [12, memberId, false]);
    if (['lobby', 'roundOver', 'matchOver'].includes(this.game.phase)) this.author(this.hostId, [11, memberId]);
  }
  /** One tick: bots decide against the newest state and their edges become ordinary entries, then the fold advances. */
  advance(): GameEvent[] {
    const events = this.pendingEvents.splice(0);
    for (const id of this.bots) {
      if (!this.game.players.has(id)) continue;
      const s = this.sim.state.streams.get(id);
      const previous = { flags: s?.flags ?? 0, ...(s?.aim ? { aim: s.aim } : {}), ...(s?.gesture === undefined ? {} : { gesture: s.gesture }) };
      for (const body of edgesFrom(previous, this.botController.input(this.game, id), () => ++this.botGesture)) { const entry = this.sender(id).append(this.tick + 1, body); this.sim.insert(id, entry, true); }
    }
    const result = this.sim.advanceTo(this.tick + 1, event => events.push(event));
    if (result.status !== 'ok') throw new Error('The authority cannot fall behind its own ring');
    for (const sender of this.senders.values()) sender.retain(this.tick);
    return events;
  }
  snapshot() { return toSnapshot(this.game); }
  hash(): string { return replayHash(this.sim.state); }
  /** Everything a full view needs to join or resync: exact state, per-stream positions in relay numbering, and the retained windows. */
  baseline(forMember?: string): BaselineMessage {
    const state = this.sim.state;
    const streams: BaselineMessage['streams'] = [];
    for (const id of new Set([...state.streams.keys(), ...this.senders.keys()])) {
      if (id === forMember) continue;
      const s = state.streams.get(id), folded = this.sim.folded(id);
      streams.push([id, folded, s ? { flags: s.flags, aim: s.aim ?? null, gesture: s.gesture ?? null, bombs: s.bombs.toJSON() } : null, (this.senders.get(id)?.retained ?? []).filter(e => e[0] > folded)]);
    }
    return { type: 'baseline', rules: 'fuse-rollback-1', tick: this.tick, game: encodeGameState(state.game), pending: state.pending, streams, hash: this.hash() };
  }
  checkpoint(): string { return encodeCheckpoint(this.hostId, this.game, this.settings, [], this.bots); }
  /** Refresh recovery: the game and roster come back; every stream starts fresh, so held controls and charges do not. */
  restore(raw: string): boolean {
    const candidate = decodeCheckpoint(raw, this.hostId); if (!candidate) return false;
    const state: ReplayState = { game: candidate.game, pending: candidate.settings, streams: new Map() };
    this.sim = new Simulation(state, this.hostId); this.settings = candidate.settings;
    this.senders.clear(); this.ingress.clear(); this.edges.clear(); this.bots.clear(); for (const id of candidate.botIds) this.bots.add(id);
    this.pendingEvents = [];
    return true;
  }
}
