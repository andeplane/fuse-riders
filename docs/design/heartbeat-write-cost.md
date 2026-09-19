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

`RoomStore.time` writes only when something the heartbeat keeps is within its renewal
margin on the deciding instance's clock:

- the member's own connection lease has ≤ 20 s of its 30 s left (`LEASE_RENEW_BELOW_MS`,
  two thirds), or
- for the creator naming its grant: the grant has ≤ 5 s of its 10 s left
  (`GRANT_RENEW_BELOW_MS`, half) **and** this claimant can still renew it (same identity,
  already valid, not expired). A grant that is not valid yet, or that belongs to a newer
  tab, is no reason to write, or
- the room deadline has ≤ 45 s of its 90 s left (`ROOM_RENEW_BELOW_MS`). This one is
  defensive: every write puts the deadline 60 s beyond the writer's lease, so the lease
  clause always fires first unless instance clocks disagree by more than 35 s or the
  lifetimes are changed.

The two margins differ because the two lapses cost differently (see
[what a lapse costs](#what-a-lapse-costs)): a lapsed member lease takes a rider out of
the game, a lapsed grant is invisible. The issue's "skip when more than half the lease
remains" applied to the member lease as well would save 675 more writes per room-hour
(1,725 instead of 2,400) and turn a 20-second absence from always safe into a 3-in-8
chance of leaving the game.

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
10,800 of them per room-hour against 4,800, more than twice the remaining reads.

**Can a stale copy wrongly accept a replaced connection?** It can _answer_ one, and only
that. The copy is older than the stored room, never newer, so:

- Nothing is written on the skipped path. A replaced connection's heartbeat cannot take
  the seat back, renew a lease or a grant, or move the room deadline. Fencing of stored
  state is untouched: the first heartbeat that would write runs the transaction, which
  compares connection ids and refuses with 409 (4001). That is at most one renewal period
  away — 10 s for a guest, 6 s for a creator.
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
due heartbeat: within 10 s rather than within 2 s. That is the one promptness guarantee
this change weakens, and only while the watch is behind.

**Clock skew.** A member's lease is written and judged by the same instance (the one
holding its socket), so skew between instances does not enter. The room deadline and the
grant can be judged by another instance: tens of milliseconds against margins of 45 s and
5 s. `end` stays absolute (#262). Two instances never alternate writes for one member.

### A lapsed lease now reconnects

Renewing later makes one existing fault matter more, so it is fixed here. The gateway's
pre-check reported a lapsed lease as 409 "Connection replaced", which closes
4001; the browser treats 4001 as terminal ("This host tab was replaced — use the newer
tab"), also for guests. The store's own answer for that case was always 410. The gateway
now says 410 (close 4000, the browser reconnects and is re-admitted) for a lapsed or
pruned seat, and keeps 4001 for a seat another connection holds. `RoomStore.time` draws the
same line: a seat that is missing is 410, a seat held by another connection is 409.

## Worst cases

A delivered heartbeat either renews (full lifetime left) or is skipped with more than the
renewal margin left. So **any silence shorter than the margin is always safe** — more than
20 s for a member lease, more than 5 s for a grant — where before any silence shorter than
the whole lifetime was. With a 2 s cadence the last skipped heartbeat leaves 22 s (lease)
or 6 s (grant).

| Situation                                                    | Member lease (30 s, renewed at ≤ 20 s)                                                   | Creator grant (10 s, renewed at ≤ 5 s)                                     | Room deadline (90 s)        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------- |
| Steady 2 s                                                   | written every 10 s with 20 s left                                                        | written every 6 s with 4 s left                                            | never below 80 s            |
| Throttled to 1 Hz                                            | every 10 s, 20 s left                                                                    | every 5 s, 5 s left                                                        | ≥ 80 s                      |
| Throttled to 0.2 Hz (5 s)                                    | every 10 s, 20 s left                                                                    | every heartbeat, 5 s left — identical to before                            | ≥ 80 s                      |
| Consecutive heartbeats missed at the worst moment (2 s)      | 9 survive (the next arrives with 2 s left), 10 lapse. Before: 13 and 14                  | 1 survives, 2 lapse. Before: 3 and 4                                       | —                           |
| Silence (hidden phone, paused instance) that is always safe  | < 22 s. Before: < 30 s                                                                   | < 6 s. Before: < 10 s                                                      | < 80 s, every member silent |
| Chance that a silence of 20 s / 25 s / 28 s lapses the lease | 0 / 2 in 5 / 4 in 5. Before: 0 / 0 / 0. With the lease at half: 3 in 8 / 5 in 8 / 7 in 8 | —                                                                          | —                           |
| Cadence of 10 s or slower                                    | every heartbeat writes: identical to before, and nothing is saved                        | identical to before                                                        | identical                   |
| 30% of heartbeats lost independently (simulated, 200,000 h)  | 0.002 lapses per guest-hour. Before: 0.00007. With the lease at half: 0.047              | first lapse after about 1.3 min, then stays expired. Before: about 5.8 min | none                        |

The chances in the sixth row count the phases of the renewal cycle: the last delivered
heartbeat is 0, 2, 4, 6 or 8 s after a write (five equally likely phases; with the lease at
half, eight phases up to 14 s), and a silence of `d` lapses the lease when that age plus
`d` reaches 30 s.

### What a lapse costs

A lapsed member lease is **not** a relink. Read from source:

1. The returning heartbeat finds the seat lapsed: `RoomGateway.handle` throws 410,
   `RoomGateway.receive` closes the socket 4000 and calls `disconnect`, which runs
   `RoomStore.leave` and removes the seat (`packages/fuse-network-be/src/gateway.ts`,
   `room-store.ts`).
2. That commit reaches every instance's `observe`, which sends the other members
   `peer … online:false`.
3. On the managing device `RoomRuntime.peer` (`packages/fuse-netcode/src/room-runtime.ts`) appends `LEAVE`
   for a rider that is in the world.
4. `applyManagement`, `case LEAVE` (`games/fuse-riders/src/engine/apply-tick.ts`): in a reclaimable phase
   (`RECLAIMABLE_PHASES`: lobby, round over, match over) `removePlayer` takes the rider
   **off the roster** — they have to join again through the join card. Mid-round the rider
   stays but is marked disconnected and their controls go neutral.
5. The returning browser retries (`handleRoomSocketClose`), is re-admitted with a new
   connection id, and on `welcome` `PeerTransport` closes **every** `RTCPeerConnection` it
   had and clears its links (`packages/fuse-network-fe/src/peer-transport.ts`): a full
   re-mesh, then a world snapshot from a peer.

Before this change an absence of up to 30 s cost none of that: the socket stayed seated
and only the presence flag flipped and restored itself. That is why the member lease keeps
two thirds of its lifetime as margin: a phone that was backgrounded for 20 s comes back to
a lease that is still live in every phase of the renewal cycle; with the lease at half it
would have left the game 3 times in 8.

A lapsed grant costs nothing a player can see: the creator's seat is unaffected, the stored
grant stays expired until the creator next connects (as it did before), a later duplicate
tab's grant is valid at once, and the old tab closes itself as designed.

A WebSocket does not drop frames, so independent loss is a stress model rather than a
forecast; what really happens is silence (a hidden or suspended tab), which the "always
safe" and "chance" rows describe.

## Cost of a six-member room-hour

3,600 s / 2 s = 1,800 heartbeats per member, 10,800 for the room. `G` is the number of
instances watching the room (1 or 2; Cloud Run is capped at two). Every committed write
bills one write, one read inside its transaction, and one listener read per watching
instance.

|                                  | Before                 | After                                                                    |
| -------------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| Writes                           | 6 × 1,800 = **10,800** | creator 3,600/6 = 600, guests 5 × 3,600/10 = 5 × 360 = 1,800 → **2,400** |
| Transaction reads                | 10,800                 | 2,400                                                                    |
| Listener reads                   | 10,800 × G             | 2,400 × G                                                                |
| Reads added by the skip decision | —                      | **0** (it reads the copy the instance already holds)                     |
| Total reads, G = 1 / G = 2       | 21,600 / 32,400        | 4,800 / 7,200                                                            |

The creator writes for its grant every 6 s, which also renews its lease long before the
lease's own margin (24 s left), so it counts once. Firestore's list price puts a read at
about a third of a write, so in write-equivalents (G = 1): 10,800 + 21,600/3 = 18,000
before, 2,400 + 4,800/3 = 4,000 after: **−78%**. Writes alone: −78% (2,400 / 10,800 =
22%). A room whose creator has left writes 360 per member-hour. Had the decision used a
Firestore read per heartbeat instead, the total would be 2,400 + (10,800 + 2,400)/3 =
6,800: −62%. With the member lease at half as well: 600 + 5 × 225 = 1,725 writes, 2,875
write-equivalents, −84% — rejected for what a lapse costs.

The write count is asserted by a test that runs those 10,800 heartbeats through the real
gateway and store. The read and listener figures are counted from the same test (zero
reads, one notification per commit and watcher) and multiplied by Firestore's billing
rules as documented; **they were not measured on a bill**.

## Verification and limits

`packages/fuse-network-be/tests/heartbeat-cost.test.ts` uses injected clocks, the public
store and gateway API and the real `MemoryRoomDatabase` behind a counting wrapper that
can also hold back one instance's watch. It covers the write budget, identical answers,
2 s / 1 Hz → 0.2 Hz cadences, the nine-missed-heartbeats boundary, 409 / 410 / 404 on the
very next store call (410 for a missing seat too), the stale-copy argument above, end and natural
expiry closing 4004, a stalled watch, two instances 40 ms apart, grant renewal and
duplicate-creator fencing. Heartbeat loss is checked as an invariant rather than a lucky
seed: for 50 seeds at 30% loss and 10 at 60%, a seat closes only after at least ten
consecutive missed heartbeats, closes 4000 and never 4001, and is re-admitted on reconnect
(2 lapses in those 300 member-hours at 30%, 91 in 60 at 60%, the shortest run exactly
ten). The #262 lifetime tests pass unchanged. One existing test
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

Regressions that exist only while a watch snapshot is late, none of them exercised against
live Firestore:

- A replaced guest socket can stay open for up to 10 s (8 s in the stalled-watch test)
  instead of 2 s; a replaced creator socket up to 6 s. In that window it can write nothing.
  It can still send signals; the receiving gateway checks the sender's connection against its own copy before delivering one, and against the stored room when the two differ.
- Another instance's copy of a member shows that member's lease as lapsed (and drops
  signals addressed to it) once a snapshot is more than 20 s late; before, more than 28 s.
- An end is noticed by a member within 10 s (creator 6 s) instead of 2 s.
- A watch that never delivers cannot freeze skipping: the frozen copy ages until its leases
  read as due, and every heartbeat from then on runs the transaction.

This is a service behaviour change and takes effect with a backend deploy; merging does
not publish it. Instances of both versions can run side by side: an old instance simply
keeps writing every heartbeat for its own members. Rolling back restores that.
