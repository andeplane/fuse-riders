import {
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SPECTATOR,
  actingCreator,
  roomManager,
  successionOrder,
  type ManagementEntry,
} from "./management.js";
import type {
  LogEntry,
  RollbackGame,
  RoomClock,
  RuntimeText,
  Seat,
} from "./game.js";
import type { Membership, Member } from "./membership.js";
import type { InputRecorder } from "./input-recorder.js";
import type { World } from "./rollback.js";
import type { StreamLog } from "./stream.js";

export const DISCONNECT_MS = 1000,
  CREATOR_SILENCE_MS = 5000,
  /** Tick-loop passes the courtesy "you were removed" message is retried for while the target's link comes up. */
  KICK_NOTICE_ATTEMPTS = 100;

/**
 * What `RoomManager` needs from the runtime around it: the fold it writes against, who this device is, and the two
 * side effects management has — an entry on this device's own stream, and a line on the screen. It holds no transport
 * and no clock of its own, so a test can drive it with plain values.
 */
export interface RoomManagerHost<
  Room extends RoomClock,
  Entry extends LogEntry,
  View extends { tick: number },
  Event,
  Settings,
> {
  readonly game: RollbackGame<Room, Entry, View, Event, Settings>;
  readonly members: Membership;
  readonly recorder: InputRecorder<Entry>;
  readonly text: RuntimeText;
  /** This device's member id, and the id of the page that opened the room. */
  readonly id: string;
  readonly hostId: string;
  /** This device opened the room. */
  readonly creator: boolean;
  readonly generation: number;
  /** This page is hidden: its world is frozen where it hid, so it logs nothing for the room (ADR-047 §12). */
  readonly hidden: boolean;
  /** Whether this device renders the whole room rather than a controller: what a hello announces. */
  readonly full: boolean;
  /** When the tick loop last ran: a creator whose own loop stalled cannot tell silence from its own absence. */
  readonly lastLoopAt: number;
  readonly world: World<Room, Entry, View, Event, Settings> | undefined;
  own(): StreamLog<Entry>;
  now(): number;
  notice(text: string): void;
  /** Deliver a direct message to a member; false when no link could carry it. */
  send(id: string, message: unknown): boolean;
}

/**
 * The room's management duties: who holds a seat, who watches, who is present and who has gone.
 *
 * Only the manager writes these entries — the creator's page, or the delegate the fold names while the creator is
 * logged absent (`manager`) — and every replica's reducer re-checks that before folding one, so a stale delegate
 * writes nothing anyone applies. The duties are seating (`join`, `spectate`, `claimSlot`, `kick` and the side switch
 * that pairs two entries at one tick), presence (`creatorDuties`, `ensurePresence`) and succession
 * (`actingCreatorDuties`), and all of them read the outcome back from the fold rather than assuming it.
 */
export class RoomManager<
  Room extends RoomClock,
  Entry extends LogEntry,
  View extends { tick: number },
  Event,
  Settings,
