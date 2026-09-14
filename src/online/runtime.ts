import { canonical, type GameOperation } from '../shared/action-log.js';
import { DIRECT_RULES, uint32 } from '../shared/direct-input.js';
import { createGame, RIDER_SPEED, RIDER_TURN_RATE, toSnapshot } from '../shared/game.js';
import { BotController, BOT_ID_PREFIX } from '../shared/bot-controller.js';
import { advanceRiderPose } from '../shared/rider-motion.js';
import { drunkHeadingOffset } from '../shared/drunk.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import type { GameEvent } from '../shared/protocol.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import type { AppliedMotionState, TickClockSample } from './prediction-contract.js';
import type { RoomCommand } from './host-session.js';
import { PeerTransport, type TransportCallbacks } from './peer-transport.js';
import { StatusNotices } from './status-notices.js';
import { CHECKPOINT_CHUNK_BYTES } from './link-send-gate.js';
import { DirectSegment } from './direct-segment.js';
import { RollbackWorld, type CommittedEvent } from './rollback-world.js';
import { canReuseBase, catalog, catalogView, deriveTransition, initialWorld, isCatalog, isPlan, isPreparation, isPreparationAck, isView, isThinView, manager, neutral, ownersFor, prepareWorld, record, referencePreparation, reuseWorld, thinSnapshot, transitionBytes, type LobbyCatalog, type Preparation, type RoomPlan } from './direct-room-state.js';

export interface Callbacks { controlsReset?:()=>void;shotFailed?:()=>void;state:(snapshot:ViewSnapshot,settings:RoomSettings,ack:number,matchId:string,motion?:AppliedMotionState)=>void;clock?:(sample:TickClockSample)=>void;event:(event:GameEvent,matchId:string,round:number,tick:number)=>void;status:(text:string)=>void;ready:(id:string,host:boolean)=>void;ended?:()=>void }
export type OnlineInput = Omit<Extract<RoomCommand, { type: 'input' }>, 'scope' | 'intendedTick' | 'resultAcks'>;
type Management = Exclude<RoomCommand, { type: 'input' }>;
interface PendingCommand { request: number; command: Management; expires: number; sent: number }
interface Incoming { header: Preparation; needsPayload: boolean; at: number; buffer?: Uint8Array; received: number; candidate?: Uint8Array; ready: boolean; activated: boolean; lastAck: number }
interface Outgoing { header: Preparation; payload: Uint8Array; at: number; peers: Map<string, { header: boolean; needsPayload?: boolean; offset: number; ready: boolean; applied: boolean; nextHeader: number; lastMeta: number; lastChunk: number }>; activating: boolean;nextPeer:number }

