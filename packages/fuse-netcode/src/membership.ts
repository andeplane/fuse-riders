/**
 * The member table: who the room service says is here, and everything this replica has learned about each of them from
 * their hellos and packets. It holds no world and writes no entries — it answers "who is here, what did they announce,
 * when were they last heard" for the runtime, the room manager and the world sync.
 */

/** Whether a peer announcing `theirs` is ahead of `mine`, behind it, or not comparable (another game, or no `<prefix>-<n>` form). */
const rulesNumber = (
  rules: unknown,
): { prefix: string; number: number } | undefined => {
  const match = typeof rules === "string" && /^(.+)-(\d+)$/.exec(rules);
  return match ? { prefix: match[1]!, number: Number(match[2]) } : undefined;
};
export function rulesAge(
  mine: string,
  theirs: unknown,
): "newer" | "older" | "unknown" {
  const own = rulesNumber(mine),
    other = rulesNumber(theirs);
  if (
    own === undefined ||
    other === undefined ||
    own.prefix !== other.prefix ||
    own.number === other.number
  )
    return "unknown";
  return other.number > own.number ? "newer" : "older";
}

/** How long a member this runtime has never heard is given for its link to come up before that counts as silence. */
export const LINK_WAIT_MS = 5000;

export interface Member {
  generation: number;
  snapshotServedAt: number;
  lastPacketAt: number;
  lastSentAt: number;
  lastSentReceivedAt: number;
  rttMs?: number;
  full: boolean;
  nackAt: number;
  helloed: boolean;
  clockTick?: number;
  gapSince: number;
  rejected: number;
  /** The peer's hello announced different `RULES`: its stream, joins and snapshots are refused until a matching hello. */
  refused: boolean;
  /** The rules a refused peer announced, so the status can say which side is out of date. */
  rules?: string;
  /** Since when every packet from this member has fallen outside this replica's window; -Infinity once one is taken. */
  windowSince: number;
  /** When this runtime learned of the member's current connection: the start of the wait for a link that never comes up. */
  since: number;
  /** When the link to the member's current connection was first seen usable, so its packets could arrive; -Infinity until then. */
  linkedAt: number;
  presence?: { connected: boolean; tick: number; at: number };
  /** The member's last hello said its page is hidden: its world is frozen and it cannot serve one (§12). */
  hidden: boolean;
}

/**
 * Every member the room service has told this replica about, keyed by id. `Membership` is iterable and reads like the
 * `Map<string, Member>` it replaced — `get`, `has`, `values`, `size`, `for…of` — so callers that only look at members
 * are unchanged; the transitions the room service drives go through `connect` and `forget`.
 */
export class Membership {
  private readonly members = new Map<string, Member>();
  /** When this runtime first held a world: before that it could judge nobody, so no wait for a link starts earlier. */
  judgingSince = -Infinity;
  constructor(private readonly now: () => number) {}
  get size(): number {
    return this.members.size;
  }
  get(id: string): Member | undefined {
    return this.members.get(id);
  }
  has(id: string): boolean {
    return this.members.has(id);
  }
  values(): IterableIterator<Member> {
    return this.members.values();
  }
  [Symbol.iterator](): IterableIterator<[string, Member]> {
    return this.members.entries();
  }
  /**
   * The room service says this member is online. The same member on a new connection (a reload the service saw before
   * the old socket closed): the transport has dropped the old link, and the new page cannot be heard before its own
   * link is up. A member never heard gets the whole link wait again, for the connection that can now link.
   */
  connect(id: string): void {
    const known = this.members.get(id);
    if (known) {
      known.linkedAt = -Infinity;
      known.since = this.now();
      return;
    }
    this.members.set(id, {
      generation: 0,
      snapshotServedAt: -Infinity,
      lastPacketAt: -Infinity,
      lastSentAt: 0,
      lastSentReceivedAt: 0,
      full: true,
      nackAt: -Infinity,
      helloed: false,
      gapSince: -Infinity,
      rejected: 0,
      refused: false,
      windowSince: -Infinity,
      since: this.now(),
      linkedAt: -Infinity,
      hidden: false,
    });
  }
  forget(id: string): void {
    this.members.delete(id);
  }
  /** This device's own record, for the code paths that judge it the same way as a peer's. */
  self(generation: number, full: boolean, hidden: boolean): Member {
    return {
      generation,
      snapshotServedAt: -Infinity,
      lastPacketAt: this.now(),
      lastSentAt: 0,
      lastSentReceivedAt: 0,
      full,
      nackAt: 0,
      helloed: true,
      gapSince: -Infinity,
      rejected: 0,
      refused: false,
      windowSince: -Infinity,
      since: -Infinity,
      linkedAt: -Infinity,
      hidden,
    };
  }
  /**
   * Whether `member` has been silent for `ms`, counting only time in which this runtime could have heard it: since its
   * last packet, or since the link to its current connection became usable if that is later. A page that has just
   * loaded has heard nobody, and a page that has just loaded cannot be heard — neither is silence. A member never heard
   * whose link never comes up is given `LINK_WAIT_MS`, counted from when this runtime learned of its connection or from
   * when it first held a world, whichever is later: a page whose own first link or snapshot took five seconds has
   * only then begun to wait for the others. Without this a reloaded creator logged every member it had not heard YET as
   * absent in its second pass, and a round boundary or lobby reset inside that window took a healthy member's seat. The
   * link counts once per connection, so a flapping link cannot stand in for packets.
   */
  silent(member: Member, now: number, ms: number): boolean {
    const from = Math.max(member.lastPacketAt, member.linkedAt);
    return from === -Infinity
      ? now - Math.max(member.since, this.judgingSince) >
          Math.max(ms, LINK_WAIT_MS)
      : now - from > ms;
  }
  /** Members whose world could be this one: everyone but those refused for announcing different rules. */
  compatible(): string[] {
    return [...this.members]
      .filter(([, member]) => !member.refused)
      .map(([id]) => id);
  }
  /** Every hello mismatch this replica is holding, as ages against its own rules. */
  refusedAges(rules: string): Set<"newer" | "older" | "unknown"> {
    return new Set(
      [...this.members.values()]
        .filter((member) => member.refused)
        .map((member) => rulesAge(rules, member.rules)),
    );
  }
  /** Peers that asked to be greeted again: the next tick-loop pass sends each a fresh hello. */
  regreetAll(): void {
    for (const member of this.members.values()) member.helloed = false;
  }
}