> {
  /** A kick appended but not yet folded: what it actually did is read back from the fold, never assumed (`settleKick`). */
  private pendingKick?: { id: string; tick: number; attempts: number };
  constructor(
    private readonly room: RoomManagerHost<Room, Entry, View, Event, Settings>,
  ) {}
  /** Whether this replica's management entries apply right now: the creator, or the delegate while the creator is logged absent. */
  get manager(): boolean {
    return (
      this.room.creator ||
      (this.room.world !== undefined &&
        actingCreator(
          this.room.game.members(this.room.world.state),
          this.room.hostId,
        ) === this.room.id)
    );
  }
  /**
   * Whether this device runs the room for the players: the crown, not the log duties. The creator's own page always
   * does; anyone else does while the fold names it (`roomManager`), which is one member, never the two `manager`
   * deliberately allows beside an unseated creator.
   */
  get managing(): boolean {
    return (
      this.room.creator ||
      (this.room.world !== undefined &&
        roomManager(
          this.room.game.members(this.room.world.state),
          this.room.hostId,
        ) === this.room.id)
    );
  }
  /** Where a joiner sends its join: the creator, or whoever manages while the creator is absent. */
  managerId(): string {
    return (
      (this.room.world &&
        actingCreator(
          this.room.game.members(this.room.world.state),
          this.room.hostId,
        )) ??
      this.room.hostId
    );
  }
  join(
    from: string,
    rawName: string,
    avatarId: string | undefined,
  ): string | undefined {
    if (!this.room.world) return this.room.text.stillLoading;
    // The one normaliser: what is logged is a valid name every replica's log guard accepts (never half an emoji).
    const name = this.room.game.seating.seatName(rawName);
    if (!name) return this.room.text.chooseName;
    const member =
      from === this.room.id ? undefined : this.room.members.get(from);
    const generation =
      from === this.room.id ? this.room.generation : member?.generation;
    if (generation === undefined) return this.room.text.reconnectFirst;
    // One transition per member at a time: entries this replica logged and has not folded settle before another is
    // written, so a retried join (`sendJoin` retries on its own timer) never writes a second switch.
    if (this.pending().ids.has(from)) return;
    const seated = this.room.game.seat(this.room.world.state, from);
    if (seated && !seated.watcher) {
      // A join from a member the room already seats is its reconnection — unless the name differs, which makes it a
      // rename. The fold takes the name from this same entry and keeps it unique, so the whole of a rename is one
      // ordinary `JOIN` over the seat the member already holds: no new kind, and no seat, colour or head disturbed.
      if (name !== seated.name && this.room.game.seating.renameable) {
        const refusal = this.room.game.seating.renameable(
          this.room.world.state,
          from,
        );
        if (refusal) return refusal;
        this.room.recorder.append([
          JOIN,
          from,
          name,
          seated.slot,
          seated.avatarId ?? this.room.game.seating.defaultAvatar,
          generation,
        ]);
        return;
      }
      if (from === this.room.id) this.ensurePresence(from, this.selfMember());
      else this.ensurePresence(from, member!);
      return;
    }
    // A watcher taking a seat keeps its place in the room: the switch is refused, not the member.
    if (seated) {
      const refusal = this.switchable(from, this.room.text.takeSeatInRound);
      if (refusal) return refusal;
    }
    // Before the pair, so a switch that cannot be seated writes nothing and the member stays where it is. A watcher
    // holds no seat, so nothing here reads the `SPECTATOR leave` that follows.
    const slot = this.claimSlot();
    if (slot < 0) return this.room.text.full;
    const tick = this.room.recorder.next();
    // Ordered, at one tick, in the manager's own stream: `applyManagement` runs them in succession then entry order on
    // every replica, and `JOIN` returns early while the id is still in the watching list, so the leave must come first.
    if (seated) this.room.recorder.at(tick, [SPECTATOR, "leave", from]);
    this.room.recorder.at(tick, [
      JOIN,
      from,
      name,
      slot,
      avatarId ?? this.room.game.seating.defaultAvatar,
      generation,
    ]);
    return;
  }
  /**
   * The other half of `join`: a place in the watching list rather than a seat. A watcher is a named member of the room —
   * it is folded, it survives a reload and it ranks in the succession order — but it steers nothing, so nothing waits on
   * its stream.
   */
  spectate(from: string, rawName: string): string | undefined {
    if (!this.room.world) return this.room.text.stillLoading;
    const name = this.room.game.seating.seatName(rawName);
    if (!name) return this.room.text.chooseName;
    const member =
      from === this.room.id ? undefined : this.room.members.get(from);
    const generation =
      from === this.room.id ? this.room.generation : member?.generation;
    if (generation === undefined) return this.room.text.reconnectFirst;
    const pending = this.pending();
    if (pending.ids.has(from)) return;
    const seated = this.room.game.seat(this.room.world.state, from);
    if (seated?.watcher) {
      this.ensurePresence(
        from,
        from === this.room.id ? this.selfMember() : member!,
      );
      return;
    }
    // A rider starting to watch gives its seat up in the same tick. Outside the reclaimable phases `LEAVE` only marks
    // the rider absent, it stays in the game's players, and the `SPECTATOR join` behind it would be dropped for that —
    // leaving the member seated but absent. So this direction waits for the pause, exactly as a kick does.
    if (seated) {
      const refusal = this.switchable(from, this.room.text.watchInRound);
      if (refusal) return refusal;
    }
    const watching = [...this.room.game.members(this.room.world.state)].filter(
      (seat) => seat.watcher,
    ).length;
    if (watching + pending.watchers >= this.room.game.seating.maxWatchers)
      return this.room.text.watchersFull;
    const tick = this.room.recorder.next();
    // `SPECTATOR join` refuses an id the game still seats, so the seat goes first.
    if (seated) this.room.recorder.at(tick, [LEAVE, from]);
    this.room.recorder.at(tick, [SPECTATOR, "join", from, name, generation]);
    return;
  }
  /**
   * Whether this replica may write the pair that moves `from` between the seats and the watching list, or the line that
   * says why not.
   *
   * Two rules, both outside the fold so no entry kind and no `RULES` move with them.
   *
   * A round in progress waits. `LEAVE` only marks a seated rider absent outside the reclaimable phases, leaving it in
   * the game's players, and the `SPECTATOR join` behind it is then dropped for exactly that — a member seated and
   * absent at once. This is the rule a kick already follows, for the same reason.
   *
   * And a member never switches its own side while it is the one writing the entries. `permitted` is re-evaluated per
   * entry against the state the entry before it left, and between the pair the member is in neither the players nor the
   * watching list, so `successionOrder` cannot rank it and the second entry is refused on every replica alike. The
   * creator is exempt: `permitted` answers for it without ranking it. Everyone else asks the manager, which is never
   * the subject, so the pair is written by a member the order keeps ranking throughout — and a pair that is refused is
   * refused whole, because nothing between `LEAVE`/`SPECTATOR leave` and what follows can change who the delegate is.
   * A stand-in host that means to watch waits for the room's own host to come back, or leaves as it always could.
   *
   * `command` asks this about its own device before it sends anything — which is where the stand-in rule bites, since
   * a stand-in's request would otherwise be addressed to itself and answered by nobody — and the manager asks it again
   * about whoever asked, on the fold the entries are written against.
   */
  switchable(from: string, inRound: string): string | undefined {
    if (this.room.game.stage(this.room.world!.state) === "running")
      return inRound;
    // A manager writing about somebody else is never the member that vanishes, and the creator is waved through
    // unranked: only this device asking about itself, without having opened the room, needs somewhere to send it.
    if (from !== this.room.id || this.room.creator) return;
    return this.switchWriter() === this.room.id
      ? this.room.text.switchAsStandIn
      : undefined;
  }
  /**
   * Who writes the pair when this device asks to change its own side. Normally whoever manages the room. When that is
   * this device it cannot be, so the request goes to the creator's page instead, whose management entries `permitted`
   * accepts whatever the succession order says at the time.
   *
   * That second case is not rare: a creator driving a shared screen from a page that took no seat has no record in the
   * fold, so the crown sits on the rider in the first seat for as long as the room lasts. Without this that rider could
   * never change sides. What is left is a room whose creator's page has actually gone — then there is nobody who can
   * write the pair, and `switchable` says so.
   */
  switchWriter(): string {
    const manager = this.managerId();
    if (manager !== this.room.id) return manager;
    return this.room.members.has(this.room.hostId)
      ? this.room.hostId
      : this.room.id;
  }
  /** Whether this device is in the room already and asking for the other side, rather than arriving. */
  switchingSides(spectator: boolean): boolean {
    const own =
      this.room.world &&
      this.room.game.seat(this.room.world.state, this.room.id);
    return own !== undefined && (own.watcher === true) !== spectator;
  }
  /**
   * Own management entries logged but not yet applied: seats they will take or free when their tick arrives.
   *
   * A side switch is two of them and is counted as the one move it is. Taking a seat pairs `SPECTATOR leave` (one
   * watcher fewer) with a `JOIN` the folded state still sees as a watcher, which the branch below already reads as a
   * seat being taken; starting to watch pairs `LEAVE` (the seat is freed, and `claimSlot` may hand it to someone else
   * in the same tick) with `SPECTATOR join` (one watcher more). `ids` holds whoever a logged entry is about to place,
   * which is what stops a retried request writing a second transition over one still in flight.
   */
  pending(): {
    slots: Set<number>;
    freed: Set<string>;
    ids: Set<string>;
    seats: number;
    /** Net watchers this replica has logged but not yet folded, so one past the limit is refused before the last applies. */
    watchers: number;
  } {
    const slots = new Set<number>(),
      freed = new Set<string>(),
      ids = new Set<string>();
    let seats = 0,
      watchers = 0;
    for (const own of this.room.own().entries.values()) {
      if (own[1] <= this.room.world!.tick) continue;
      // The own stream took only entries its game's `isEntry` accepts, so a management kind has the management shape.
      const entry = own as LogEntry as ManagementEntry;
      const seated =
        entry[2] === JOIN &&
        this.room.game.seat(this.room.world!.state, entry[3]);
      if (entry[2] === JOIN && (!seated || seated.watcher)) {
        slots.add(entry[5]);
        ids.add(entry[3]);
        seats++;
      } else if (entry[2] === BOT && entry[3] === "add") {
        slots.add(entry[6]);
        ids.add(entry[4]);
        seats++;
      } else if (entry[2] === LEAVE) {
        // `LEAVE` is also how a watcher is removed (`kick`), and a watcher holds no seat. Only a member the fold
        // still seats as a rider frees one, for the count here and for the slot `claimSlot` may reclaim.
        const leaving = this.room.game.seat(this.room.world!.state, entry[3]);
        if (leaving && !leaving.watcher) {
          freed.add(entry[3]);
          seats--;
        }
      } else if (entry[2] === SPECTATOR) {
        if (entry[3] === "join") {
          ids.add(entry[4]);
          watchers++;
        } else watchers--;
      }
    }
    return { slots, freed, ids, seats, watchers };
  }
  /** A free seat, freeing a disconnected member's seat between rounds first. */
  claimSlot(): number {
    const room = this.room.world!.state,
      pending = this.pending();
    const seats = [...this.room.game.members(room)].filter(
      (player) => !player.watcher,
    );
    const taken = new Set([
      ...seats
        .filter((player) => !pending.freed.has(player.id))
        .map((player) => player.slot),
      ...pending.slots,
    ]);
    const free = Array.from(
      { length: this.room.game.seating.capacity },
      (_, slot) => slot,
    ).find((slot) => !taken.has(slot));
    if (free !== undefined || this.room.game.stage(room) === "running")
      return free ?? -1;
    // An absent seat first, then an away one: a hidden page keeps its seat unless the room is full and a joiner asks
    // for it outside a running round (§12), which bounds how long one can hold a seat.
    const reclaimable = (player: Seat) =>
      !player.connected && !pending.freed.has(player.id);
    const seat =
      seats.find((player) => reclaimable(player) && !player.away) ??
      seats.find(reclaimable);
    if (!seat) return -1;
    this.room.recorder.append([LEAVE, seat.id]);
    return seat.slot;
  }
  selfMember(): Member {
    return this.room.members.self(
      this.room.generation,
      this.room.full,
      this.room.hidden,
    );
  }
  ensurePresence(id: string, member: Member): void {
    const player =
      this.room.world && this.room.game.seat(this.room.world.state, id);
    if (!player || (member.generation === 0 && id !== this.room.id)) return;
    if (player.connected && player.generation === member.generation) return;
    this.logPresence(id, member, true);
  }
  logPresence(id: string, member: Member, connected: boolean): void {
    const now = this.room.now(),
      pending = member.presence;
    if (
      pending &&
      pending.connected === connected &&
      (this.room.world!.tick < pending.tick || now - pending.at < 500)
    )
      return;
    const tick = this.room.recorder.append([
      PRESENCE,
      id,
      connected,
      member.generation,
    ]);
    member.presence = { connected, tick, at: now };
  }
  /** See `Membership.silent`: silence counted only over time in which this runtime could have heard the member. */
  silent(member: Member, now: number, ms: number): boolean {
    return this.room.members.silent(member, now, ms);
  }
  creatorDuties(now: number): void {
    const room = this.room.world!.state,
      // Its own seat away (the return is logged but not folded yet): every entry it appended would be discarded, and
      // the bookkeeping would suppress the valid one that follows. It waits for its return to fold.
      own = this.room.game.seat(room, this.room.id),
      stalled = now - this.room.lastLoopAt > DISCONNECT_MS / 2;
    if (own?.away) return;
    for (const [id, member] of this.room.members) {
      const player = this.room.game.seat(room, id);
      if (!player) continue;
      // An away member is judged by nobody while its page says it is hidden: its silence is expected, and its throttled
      // packets are not a return (they would flap a seat whose away entry went missing). Once its hello says the page
      // is visible again and its packets are heard, this is where the return is logged — every loop pass until the seat
      // is present, so a lost entry is simply logged again. The member's own return would be on a stream nobody waits
      // for, which is why the manager owns it (§12).
      if (member.hidden) continue;
      if (player.away) {
        if (now - member.lastPacketAt <= DISCONNECT_MS)
          this.ensurePresence(id, member);
        continue;
      }
      // Present again only on a packet; absent only on silence this runtime could have heard. In between — a link
      // just up and no packet yet — nothing is logged either way.
      const heard = now - member.lastPacketAt <= DISCONNECT_MS;
      // A creator whose own loop just stalled cannot tell silence from its own absence.
      if (
        player.connected &&
        !stalled &&
        this.silent(member, now, DISCONNECT_MS)
      )
        this.logPresence(id, member, false);
      else if (!player.connected && heard) this.ensurePresence(id, member);
    }
    const self = this.room.game.seat(room, this.room.id);
    if (self && !self.connected && !self.away)
      this.ensurePresence(this.room.id, this.selfMember());
  }
  /**
   * Succession: the lowest connected member that is still heard marks absent everyone ahead of it in the succession order
   * (the creator, then the lower-sorted members) once they have been silent for five seconds, so play continues whoever
   * dropped together. Every replica accepts those entries from any rider ranked behind the one it names.
   */
  actingCreatorDuties(now: number): void {
    const state = this.room.world!.state,
      // Away members rank here too (`permitted` ranks them the same for this one entry): a member whose last peer died
      // unlogged while it was away must be able to record that, or it can never return and the room has no manager.
      order = successionOrder(
        this.room.game.members(state),
        this.room.hostId,
        true,
      ),
      mine = order.indexOf(this.room.id);
    // No record at all: the service says that member is offline. A record not heard yet gets the same fair chance as above.
    const silent = (id: string) => {
      const member = this.room.members.get(id);
      return !member || this.silent(member, now, CREATOR_SILENCE_MS);
    };
    // Only a silent creator opens the succession: while it is heard, it alone marks riders absent, on its one-second rule.
    if (mine < 0 || !silent(this.room.hostId)) return;
    // A hidden page's packets arrive about once a second, right on the `DISCONNECT_MS` boundary, so it would win this
    // election every other pass and then do nothing (its duties are for visible pages): it is not counted as heard.
    const heard = (id: string) => {
      const member = this.room.members.get(id);
      return (
        id === this.room.id ||
        (member !== undefined &&
          !member.hidden &&
          now - member.lastPacketAt <= DISCONNECT_MS)
      );
    };
    if (order.slice(1).find(heard) !== this.room.id) return;
    for (const id of order.slice(0, mine)) {
      if (!this.room.game.seat(state, id)?.connected || !silent(id)) continue;
      this.logPresence(
        id,
        this.room.members.get(id) ?? this.selfMember(),
        false,
      );
    }
  }

  /**
   * Remove a human member the manager names. A rider goes between rounds only (`reclaimable`), the same rule as AI
   * removal and for a sharper reason: outside those phases `LEAVE` only marks a rider absent, and the manager's own
   * presence duties log it present again the moment they hear it (`creatorDuties`, `ensurePresence`), so the kick would
   * undo itself. A watcher holds no seat, so `LEAVE` frees it in any phase.
   *
   * The check is against the phase this replica has folded, while the entry is stamped a tick or more ahead, so a kick
   * issued in the last moments of a pause can still land in the round that follows. The outcome is therefore read back
   * from the fold (`settleKick`) rather than assumed: the target is told it was removed only once it is gone, and a kick
   * that did not take says so instead of failing silently.
   */
  kick(id: string): boolean {
    if (typeof id !== "string" || id === this.room.id) return false;
    const room = this.room.world!.state,
      seat = this.room.game.seat(room, id);
    if (!seat) {
      this.room.notice(this.room.text.kickGone);
      return false;
    }
    if (seat.bot) {
      this.room.notice(this.room.text.kickBot);
      return false;
    }
    if (!seat.watcher && this.room.game.stage(room) === "running") {
      this.room.notice(this.room.text.kickBetweenRounds);
      return false;
    }
    this.pendingKick = {
      id,
      tick: this.room.recorder.append([LEAVE, id]),
      attempts: 0,
    };
    return true;
  }
  /**
   * Once the kick's own tick has folded, say what it did. Gone: tell the target, so its join card says why its seat
   * went instead of leaving it to guess. Still listed: the entry landed inside a round and only marked the member
   * absent, which the presence duties will undo, so the manager is told to try again rather than believing it worked.
   * The message is a courtesy over an unreliable link — it is retried while the link comes up, and then given up on.
   */
  settleKick(): void {
    const pending = this.pendingKick;
    if (!pending || !this.room.world || this.room.world.tick < pending.tick)
      return;
    if (this.room.game.seat(this.room.world.state, pending.id)) {
      this.pendingKick = undefined;
      this.room.notice(this.room.text.kickInRound);
      return;
    }
    if (
      this.room.send(pending.id, { type: "kicked" }) ||
      ++pending.attempts >= KICK_NOTICE_ATTEMPTS
    )
      this.pendingKick = undefined;
  }
}