export type RuntimeTransport = Pick<PeerTransport, 'id' | 'hostId' | 'connectionId' | 'grant' | 'sentBytes' | 'fastSentBytes' | 'binarySentBytes' | 'connectionOf' | 'members' | 'authorityPermitted' | 'connect' | 'close' | 'send' | 'sendCheckpoint' | 'bindFast' | 'boundReady' | 'sendFast' | 'sendPulse' | 'activatePulse' | 'deactivatePulse' | 'sendBound' | 'stats' | 'diagnostics'>;
export interface RuntimeEnvironment {
  now(): number;
  hidden(): boolean;
  display: boolean;
  randomId(): string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  schedule(callback: () => void): () => void;
  transport(callbacks: TransportCallbacks): RuntimeTransport;
}
function browserEnvironment(code: string, token: string): RuntimeEnvironment {
  return { now: () => performance.now(), hidden: () => document.hidden, display: new URLSearchParams(location.search).has('display'), randomId: () => crypto.randomUUID(), storage: localStorage,
    schedule: callback => { const timer = setInterval(callback, 10); return () => clearInterval(timer); }, transport: callbacks => new PeerTransport(code, token, callbacks, { mesh: true }) };
}
/** Online gameplay uses one direct action protocol; HostSession is only a transient management validator. */
export class RoomRuntime {
  readonly transport: RuntimeTransport;
  private readonly display: boolean;
  private readonly status: StatusNotices;
  private plan?: RoomPlan;
  private lobby: LobbyCatalog;
  private roles = new Map<string, { connection: string; display: boolean }>();
  private planCounter = 0;
  private planDelivery = new Map<string, { acknowledged: boolean; sentAt: number }>();
  private requestCounter = 0;
  private requestedPlans = new Map<string, number>();
  private pendingPlan?: { request: number; settings: RoomSettings; sent: number; at: number };
  private commands = new Map<string, PendingCommand>();
  private acceptedCommands = new Map<string, number>();
  private localCommand?: PendingCommand;
  private segment?: DirectSegment;
  private segmentPlan?: RoomPlan;
  private incoming?: Incoming;
  private outgoing?: Outgoing;
  private change?: { base: RollbackWorld; ops: GameOperation[]; settings: RoomSettings };
  private applied = new Set<string>();
  private startAt?: number;
  private faultPending?: string;
  private corruptionPending = false;
  private recoveryRequired = false;
  private recovering = false;
  private recoveryRequest?: { revision: number; peer: string; at: number; sent: number };
  private lastFault?: string;
  private recoveries: number[] = [];
  private recoveryEpisodeAt?: number;
  private attemptAt?: number;
  private coordinatorPauseAt?: number;
  private settledPlan?: RoomPlan;
  private chargedCorruption?: string;
  private lastRecovery = -Infinity;
  private lastHello = -Infinity;
  private lastStatus = -Infinity;
  private lastPublish = '';
  private statusKeys = new Map<string, string>();
  private statusRevision = 0;
  private acceptedStatus = -1;
  private acceptedStatusTick = 0;
  private acceptedStatusRound = 0;
  private view?: ViewSnapshot;
  private rendered?: ViewSnapshot;
  private matchId = '';
  private lastBotTick = -1;
  private readonly bots = new BotController();
  private localInput?: OnlineInput;
  private controlsRound = 0;
  private cancelSchedule?: () => void;
  private stopped = false;
  constructor(private readonly code: string, token: string, settings: RoomSettings, private readonly callbacks: Callbacks, private readonly environment: RuntimeEnvironment = browserEnvironment(code, token)) {
    this.display = environment.display;
    this.status = new StatusNotices(() => this.environment.now(), text => callbacks.status(text));
    this.lobby = catalog(createGame(this.environment.randomId()), settings);
    this.transport = environment.transport({
      welcome: (id, host) => {
        this.roles.set(id, { connection: this.transport.connectionId, display: this.display });
        if (id === host && !this.segment) {
          try { const saved: unknown = JSON.parse(this.environment.storage.getItem(`fuse-direct-room-${code}`) ?? 'null');
            if (record(saved) && isCatalog(saved.catalog)) { this.lobby = saved.catalog; if (isView(saved.status)) { this.view = saved.status; this.matchId = this.lobby.matchId; this.recoveryRequired = saved.status.phase !== 'lobby'; } }
          } catch { /* A damaged local cache cannot become a live simulation. */ }
        }
        callbacks.ready(id, id === host);
        if (this.recoveryRequired) { this.publish(); this.status.notice('Game recovery needs a fresh lobby — choose MAIN MENU'); }
        else if (id === host) this.issuePlan(this.lobby.settings);
        this.lastHello = -Infinity;
      },
      peer: (id, online) => {
        if (!online || this.plan?.members.some(m => m.id === id && m.connection !== this.transport.connectionOf(id))) { this.acceptedCommands.delete(id); this.requestedPlans.delete(id); this.commands.delete(id); }
        if (!online) this.roles.delete(id);
        if (this.plan && this.plan.members.some(m => m.id === id && (!online || m.connection !== this.transport.connectionOf(id)))) this.faultPending = 'Room membership changed — synchronizing';
        this.lastHello = -Infinity;
      },
      paused: (id, alias) => {
        const plan = this.plan, segment = this.segment;
        if (!plan || !segment || plan.revision !== alias || segment.config.alias !== alias || segment.config.coordinator !== id || plan.coordinator !== id
          || !this.incoming?.activated || segment.faultReason || this.coordinatorPauseAt !== undefined || !this.planCurrent(plan) || !this.transport.authorityPermitted()) return;
        this.coordinatorPauseAt = this.environment.now(); this.recoveryEpisodeAt ??= this.coordinatorPauseAt;
        this.freeze();
      },
      linkReset: id => {
        // A retained old world is already frozen during preparation. New RTC
        // links must finish binding that preparation, not start another recovery.
        if (this.incoming?.activated && this.segment && this.plan?.members.some(m => m.id === id)) this.faultPending = 'Direct link replaced — synchronizing';
      },
      message: (id, data) => this.receive(id, data), fast: (id, bytes) => { if (this.activationSafe()) return this.segment?.receiveFast(id, bytes); },
      status: text => { if (!this.recoveryRequired) this.status.recurring(text); },
      authorityChanged: () => { this.coordinatorPauseAt = undefined; this.freeze(); this.segmentPlan = undefined; this.plan = undefined; this.recoveryRequest = undefined; this.incoming = undefined; this.outgoing = undefined; this.change = undefined; this.roles.clear(); this.planDelivery.clear(); this.planCounter = 0; this.requestedPlans.clear(); this.acceptedCommands.clear(); this.statusKeys.clear(); this.lastHello = -Infinity; },
      ended: () => { this.stop(); callbacks.ended?.(); },
      revoked: () => this.terminal('This creator tab was replaced — use the newer tab'),
      terminated: text => this.terminal(text),
    });
  }
  get replicationDiagnostics() { return { mode: 'direct', presentation: this.segment?.presentation.diagnostics, presentationBytes: this.segment?.world?.presentationBytes ?? 0, coordinator: this.plan?.coordinator, alias: this.plan?.revision, simulator: !!this.segment?.world, replicaTick: this.segment?.world?.state.game.tick ?? null, finalizedTick: this.segment?.finalizedTick, finalizedHash: this.segment?.world?.finalizedHash, retainedRecords: this.segment?.retainedRecords ?? 0, rollbackCount: this.segment?.rollbackCount ?? 0, fastSentBytes: this.transport.fastSentBytes, binarySentBytes: this.transport.binarySentBytes, recoveryRequired: this.recoveryRequired, corruptRecoveryAttempts: this.recoveries.filter(at => this.environment.now() - at < 30000).length, lastFault: this.lastFault, barrier: !!this.incoming && !this.incoming.activated, fault: this.segment?.faultReason ?? this.faultPending }; }
  start(): void { this.transport.connect(); this.cancelSchedule = this.environment.schedule(() => this.tick()); }
  private terminal(text: string): void { this.freeze(); this.stopped = true; this.cancelSchedule?.(); this.status.terminal(text); }
  private freeze(): void {
    const segment = this.segment; segment?.stop();
    this.localInput = undefined; this.startAt = undefined; this.lastBotTick = -1; this.callbacks.controlsReset?.();
    if (segment) for (const peer of segment.config.members) {
      if (this.segment !== segment) return;
      if (peer !== this.transport.id) this.transport.deactivatePulse(peer, segment.config.alias);
    }
  }
  private send(id: string, data: unknown): boolean { if (id === this.transport.id) { this.receive(id, data); return true; } return this.transport.send(id, data, true); }
  private planCurrent(plan: RoomPlan): boolean {
    return plan.incarnation === this.transport.grant?.incarnation && plan.epoch === this.transport.grant?.epoch && plan.members.every(m => m.connection === this.transport.connectionOf(m.id));
  }
  private issuePlan(settings: RoomSettings, force = false): void {
    if (this.transport.id !== this.transport.hostId || !this.transport.authorityPermitted() || this.recoveryRequired) return;
    if (this.transport.members().some(id => this.roles.get(id)?.connection !== this.transport.connectionOf(id))) return;
    if (!force && this.outgoing?.activating && [...this.outgoing.peers.values()].some(peer => !peer.applied)) return;
    const members = [...this.roles].filter(([id, role]) => role.connection === this.transport.connectionOf(id)).map(([id, role]) => ({ id, connection: role.connection, display: role.display, view: role.display || settings.mode === 'devices' })).sort((a, b) => a.id.localeCompare(b.id));
    if (!members.some(m => m.id === this.transport.id)) return;
    const previous = this.plan?.coordinator;
    const coordinator = members.find(m => m.id === previous && m.view)?.id ?? members.find(m => m.id === this.transport.hostId && m.view)?.id ?? members.find(m => m.view)?.id ?? null;
    const source = previous ?? this.transport.id;
    if (!members.some(m => m.id === source)) { this.recoveryRequired = true; this.status.notice('The simulation coordinator left — choose MAIN MENU for a fresh lobby'); return; }
    if (!force && this.plan && canonical([members, coordinator, settings]) === canonical([this.plan.members, this.plan.coordinator, this.plan.settings])) return;
    if (++this.planCounter > 0xffffffff) { this.terminal('Room sequence exhausted — create a new room'); return; }
    const plan: RoomPlan = { type: 'directPlan', rules: DIRECT_RULES, revision: this.planCounter, initialize: !previous, incarnation: this.transport.grant!.incarnation, epoch: this.transport.grant!.epoch, source, coordinator, members, settings: structuredClone(settings) };
    this.adoptPlan(plan);
    this.sendPlans();
  }
  /** Enqueue is not delivery: retry current metadata until the named connection acknowledges it. */
  private sendPlans(): void {
    if (this.transport.id !== this.transport.hostId || !this.plan || !this.planCurrent(this.plan) || this.recoveryRequired) return;
    const now = this.environment.now();
    for (const [id, delivery] of this.planDelivery) if (!delivery.acknowledged && now - delivery.sentAt >= 250) {
      delivery.sentAt = now; this.send(id, this.plan);
    }
  }
  private adoptPlan(plan: RoomPlan): void {
    if (!this.planCurrent(plan) || plan.revision <= (this.plan?.revision ?? 0) || !plan.members.some(m => m.id === this.transport.id)) return;
    // A remotely superseded attempt is still unsuccessful, including a plan whose
    // source never sent its preparation header. Retain the episode across aliases.
    if (this.plan?.coordinator && this.settledPlan !== this.plan) this.recoveryEpisodeAt ??= this.environment.now();
    this.coordinatorPauseAt = undefined;
    this.attemptAt = plan.coordinator ? this.environment.now() : undefined;
    this.freeze(); this.plan = structuredClone(plan); this.incoming = undefined; this.outgoing = undefined; this.applied.clear(); this.acceptedStatus = -1; this.acceptedStatusTick = 0; this.acceptedStatusRound = 0; this.statusKeys.clear(); this.recovering = false; this.recoveryRequired = false; this.recoveryRequest = undefined; this.faultPending = undefined; this.corruptionPending = false;
    this.planDelivery.clear();
    if (this.transport.id === this.transport.hostId) for (const member of plan.members) if (member.id !== this.transport.id) this.planDelivery.set(member.id, { acknowledged: false, sentAt: -Infinity });
    this.lobby.settings = structuredClone(plan.settings);
    if (!plan.coordinator) {
      // Waiting for a display is an explicit idle lobby, not an unfinished simulation attempt.
      this.recoveryEpisodeAt = undefined; this.pendingPlan = undefined;
      this.segment = undefined; this.rendered = undefined; this.segmentPlan = undefined; this.change = undefined; this.view = catalogView(this.lobby); this.matchId = this.lobby.matchId; this.publish();
      if (this.transport.id === this.transport.hostId) this.broadcastLobby();
      this.status.recurring('Open TV view to start · phones are controllers'); return;
    }
    if (plan.source === this.transport.id) this.prepare();
    if (!this.recoveryRequired) this.status.recurring('Synchronizing direct simulation');
  }
  private prepare(): void {
    const plan = this.plan!;
    try {
      if (!plan.initialize && !this.change?.base && !this.segment?.world) throw new Error('The coordinator lost its simulation — choose MAIN MENU for a fresh lobby');
      const base = this.change?.base ?? this.segment?.world ?? initialWorld(this.lobby, plan.revision);
      const ops: GameOperation[] = [...(this.change?.ops ?? [])];
      for (const player of base.state.game.players.values()) if (!player.id.startsWith(BOT_ID_PREFIX) && !plan.members.some(m => m.id === player.id)) ops.push(['lobby', 'roundOver', 'matchOver'].includes(base.state.game.phase) ? [2, player.id] : [3, player.id, false]);
      const payload = transitionBytes(base, ops), derived = deriveTransition(payload, plan.revision, this.segment?.world, undefined, plan.settings);
      if (!derived) throw new Error('Lifecycle base could not be validated');
      const game = derived.state.game;
      const view = { ...toSnapshot(game), tick: game.tick, round: game.round };
      const header = referencePreparation({ type: 'directPrepare', revision: plan.revision, alias: plan.revision, bytes: payload.byteLength, hash: derived.hash, matchId: game.matchId, tick: game.tick, round: game.round, status: thinSnapshot(view), ...(game.phase === 'lobby' ? { lobby: catalog(game, plan.settings) } : {}), owners: ownersFor(game, plan) }, base, ops, plan);
      this.outgoing = { header, payload, at: this.environment.now(), activating: false, nextPeer:0, peers: new Map(plan.members.map(m => [m.id, { header: false, offset: 0, ready: false, applied: false, nextHeader: -Infinity, lastMeta: -Infinity, lastChunk: -Infinity }])) };
      this.acceptPreparation(header);
      if (this.incoming?.needsPayload) { this.incoming.buffer = payload; this.incoming!.received = payload.length; this.finishPreparation(); }
    } catch (error) { this.lastFault = error instanceof Error ? error.message : 'Lifecycle preparation failed'; this.requireLobby(this.lastFault); const message = { type: 'directBaseUnavailable', revision: plan.revision }; if (this.transport.id === this.transport.hostId) { for (const member of plan.members) if (member.id !== this.transport.id) this.send(member.id, message); } else this.send(this.transport.hostId, message); }
  }
  private acceptPreparation(header: Preparation): void {
    const plan = this.plan!;
    if (!isPreparation(header, plan)) return;
    if (this.incoming) { if (canonical(this.incoming.header) !== canonical(header)) { this.faultPending = 'Conflicting lifecycle preparation'; this.corruptionPending = true; } else this.send(plan.source, { type: 'directHeader', revision: plan.revision, needsPayload: this.incoming.needsPayload }); return; }
    const full = plan.members.find(m => m.id === this.transport.id)!.view;
    const base = this.segment?.world;
    const candidate = full && base && this.segmentPlan?.revision === base.segment && canReuseBase(this.segmentPlan, plan, this.transport.id) ? reuseWorld(base, header, plan) : undefined;
    const needsPayload = full && !candidate;
    this.incoming = { header: structuredClone(header), needsPayload, candidate, at: this.environment.now(), ...(needsPayload ? { buffer: new Uint8Array(header.bytes) } : {}), received: 0, ready: false, activated: false, lastAck: -Infinity };
    this.send(plan.source, { type: 'directHeader', revision: plan.revision, needsPayload });
  }
  private finishPreparation(): void {
    const incoming = this.incoming!, plan = this.plan!;
    if (!incoming.buffer || incoming.received !== incoming.header.bytes) return;
    const candidate = prepareWorld(incoming.buffer, incoming.header, plan, this.segment?.world);
    if (!candidate) { this.faultPending = 'Checkpoint validation failed'; this.corruptionPending = true; return; }
    incoming.candidate = candidate; incoming.buffer = undefined;
  }
  private bind(): boolean {
    const plan = this.plan!, incoming = this.incoming!;
    const localView = plan.members.find(m => m.id === this.transport.id)!.view;
    let ready = true;
    for (const peer of plan.members) if (peer.id !== this.transport.id) {
      const actions = localView ? incoming.header.owners.filter(([, owner]) => owner === peer.id).map(([slot]) => slot) : [];
      const receipts = peer.view ? incoming.header.owners.filter(([, owner]) => owner === this.transport.id).map(([slot]) => slot) : [];
      if (!this.transport.bindFast(peer.id, plan.revision, { actions, receipts }) || !this.transport.boundReady(peer.id)) ready = false;
    }
    return ready;
  }
  private activate(): void {
    const plan = this.plan!, incoming = this.incoming!;
    if (!incoming.ready || !this.activationSafe()) return;
    if (!incoming.activated) {
      const previous = this.segment;
      const current = () => this.plan === plan && this.incoming === incoming && this.segment === previous
        && !this.stopped && !this.recovering && !this.recoveryRequired && !this.faultPending
        && this.planCurrent(plan) && this.transport.authorityPermitted()
        && (this.attemptAt === undefined || this.environment.now() - this.attemptAt <= 5000);
      if (!current()) return;
      // Ready receipts are historical evidence: health/backpressure may lapse
      // before activation. Keep the prepared world intact for the existing retry.
      for (const member of plan.members) if (member.id !== this.transport.id) {
        const activated = this.transport.activatePulse(member.id, plan.revision);
        if (!current() || !activated) return;
      }
      if (!current()) return;
      const now = this.environment.now(); this.startAt = plan.coordinator === this.transport.id ? now + 800 : undefined;
      this.segment = new DirectSegment({ alias: plan.revision, id: this.transport.id, coordinator: plan.coordinator!, baseTick: incoming.header.tick, running: incoming.header.status.phase !== 'lobby', members: plan.members.map(m => m.id), views: plan.members.filter(m => m.view).map(m => m.id), owners: incoming.header.owners, bootstrap: incoming.candidate, startAt: this.startAt }, {
        now: () => this.environment.now(), pulse: (peer, bytes) => this.transport.sendPulse(peer, bytes), fast: (peer, bytes) => this.transport.sendFast(peer, bytes), reliable: (peer, tuple) => this.transport.sendBound(peer, tuple),
        events: events => this.events(events), fault: (reason, corrupt) => { this.faultPending = reason; this.corruptionPending = !!corrupt; },
      });
      this.rendered = undefined; this.controlsRound = incoming.header.round;
      this.segmentPlan = structuredClone(plan);
      incoming.activated = true; this.view = this.segment.snapshot() ?? incoming.header.status; this.matchId = incoming.header.matchId; if (incoming.header.lobby) this.lobby = structuredClone(incoming.header.lobby); incoming.candidate = undefined; this.change = undefined; this.pendingPlan = undefined;
      this.lastPublish = ''; this.publish(); this.lastBotTick = -1; this.applied.add(this.transport.id);
      this.status.recurring('Connected · direct action simulation'); this.save();
    }
    for (const id of new Set([plan.source, plan.coordinator!])) this.send(id, { type: 'directApplied', revision: plan.revision });
  }
  /** A delayed RTC callback cannot publish a started clock before the activation deadline is checked. */
  private activationSafe(): boolean {
    if (this.startAt !== undefined && this.plan && this.environment.now() >= this.startAt - 100 && this.plan.members.some(m => !this.applied.has(m.id))) {
      this.freeze(); this.faultPending = 'Not everyone confirmed the start — synchronizing'; return false;
    }
    return !this.stopped && !this.recoveryRequired;
  }
  private receive(id: string, raw: unknown): void {
    if (this.stopped || !this.transport.authorityPermitted()) return;
    if (Array.isArray(raw)) { if (this.activationSafe()) this.segment?.receiveControl(id, raw); return; }
    if (!record(raw)) return;
    if (raw.type === 'directHello' && raw.rules === DIRECT_RULES && typeof raw.display === 'boolean' && id !== this.transport.id) {
      const connection = this.transport.connectionOf(id); if (!connection) return;
      if (this.transport.id === this.transport.hostId) { this.roles.set(id, { connection, display: raw.display }); this.issuePlan(this.plan?.settings ?? this.lobby.settings); this.sendPlans(); if (!this.plan?.coordinator) this.send(id, { type: 'directLobby', revision: this.plan?.revision, catalog: this.lobby }); }
      return;
    }
    if (raw.type === 'actionHello' || raw.type === 'resync') { this.send(id, { type: 'directUnsupported' }); return; }
    if (raw.type === 'directUnsupported') { this.terminal('Game protocol changed — reload every participant'); return; }
    if (id === this.transport.hostId && isPlan(raw)) {
      this.adoptPlan(raw);
      if (this.plan && this.planCurrent(this.plan) && canonical(raw) === canonical(this.plan)) this.send(id, { type: 'directPlanAck', revision: this.plan.revision });
      return;
    }
    if (raw.type === 'directPlanRequest' && this.transport.id === this.transport.hostId && id === this.plan?.coordinator && uint32(raw.request) && parseRoomSettings(raw.settings)) {
      if ((this.requestedPlans.get(id) ?? -1) < raw.request) { this.requestedPlans.set(id, raw.request); this.issuePlan(parseRoomSettings(raw.settings)!, true); } else this.sendPlans();
      return;
    }
    const plan = this.plan;
    if (this.recoveryRequired || !plan || !this.planCurrent(plan) || raw.revision !== plan.revision || !plan.members.some(m => m.id === id)) return;
    if (raw.type === 'directPlanAck' && this.transport.id === this.transport.hostId && Object.keys(raw).length === 2) {
      const delivery = this.planDelivery.get(id); if (delivery) delivery.acknowledged = true;
      return;
    }
    if (raw.type === 'directBaseUnavailable' && (id === plan.source || id === this.transport.hostId)) {
      this.requireLobby('The simulation base is unavailable — creator must choose MAIN MENU');
      if (this.transport.id === this.transport.hostId) for (const member of plan.members) if (member.id !== this.transport.id) this.send(member.id, raw);
      return;
    }
    if (raw.type === 'directLobby' && id === this.transport.hostId && !plan.coordinator && isCatalog(raw.catalog)) { this.lobby = structuredClone(raw.catalog); this.view = catalogView(this.lobby); this.matchId = this.lobby.matchId; this.publish(); return; }
    if (raw.type === 'directPrepare' && id === plan.source && isPreparation(raw, plan)) { this.acceptPreparation(raw); return; }
    if (isPreparationAck(raw) && this.outgoing) {
      const peer = this.outgoing.peers.get(id), full = plan.members.find(m => m.id === id)!.view;
      if (!peer) return;
      if (peer.header && peer.needsPayload !== raw.needsPayload) { this.faultPending = 'Conflicting checkpoint requirement'; this.corruptionPending = true; return; }
      if (full ? !raw.needsPayload && !this.outgoing.header.reference : raw.needsPayload) return;
      peer.header = true; peer.needsPayload = raw.needsPayload; return;
    }
    if (raw.type === 'directChunk' && id === plan.source && this.incoming?.buffer && uint32(raw.offset) && raw.data instanceof Uint8Array && raw.data.length <= 12_000) {
      const incoming = this.incoming;
      if (raw.offset < incoming.received) return;
      if (raw.offset !== incoming.received || raw.offset + raw.data.length > incoming.header.bytes || !raw.data.length) { this.faultPending = 'Invalid checkpoint chunk'; return; }
      incoming.buffer!.set(raw.data, raw.offset); incoming.received += raw.data.length; this.finishPreparation(); return;
    }
    if (raw.type === 'directReady' && this.outgoing) { const peer = this.outgoing.peers.get(id); if (peer?.header) peer.ready = true; return; }
    if (raw.type === 'directActivate' && id === plan.source && this.incoming) { this.activate(); return; }
    if (raw.type === 'directApplied') { this.applied.add(id); const peer = this.outgoing?.peers.get(id); if (peer) peer.applied = true; return; }
    if (raw.type === 'directRecover' && id !== this.transport.id && plan.coordinator === this.transport.id) { this.faultPending ??= 'A participant requested synchronization'; return; }
    if (raw.type === 'directCommand' && uint32(raw.request) && record(raw.command) && raw.command.type !== 'input' && (plan.coordinator ?? this.transport.hostId) === this.transport.id) {
      if (raw.request <= (this.acceptedCommands.get(id) ?? -1)) { this.send(id, { type: 'directCommandAck', revision: plan.revision, request: raw.request }); return; }
      this.commands.set(id, { request: raw.request, command: raw.command as Management, expires: this.environment.now() + 5000, sent: 0 }); return;
    }
    if (raw.type === 'directCommandAck' && id === (plan.coordinator ?? this.transport.hostId) && raw.request === this.localCommand?.request) { this.localCommand = undefined; if (typeof raw.error === 'string') this.status.notice(raw.error); return; }
    if (raw.type === 'directStatus' && id === plan.coordinator && this.segment && !this.segment.world && !this.segment.faultReason && this.incoming?.activated && uint32(raw.sequence) && raw.sequence > this.acceptedStatus && isThinView(raw.view, this.transport.id) && this.incoming && this.incoming.header.matchId === raw.matchId && raw.view.round >= Math.max(this.acceptedStatusRound, this.incoming.header.round) && raw.view.tick >= Math.max(this.acceptedStatusTick, this.incoming.header.tick)
      && raw.view.players.length === this.incoming.header.status.players.length && raw.view.players.every(p => this.incoming!.header.status.players.some(expected => expected.slot === p.slot && expected.id === p.id))) {
      this.acceptedStatus = raw.sequence; this.acceptedStatusTick = raw.view.tick; this.acceptedStatusRound = raw.view.round; this.view = raw.view; this.publish(); this.save(); return;
    }
  }
  command(command: RoomCommand | OnlineInput): boolean {
    if (this.stopped) return false;
    if (command.type === 'input') {
      const segment = this.segment, player = this.view?.players.find(p => p.id === this.transport.id);
      if (!segment || !player || !this.activationSafe() || this.recovering || this.faultPending || segment.faultReason) { if (command.bombAction === 'release') this.callbacks.shotFailed?.(); return false; }
      if (!segment.clock.read().canOriginate) {
        if (command.bombAction === 'release') { this.freeze(); this.faultPending = 'Release could not be timed — synchronizing controls'; this.callbacks.shotFailed?.(); }
        return false;
      }
      const ok = segment.input(player.slot, { revision: command.seq, left: command.left, right: command.right, bomb: command.bomb, bombAction: command.bombAction, aim: command.aim ? [command.aim.x, command.aim.y] : null });
      if (ok) this.localInput = command; else if (command.bombAction === 'release') this.callbacks.shotFailed?.(); return ok;
    }
    if (this.recoveryRequired && this.transport.id === this.transport.hostId && command.type === 'action' && command.action === 'lobby') {
      this.lobby.matchId = this.environment.randomId(); this.lobby.seed = createGame(this.lobby.matchId).seed; this.recoveryRequired = false; this.recoveryEpisodeAt = undefined; this.segment = undefined; this.rendered = undefined; this.plan = undefined; this.view = catalogView(this.lobby); this.issuePlan(this.lobby.settings, true); return true;
    }
    this.localCommand = { request: ++this.requestCounter, command: structuredClone(command), expires: this.environment.now() + 5000, sent: -Infinity }; return true;
  }
  private processCommands(): void {
    const plan = this.plan!;
    if ((plan.coordinator ?? this.transport.hostId) !== this.transport.id || this.recovering || this.change || this.outgoing || this.incoming && !this.incoming.activated || !this.commands.size) return;
    const base = this.segment?.world ?? initialWorld(this.lobby, plan.revision);
    this.freeze();
    const state = neutral(base.finalizedState()), session = manager(this.transport.hostId, state.game, plan.settings);
    for (const player of session.game.players.values()) if (!player.id.startsWith(BOT_ID_PREFIX) && !plan.members.some(m => m.id === player.id)) session.disconnect(player.id);
    for (const [peer, pending] of this.commands) {
      let error = this.environment.now() > pending.expires ? 'Room command expired — try again' : undefined;
      if (!error && !plan.coordinator && pending.command.type === 'action' && pending.command.action !== 'lobby') error = 'Open TV view before starting the race';
      if (!error && pending.command.type === 'settings' && parseRoomSettings(pending.command.settings)?.mode === 'shared' && session.game.phase !== 'lobby' && !plan.members.some(m => m.display)) error = 'Open TV view before changing the active match to shared mode';
      error ??= session.command(peer, pending.command);
      this.acceptedCommands.set(peer, pending.request); this.send(peer, { type: 'directCommandAck', revision: plan.revision, request: pending.request, ...(error ? { error } : {}) });
    }
    if (session.game.phase === 'lobby' && canonical(session.game.settings) !== canonical(session.settings)) session.journal.apply([4, session.settings]);
    this.commands.clear();
    if (!plan.coordinator) {
      this.lobby = catalog(session.game, session.settings); this.view = catalogView(this.lobby); this.matchId = this.lobby.matchId; this.broadcastLobby(); this.issuePlan(session.settings); this.save(); return;
    }
    this.change = { base, ops: session.journal.since(0)!, settings: session.settings };
    this.requestPlan(session.settings);
  }
  private requestPlan(settings: RoomSettings): void {
    if (this.transport.id === this.transport.hostId) this.issuePlan(settings, true);
    else this.pendingPlan = { request: ++this.requestCounter, settings: structuredClone(settings), sent: -Infinity, at: this.environment.now() };
  }
  private requireLobby(reason: string): void {
    this.freeze(); this.recoveryRequired = true; this.recoveryRequest = undefined; this.pendingPlan = undefined;
    this.status.recurring(reason); this.status.notice(reason);
  }
  private recover(reason: string, corrupt = false): void {
    const now = this.environment.now(); this.freeze(); this.lastFault = reason; this.status.notice(reason); this.recoveryEpisodeAt ??= now;
    if (now - this.lastRecovery < 500 || this.recovering || this.recoveryRequired) return;
    this.lastRecovery = now; this.recoveries = this.recoveries.filter(at => now - at < 30_000);
    // One charge per corrupt attempt; availability pauses have their own episode deadline.
    const attempt = `${this.plan?.incarnation}:${this.plan?.epoch}:${this.plan?.revision}`;
    if (corrupt && this.chargedCorruption !== attempt) {
      if (this.recoveries.length >= 3) { this.requireLobby('Repeated invalid state — creator must choose MAIN MENU'); return; }
      this.chargedCorruption = attempt; this.recoveries.push(now);
    }
    this.recovering = true;
    if (this.plan?.coordinator === this.transport.id) this.requestPlan(this.plan.settings);
    else if (this.plan) this.recoveryRequest = { revision: this.plan.revision, peer: this.plan.coordinator ?? this.transport.hostId, at: now, sent: -Infinity };
  }
  private tick(): void {
    if (this.stopped) return;
    const now = this.environment.now(); this.status.refresh();
    if (!this.transport.authorityPermitted() || this.environment.hidden()) { if (this.segment && !this.segment.faultReason) this.faultPending = 'Room clock paused — synchronizing'; return; }
    if (now - this.lastHello >= 250) {
      this.lastHello = now;
      if (this.transport.id !== this.transport.hostId) {
        const confirmed = this.plan && this.planCurrent(this.plan) && this.plan.members.some(m => m.id === this.transport.id && m.connection === this.transport.connectionId && m.display === this.display);
        if (!confirmed) this.send(this.transport.hostId, { type: 'directHello', rules: DIRECT_RULES, display: this.display });
      } else { this.issuePlan(this.plan?.settings ?? this.lobby.settings); this.sendPlans(); }
    }
    if (this.pendingPlan && now - this.pendingPlan.at > 5000) this.requireLobby('The creator could not confirm synchronization — choose a fresh lobby');
    if (this.pendingPlan && now - this.pendingPlan.sent >= 200) { this.pendingPlan.sent = now; this.send(this.transport.hostId, { type: 'directPlanRequest', request: this.pendingPlan.request, settings: this.pendingPlan.settings }); }
    if (this.localCommand) {
      if (now > this.localCommand.expires) { this.localCommand = undefined; this.status.notice('Room command timed out — try again'); }
      else if (this.plan && now - this.localCommand.sent >= 200) { this.localCommand.sent = now; this.send(this.plan.coordinator ?? this.transport.hostId, { type: 'directCommand', revision: this.plan.revision, request: this.localCommand.request, command: this.localCommand.command }); }
    }
    if (this.faultPending) { const reason = this.faultPending, corrupt = this.corruptionPending; this.faultPending = undefined; this.corruptionPending = false; this.recover(reason, corrupt); }
    const recovery = this.recoveryRequest;
    if (recovery) {
      if (now - recovery.at > 5000) { this.requireLobby('Synchronization unavailable — creator must open a fresh lobby'); }
      else if (now - recovery.sent >= 500) { recovery.sent = now; this.send(recovery.peer, { type: 'directRecover', revision: recovery.revision }); }
    }
    if (this.recoveryEpisodeAt !== undefined && now - this.recoveryEpisodeAt > 15000 && !this.recoveryRequired) this.requireLobby('Synchronization could not restore play — creator must choose MAIN MENU');
    const plan = this.plan; if (!plan || this.recoveryRequired) return;
    if (this.coordinatorPauseAt !== undefined && now - this.coordinatorPauseAt > 5000) { this.coordinatorPauseAt = undefined; this.recover('Coordinator transition timed out — synchronizing'); return; }
    if (this.attemptAt !== undefined && !this.incoming?.activated && now - this.attemptAt > 5000) { this.recover('Direct simulation setup timed out — retrying'); return; }
    if (this.incoming && !this.incoming.activated) {
      const full = plan.members.find(m => m.id === this.transport.id)!.view;
      if ((!full || this.incoming.candidate) && this.bind()) this.incoming.ready = true;
      if (this.incoming.ready && now - this.incoming.lastAck >= 100) { this.incoming.lastAck = now; this.send(plan.source, { type: 'directReady', revision: plan.revision }); }
    }
    const outgoing = this.outgoing;
    if (outgoing) {
      if (now - outgoing.at > 5000 && [...outgoing.peers.values()].some(p => !p.applied)) { this.recover('Not every participant confirmed the lifecycle change'); return; }
      for (const [id, peer] of outgoing.peers) {
        if (!peer.header && now >= peer.nextHeader) {
          const queued = this.send(id, outgoing.header);
          peer.nextHeader = now + (queued ? 500 : 100);
        }
        if(this.stopped||this.recoveryRequired||this.outgoing!==outgoing||this.plan!==plan||!this.planCurrent(plan)||!this.transport.authorityPermitted())return;
      }
      const recipients=[...outgoing.peers];
      for(let offset=0;offset<recipients.length;offset++){
        const index=(outgoing.nextPeer+offset)%recipients.length,[id,peer]=recipients[index];
        if (id !== this.transport.id && peer.header && peer.needsPayload && peer.offset < outgoing.payload.length && now - peer.lastChunk >= 50) {
          peer.lastChunk = now;
          const data=outgoing.payload.slice(peer.offset,peer.offset+CHECKPOINT_CHUNK_BYTES);
          const queued=this.transport.sendCheckpoint(id,{type:'directChunk',revision:plan.revision,offset:peer.offset,data});
          if(this.stopped||this.recoveryRequired||this.outgoing!==outgoing||this.plan!==plan||!this.planCurrent(plan)||!this.transport.authorityPermitted())return;
          if(queued){peer.offset+=data.length;outgoing.nextPeer=(index+1)%recipients.length;break;}
        }
      }
      if ([...outgoing.peers.values()].every(p => p.ready)) outgoing.activating = true;
      if (outgoing.activating) for (const [id, peer] of outgoing.peers) if (!peer.applied && now - peer.lastMeta >= 100) { peer.lastMeta = now; this.send(id, { type: 'directActivate', revision: plan.revision }); }
      if ([...outgoing.peers.values()].every(p => p.applied)) { this.outgoing = undefined; if (!this.segment?.world) this.change = undefined; }
    }
    if (!this.activationSafe() || this.recovering) return;
    this.segment?.tick();
    const segment = this.segment;
    if (segment && !segment.faultReason && this.incoming?.activated && segment.clock.read().canOriginate && (plan.coordinator !== this.transport.id || plan.members.every(m => this.applied.has(m.id))) && (!segment.config.running || segment.finalizedTick > segment.config.baseTick)) { this.recoveryEpisodeAt = undefined; this.settledPlan = plan; }
    if (segment?.world && !segment.faultReason) {
      const clock = segment.clock.read();
      if (plan.coordinator === this.transport.id && clock.canOriginate && clock.tick !== this.lastBotTick) {
        this.lastBotTick = clock.tick;
        for (const p of segment.world.state.game.players.values()) if (p.id.startsWith(BOT_ID_PREFIX)) {
          const input = this.bots.input(segment.world.state.game, p.id), command = input.bombCommands?.[0];
          segment.input(p.slot, { revision: segment.revision(p.slot) + 1, left: input.left, right: input.right, bomb: input.bomb, bombAction: command?.action, aim: input.aim ? [input.aim.x, input.aim.y] : null });
        }
      }
      this.view = segment.snapshot(); this.matchId = segment.world.state.game.matchId;

    } else if (segment && !segment.world && !segment.faultReason && this.view && segment.clock.read().canOriginate) this.view = { ...this.view, tick: segment.clock.read().tick };
    this.publish(); this.processCommands();
    if (this.plan !== plan) return;
    if (plan.coordinator === this.transport.id && this.view && now - this.lastStatus >= 100) {
      this.lastStatus = now;
      for (const member of plan.members) if (!member.view && member.id !== this.transport.id) {
        const view = thinSnapshot(this.view, member.id), key = canonical({ ...view, tick: 0 });
        if (this.statusKeys.get(member.id) === key) continue;
        if (this.send(member.id, { type: 'directStatus', revision: plan.revision, sequence: ++this.statusRevision, matchId: this.matchId, view })) this.statusKeys.set(member.id, key);
      }
    }
  }
  private events(events: CommittedEvent[]): void {
    const game = this.segment?.world?.state.game; if (!game) return;
    for (const { tick, round, event } of events) this.callbacks.event(event, game.matchId, round, tick);
  }
  private broadcastLobby(): void { this.publish(); if (this.plan) for (const member of this.plan.members) if (member.id !== this.transport.id) this.send(member.id, { type: 'directLobby', revision: this.plan.revision, catalog: this.lobby }); }
  private publish(): void {
    if (!this.view) return;
    if (this.segment && this.view.round > this.controlsRound && this.activationSafe() && !this.segment.faultReason) {
      if (!this.segment.resetControls()) return;
      this.controlsRound = this.view.round; this.localInput = undefined;
      this.callbacks.controlsReset?.();
    }
    const key = `${this.plan?.revision}:${this.view.tick}:${this.segment?.finalizedTick}:${canonical(this.plan?.settings ?? this.lobby.settings)}:${this.view.players.length}:${this.view.phase}:${this.view.phase === 'lobby' ? canonical(this.view) : ''}`;
    if (key === this.lastPublish) return; this.lastPublish = key;
    const own = this.view.players.find(p => p.id === this.transport.id);
    this.callbacks.state(this.view, this.plan?.settings ?? this.lobby.settings, own ? this.segment?.revision(own.slot) ?? -1 : -1, this.matchId);
  }
  private save(): void {
    if (this.transport.id !== this.transport.hostId || !this.view || this.incoming && !this.incoming.activated) return;
    if (this.segment?.world) this.lobby = catalog(this.segment.world.state.game, this.plan!.settings);
    else if (this.view.phase !== 'lobby') this.lobby = { ...this.lobby, matchId: this.matchId, tick: this.view.tick, leaderboard: structuredClone(this.view.leaderboard), settings: this.plan?.settings ?? this.lobby.settings, players: this.view.players.map(({ id, name, slot, color, avatarId, connected }) => ({ id, name, slot, color, avatarId, connected })) };
    try { this.environment.storage.setItem(`fuse-direct-room-${this.code}`, JSON.stringify({ catalog: this.lobby, status: thinSnapshot(this.view) })); } catch { /* Cache is best effort, not durable failover. */ }
  }
  renderSnapshot(): ViewSnapshot | undefined {
    if (!this.segment?.world) return this.view;
    if (!this.activationSafe() || !this.view || !this.segment?.world || this.segment.faultReason) return this.rendered ?? this.view;
    const segment = this.segment, world = segment.world!, reading = segment.clock.read();
    if (!reading.canAdvance) return this.rendered ?? this.view;
    const fraction = this.view.phase === 'playing' && reading.canAdvance ? Math.max(0, Math.min(1, reading.fractionalTick - world.state.game.tick)) : 0;
    const buffered = segment.presentation.render(world.presentationFrames(), reading.fractionalTick, this.environment.now());
    const view = buffered ? segment.present(buffered) : this.view;
    if (view.round !== world.state.game.round) { this.rendered = view; return view; }
    this.rendered = { ...view, players: view.players.map(remote => {
      if (remote.id !== this.transport.id) return remote;
      const sim = world.state.game.players.get(remote.id)!;
      const p = { ...remote, x: sim.x, y: sim.y, angle: sim.angle, trail: sim.trail };
      if (!sim.alive || !fraction) return p;
      const held = world.state.held.get(p.slot), local = p.id === this.transport.id ? this.localInput : undefined;
      const controls = local ?? { left: !!((held?.flags ?? 0) & 1), right: !!((held?.flags ?? 0) & 2) };
      const nextOffset = drunkHeadingOffset(world.state.game.seed, p.id, world.state.game.tick + 1, sim.drunkStartedTick, sim.drunkUntilTick);
      const pose = advanceRiderPose({ x: p.x, y: p.y, angle: p.angle, drunkHeadingOffset: sim.drunkHeadingOffset }, controls, { distance: RIDER_SPEED / 20 * fraction, turn: RIDER_TURN_RATE / 20 * fraction, drunkHeadingOffset: sim.drunkHeadingOffset + (nextOffset - sim.drunkHeadingOffset) * fraction });
      const trail = [...p.trail, { x1: p.x, y1: p.y, x2: pose.x, y2: pose.y, createdTick: world.state.game.tick, expiresAtTick: world.state.game.tick + 4 }];
      return { ...remote, x: pose.x, y: pose.y, angle: pose.angle, trail };
    }) };
    return this.rendered;
  }
  stop(): void { this.save(); this.freeze(); this.stopped = true; this.cancelSchedule?.(); this.transport.close(); }
}
