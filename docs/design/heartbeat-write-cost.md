# Heartbeats that change nothing write nothing

Implements #256 S4. Every member sends the room service a `time` frame every two seconds.
Each one was a Firestore transaction on the room's single document: it set the member's
lease, the room deadline and (for the creator) the grant to "now + lifetime", bumped
`revision`, and so pushed an `onSnapshot` to every service instance watching the room.
Six members make 10,800 such writes per room-hour, and almost all of them change nothing
but timestamps. The production database reports `freeTier: false`
([inventory](../online/GCP-INVENTORY.md)), so each one is billed.

## What the heartbeat is for

| Consumer                                                                                                                                                                                                                                               | Lifetime                                    | Needs a 2 s request?                                                         | Needs a write every 2 s?                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Member lease (`CONNECTION_TTL_MS`): a seat whose instance died, or whose socket is half-open, frees itself; admission prunes lapsed seats and `welcome` hides them                                                                                     | 30 s                                        | No                                                                           | No: only before the lease runs out                                       |
| Room deadline (`ROOM_TTL_MS`, [#262](member-kept-room-lifetime.md)): any member's heartbeat keeps the room; an explicit end writes the absolute `ROOM_ENDED_AT`                                                                                        | 90 s                                        | No                                                                           | No                                                                       |
| Creator's authority grant (`LEASE_MS`): fences a duplicate creator tab. A new tab's grant is valid only from the old grant's expiry + 250 ms, and the old tab closes itself once its service clock says the newer grant is valid                       | 10 s                                        | Yes, see next row                                                            | No: the grant is only ever extended, so a write is needed before it ends |
| Service clock sample (`serviceTime` in the answer → `AuthorityClock`): the only reader is that duplicate-tab check. A sample older than 4 s, or a 1.5 s gap between checks, invalidates it                                                             | 4 s                                         | **Yes** for the creator. Guests send the same frame but never read the clock | No: it is the answer, not the write, that carries the time               |
| Roster and grant fan-out: `revision` + `onSnapshot` tell other instances about admissions, departures, replacements and grant changes                                                                                                                  | —                                           | No                                                                           | No: a renewal changes no roster; it rode the same revision bump for free |
| Prompt refusal: a heartbeat on an ended or expired room closes 4004, on a replaced connection 4001. The gateway checks its watched copy of the room before every frame, and `end` reaches sockets only through that watch (`http.ts` calls no gateway) | —                                           | Helps: a frame is what triggers the check when no snapshot arrives           | No                                                                       |
| `cleanupAt`, Firestore's TTL field, always equal to the room deadline                                                                                                                                                                                  | ≥ 24 h of slack in Firestore's own deletion | No                                                                           | No                                                                       |

So the _request_ cadence and the _write_ cadence are different things. The creator's clock
needs the two-second answer; nothing needs the two-second write.

## The rule

`RoomStore.time` writes only when a lease the heartbeat keeps is **at or below half its
lifetime** (`RENEW_BELOW_FRACTION`, one constant) on the deciding instance's clock:

- the member's own connection lease has ≤ 15 s left, or
- the room deadline has ≤ 45 s left, or
- for the creator naming its grant: the grant has ≤ 5 s left **and** this claimant can
  still renew it (same identity, already valid, not expired). A grant that is not valid
  yet, or that belongs to a newer tab, is no reason to write.

A heartbeat that writes renews all three, exactly as before. One that does not write is
answered with the same frame (`type`, `id`, `sentAt`, `serviceTime`, `grant`), so a cached
old page sees no difference. There is **no client change**: a slower client timer would
save nothing more in Firestore (a skipped heartbeat costs no operation), would lose the
creator's clock sample, and would shrink the margins below from "several missed
heartbeats" to "one". It also keeps this change clear of the reconnect work in #279.

### Where the decision reads the room

The gateway already holds a watched copy of every room it serves (`observe`), and already
refuses a frame against it before doing anything else. `time` is now given that copy:

1. If the copy shows a live room, this exact connection seated with a live lease, and
   nothing due, the heartbeat is answered from it. **No Firestore operation at all.**
2. Otherwise the transaction runs as before and decides again on the stored room: refuse
   (404 ended or expired, 409 replaced, 410 lease lapsed), commit a renewal, or — if
   another writer already renewed what the copy showed as due — commit nothing.

A caller with no copy (tests, scripts) gets step 2 on every heartbeat: a read-only
transaction, one billed read, authoritative.

A Firestore read per heartbeat was the alternative. It would make every heartbeat
authoritative, but reads are what is left once the writes are gone (arithmetic below):
10,800 of them per room-hour against 3,450, twice the remaining bill.

**Can a stale copy wrongly accept a replaced connection?** It can _answer_ one, and only
that. The copy is older than the stored room, never newer, so:

- Nothing is written on the skipped path. A replaced connection's heartbeat cannot take
  the seat back, renew a lease or a grant, or move the room deadline. Fencing of stored
  state is untouched: the first heartbeat that would write runs the transaction, which
  compares connection ids and refuses with 409 (4001). That is at most one renewal period
  away — 16 s for a guest, 6 s for a creator.
- Leases in a stale copy are never _longer_ than the stored ones (only this member's own
  instance extends its lease, and it applies its own result to the copy before the next
  frame). A stale copy can make a write happen early; it cannot let a lease lapse.
- A replacement admitted by the _same_ instance updates the copy inside the admission
  itself and closes the old socket there. Across instances the snapshot closes it. The
  bound above only applies while that snapshot is late; a listener that _fails_ already
  closes every socket of the instance (1012).
- The old creator tab keeps being told its old grant while the snapshot is late. It cannot
  renew it, so the stored grant still ends within 10 s, and the new tab's grant still
  starts 250 ms after that.

**Ended rooms.** `end` writes `expiresAt = 0`; the snapshot closes every socket of the
room 4004 at once, heartbeat or not — this was already the only way an end reached other
members. A room that runs out its deadline is refused from the copy on the next frame.
While a snapshot is late, heartbeats are still answered and the 4004 arrives with the next
due heartbeat: within 16 s rather than within 2 s. That is the one promptness guarantee
this change weakens, and only while the watch is behind.

**Clock skew.** A member's lease is written and judged by the same instance (the one
holding its socket), so skew between instances does not enter. The room deadline and the
grant can be judged by another instance: tens of milliseconds against margins of 45 s and
5 s. `end` stays absolute (#262). Two instances never alternate writes for one member.

### A lapsed lease now reconnects

Halving the renewal point makes one existing fault matter more, so it is fixed here. The
gateway's pre-check reported a lapsed lease as 409 "Connection replaced", which closes
4001; the browser treats 4001 as terminal ("This host tab was replaced — use the newer
tab"), also for guests. The store's own answer for that case was always 410. The gateway
now says 410 (close 4000, the browser reconnects and is re-admitted) for a lapsed or
pruned seat, and keeps 4001 for a seat another connection holds.

## Worst cases

A delivered heartbeat either renews (full lifetime left) or is skipped with more than half
left. So **any silence shorter than half a lifetime is always safe**, where before any
silence shorter than the whole lifetime was. With a 2 s cadence the last skipped heartbeat
leaves 16 s (lease) or 6 s (grant).

| Situation                                                   | Member lease (30 s)                                                                                     | Creator grant (10 s)                                                       | Room deadline (90 s)        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------- |
| Steady 2 s                                                  | written every 16 s with 14 s left                                                                       | written every 6 s with 4 s left                                            | never below 74 s            |
| Throttled to 1 Hz                                           | every 15 s, 15 s left                                                                                   | every 5 s, 5 s left                                                        | ≥ 75 s                      |
| Throttled to 0.2 Hz (5 s)                                   | every 15 s, 15 s left                                                                                   | every heartbeat, 5 s left — identical to before                            | ≥ 75 s                      |
| Consecutive heartbeats missed at the worst moment (2 s)     | 6 survive (the next arrives with 2 s left), 7 lapse. Before: 13 and 14                                  | 1 survives, 2 lapse. Before: 3 and 4                                       | —                           |
| Silence (hidden phone, paused instance) that is always safe | < 16 s. Before: < 30 s                                                                                  | < 6 s. Before: < 10 s                                                      | < 74 s, every member silent |
| Cadence of 15 s or slower                                   | every heartbeat writes: identical to before, and nothing is saved                                       | identical to before                                                        | identical                   |
| 30% of heartbeats lost independently (simulated, 200,000 h) | 0.047 lapses per guest-hour. Before: 0.00007. Renewing at 20 s left instead: 0.002, for 360 writes/hour | first lapse after about 1.3 min, then stays expired. Before: about 5.8 min | none                        |

What a lapse costs: the member's next heartbeat closes its socket 4000, the browser
reconnects, is re-admitted with a new connection id, and its peers relink. Nothing is lost
for good, but a phone that was away for 20 s may now relink where it used not to. A lapsed
grant costs nothing a player can see: the creator's seat is unaffected and a new creator
tab's grant simply starts sooner; the stored grant stays expired until the creator next
connects, as it did before.

A WebSocket does not drop frames, so independent loss is a stress model rather than a
forecast; what really happens is silence (a hidden or suspended tab), which the "always
safe" row bounds. If field reports show relinks after short absences, raise
`RENEW_BELOW_FRACTION` to 2/3: always-safe silence becomes 22 s for 360 instead of 225
writes per guest-hour.

## Cost of a six-member room-hour

3,600 s / 2 s = 1,800 heartbeats per member, 10,800 for the room. `G` is the number of
instances watching the room (1 or 2; Cloud Run is capped at two). Every committed write
bills one write, one read inside its transaction, and one listener read per watching
instance.

|                                  | Before                 | After                                                                    |
| -------------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| Writes                           | 6 × 1,800 = **10,800** | creator 3,600/6 = 600, guests 5 × 3,600/16 = 5 × 225 = 1,125 → **1,725** |
| Transaction reads                | 10,800                 | 1,725                                                                    |
| Listener reads                   | 10,800 × G             | 1,725 × G                                                                |
| Reads added by the skip decision | —                      | **0** (it reads the copy the instance already holds)                     |
| Total reads, G = 1 / G = 2       | 21,600 / 32,400        | 3,450 / 5,175                                                            |

Firestore's list price puts a read at about a third of a write, so in write-equivalents
(G = 1): 10,800 + 21,600/3 = 18,000 before, 1,725 + 3,450/3 = 2,875 after: **−84%**.
Writes alone: −84% (1,725 / 10,800 = 16%). The creator is now most of what remains
(600 of 1,725) because its 10 s grant has the shortest half-life; a room whose creator has
left writes 225 per member-hour. Had the decision used a Firestore read per heartbeat
instead, the total would be 1,725 + (10,800 + 1,725)/3 = 5,900: −67%.

The write count is asserted by a test that runs those 10,800 heartbeats through the real
gateway and store. The read and listener figures are counted from the same test (zero
reads, one notification per commit and watcher) and multiplied by Firestore's billing
rules as documented; **they were not measured on a bill**.

## Verification and limits

`packages/fuse-network-be/tests/heartbeat-cost.test.ts` uses injected clocks, the public
store and gateway API and the real `MemoryRoomDatabase` behind a counting wrapper that
can also hold back one instance's watch. It covers the write budget, identical answers,
2 s / 1 Hz → 0.2 Hz cadences, seeded 30% loss, the six-missed-heartbeats boundary, 409 /
410 / 404 on the very next store call, the stale-copy argument above, end and natural
expiry closing 4004, a stalled watch, two instances 40 ms apart, grant renewal and
duplicate-creator fencing. The #262 lifetime tests pass unchanged. One existing test
renewed a grant 3 s into its lease and asserted the new expiry; it now does so at 6 s,
where a renewal is due.

The Firestore adapter is unchanged: a skipped heartbeat never reaches it, and a
transaction that returns no room was already a supported outcome (`leave` by a replaced
connection). It has no unit tests and is outside CI, so **behaviour against live
Firestore — snapshot latency in particular, which bounds how late an end or a replacement
can be noticed — is unverified.** `scripts/gcp-service-smoke.ts` and
`scripts/cloud-public-smoke.ts` send a renewal right after admission and check that an
answer carrying a grant no older than the last one comes back. That still passes, but the
answer now comes from the instance's copy, so those steps no longer prove a renewal
_transaction_ against Firestore; they would have to wait out half the grant (6 s) first.
Neither script was run or changed here.

This is a service behaviour change and takes effect with a backend deploy; merging does
not publish it. Instances of both versions can run side by side: an old instance simply
keeps writing every heartbeat for its own members. Rolling back restores that.
