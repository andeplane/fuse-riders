# Signalling abuse stays within its room

Issue #256 S1/S2 is reproducible in the extracted networking service: all local
and bus deliveries shared a 4096-ID dedupe window whose overflow restarted every
room, while database admission and departure shared one gateway-wide queue.

Each live room now owns a 512-ID bus-only dedupe window. Overflow drops the new
frame, preserves already accepted IDs, and never restarts the gateway. Entries
expire within ten seconds; removing or replacing the room releases its window.
Local delivery has no retry window. Signalling is rate limited per sender and
target, and a refused frame is dropped rather than closing the sender; the
section below carries the rule and its arithmetic. The slow-socket limit remains.

Admission and departure serialize per room. Only bus start/stop transitions
remain globally serialized; active room operations keep the shared bus alive.
A bus failure fences admissions already awaiting the database, so they cannot
publish a welcome against a restarted subscription. Shutdown waits for pending
room work before removing its sockets.

WebSocket admission checks a shared, separately namespaced budget of 30 failures
per IP per hour. Successful admissions and operational failures do not spend it.
The database allowance supports non-consuming checks. Each gateway also bounds
pending admissions to four per IP and 128 total, before database access; it caches
blocked IPs for that hour in a bounded map. Parallel requests already admitted
past the budget check can exceed the hourly failure limit by the bounded local
in-flight count on each active gateway. This is an abuse limit, not authentication:
room codes and the trusted-member mesh model are unchanged.

The protocol envelopes and database room records do not change. Existing room
creation limits retain their keys and accounting. The Firestore allowance
collection retains its existing name; admission uses distinct hashed keys.
No game simulation, gameplay relay, new hosted service or stored gameplay state is added.

## Signalling rate limit

The first version of this limit gave each connection one bucket of 32 signal
frames refilled at five a second, and closed the socket `1008` when it ran out.
That closed honest pages. A page reloading into a five-rider room sends 36 signal
frames in about 30 ms (four links, one description and eight candidates each);
the gateway closed it 30 ms after a normal welcome. The page reconnected 1.5 s
later with a fresh bucket; a welcome closes every `RTCPeerConnection`, so it sent
the same burst and was closed again: 19 closes in 27 s in one measured run, and
runs that passed peaked at exactly 32 frames. Two older limits in the same path
had the same shape: 100 frames a second for anyone but the creator, and 64 frames
waiting on the database or bus, both closing `1008`.

### What an honest page sends

- A full room is the creator and five guests (`ROOM_LIMITS.maxGuests`), so a
  member has **L = 5** links, and a reload or a socket reconnect negotiates all
  of them at once.
- The client sends one frame per description and one per trickled candidate;
  `validSignal` admits exactly one of either per frame, so there is no batch
  shape to use. The `null` end-of-candidates event is not sent; Firefox's
  empty-candidate marker is, once per media section (**E ≤ 2**).
- Candidates per link, **C**: 8 measured in headless Chromium on loopback. Since
  voice chat the offer carries an audio and a data section, and the browser
  gathers for both until the answer bundles them. A laptop with Wi-Fi, a second
  interface or VPN, IPv6, server-reflexive and TURN candidates sends 16–24. The
  ceiling taken here is 64, the most `RemoteSignal` holds for one link.
- One negotiation of one link is therefore 1 + C + E frames: 9 measured, 27 on a
  rich network, **67** at the ceiling. A rejoin is L times that at once: 36
  measured (four links), 135 rich, **335** at the ceiling.
- `LinkRestartPolicy` allows one ICE restart per link every 8 s, four in a row,
  and each gathers afresh: up to 67 frames per link per 8 s (8.4 a second), 335
  across all five.
- Voice adds no negotiation of its own: the audio transceiver is in the first
  offer and mute, unmute and device changes are `replaceTrack`. A future media
  renegotiation would be one description each way per link.
- The `time` heartbeat is one frame every 2 s.

### The rule

Free work (a same-gateway relay) is limited per link; paid work (a bus publish,
a database read, a database transaction, bytes) has its own smaller bound.

- **Per sender and target member: 80 frames, refilled at 10 a second.** 80 covers
  one negotiation at the ceiling (67) with room for a restart offer; 10 a second
  refills a whole negotiation within the 8 s restart interval. A rejoin into a
  full room gets five independent allowances instead of a fifth of one. The
  bucket is charged before the target is resolved, so a refused frame costs no
  database read and no bus publish. Buckets belong to the connection and are
  pruned to the current members: memory is one bucket per member plus one.
- **Frames that name no current connection share one bucket of 16, refilled at 1
  a second**: an unknown member, or a connection id the gateway's view has
  replaced. Such a frame is never relayed and costs an authoritative database
  read, so it must not draw on a member's own 80. A client learns connection ids
  only from its gateway's view, so its id for a peer is never newer than the
  gateway's; an honest page sends a stale one only in the moment between a peer's
  reload and hearing of it, and those frames were always dropped.
- **Publishes: each room may publish 512 billed kilobytes to each other gateway,
  refilled at 51.2 a second**, a frame counting as at least one. This is the
  receiving dedupe window (512 ids, 10 s) seen from the side that pays: anything
  above it was dropped on arrival anyway, after the publish and the delivery had
  been paid for. It is kept by the gateway per room and destination, not by a
  connection or a view, so reconnecting, or joining under a newly minted token,
  buys nothing; an idle bucket is forgotten once it would be full again, and at
  most 4096 are held. Same-gateway relays are free and are not counted.
- **`time` frames: 8, refilled at 2 a second.** Each is a database transaction;
  the heartbeat is one every 2 s with a few more around a welcome or a lease
  change.
- **All frames: 400 and 256 kB a second for every member.** A guest links to as
  many peers as the creator, and gameplay never transits the service, so the
  creator's old 2 MB has no honest use. The ceiling burst of 335 frames fits:
  measured in Chromium a description frame is 1.8 kB (audio and data sections)
  and a candidate frame 340 B, so the ceiling burst is 120–140 kB.
- **Waiting on the database or bus: 400 frames and 2 MB.** `ws` hands over every
  frame that arrived in one read in the same turn, and a cross-gateway frame
  waits for its publish, so a burst is briefly all pending. The byte bound is the
  memory the old 64 × 32 kB cap allowed.
- **A refused frame is dropped and the socket stays open**, whichever bound
  refused it. The sender gets
  `{"type":"notice","notice":"signal-throttled","dropped":n}` at most once a
  second, `n` counting drops since the previous notice. Deployed clients ignore
  unknown frame types. A dropped candidate costs nothing ICE cannot do without. A
  dropped offer or answer leaves the link without probe acknowledgements; after
  8 s `LinkHealth.shouldRestart` lets the initiator send a fresh offer, which the
  answerer accepts whether or not it ever saw the first, up to four times. The
  cost of a drop is a late link, never a torn-down mesh.
- **Only a flood closes.** Each refused frame spends a tolerance of 400, refilled
  at 50 a second. No honest workload above reaches it: a whole rejoin refused by
  a room's exhausted publish allowance is at most 335. Ten times the per-link
  refill to one target is closed after about ten seconds; a storm above the frame
  cap within the second. The close is `1008 "Signalling flood"`. No close code
  makes a deployed client wait (even with reconnect backoff a welcomed socket
  resets it), so for 60 s that member's new connections to the same gateway start
  each link bucket at 10 frames rather than 80. That is a courtesy to the peers
  of a broken client, not a cost bound: it follows a flood close only, it is
  per gateway instance (at most 1024 members remembered), and a guest can mint
  another token. An ordinary reconnect does get fresh link buckets; what it
  cannot get is more paid work, which the bounds above meter per room and per
  connection-second.

### Honest margins against the paid bounds

- Rich network, whole room renegotiating at once (a gateway restart), members
  split three and three: 9 cross-gateway links × 27 frames = 243 frames, about
  250 billed kilobytes, into each gateway. Under 512: nothing is refused.
- The same at the 64-candidate ceiling is 603 frames, about 610 kB. The receiving
  window already dropped the last 91; the sending gateway now refuses the last
  ~98 (trailing candidates) before paying for them. No socket closes and
  same-gateway links are whole.
- One member rejoining: at most 3–5 remote links × 67 = 335 frames, inside the
  room's 512 unless the room has just spent it.
- Thin spot, accepted: two negotiations of one link t seconds apart (a peer
  reloading twice) fit while 2 × (1 + C + E) ≤ 80 + 10t. Back to back that is any
  network up to 37 candidates a link; at the 64-candidate ceiling they must be
  5.4 s apart, and closer than that the last candidates of the second
  negotiation, usually server-reflexive ones, are dropped. The link still forms
  from the others or restarts after 8 s.
- In a room whose publish allowance a hostile member is holding empty, honest
  members' cross-gateway frames are refused too, descriptions included. That is
  the same room the hostile member could already spoil; other rooms have their
  own allowance.

### What abuse is bounded to

Worst cases assume the deployment's two instances of 80 sockets each, all 160
held by one attacker. Dollar figures are rough estimates from list prices
(Pub/Sub about $40 per TiB, charged on publish and again on delivery; Firestore
about $0.06 per 100k reads and $0.18 per 100k writes) and are for comparing the
three designs, not for budgeting.

| Bound                               | `main` before this change    | per-link buckets alone                                   | now                                                                                                                    |
| ----------------------------------- | ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Relayed frames, per connection      | 32 + 5/s                     | 80 + 10/s per target, 400 in a second                    | the same                                                                                                               |
| Publishes, per connection           | 32 + 5/s, fresh on reconnect | 400 + 60/s, fresh on reconnect (240/s measured by churn) | inside the room's allowance                                                                                            |
| Publishes, per room and destination | 6 × 5 = 30/s                 | 360/s, 1200/s with churn                                 | **512 + 51.2/s**                                                                                                       |
| Bus bytes, per connection           | 160 kB/s                     | 256 kB/s, creator 1.6 MB/s                               | inside the room's allowance                                                                                            |
| Bus bytes, per room and destination | 0.96 MB/s                    | 2.9 MB/s                                                 | **512 kB + 51.2 kB/s**                                                                                                 |
| Bus bytes, whole deployment         | 26 MB/s, about $160 a day    | 77 MB/s, about $480 a day                                | 80 two-member rooms × 2 directions × 51.2 kB = **8.2 MB/s, about $50 a day**; 27 full rooms: 2.8 MB/s, about $17 a day |
| Database reads, per connection      | 32 + 5/s                     | 480 + 60/s                                               | **16 + 1/s**                                                                                                           |
| Database reads, whole deployment    | 800/s, about $40 a day       | 9600/s, about $500 a day                                 | 160/s, about $8 a day                                                                                                  |
| `time` transactions, per connection | 100/s, creator 400/s         | 400/s                                                    | **8 + 2/s** (an honest page: 0.5/s)                                                                                    |
| Inbound bytes, per connection       | 256 kB/s, creator 2 MB/s     | the same                                                 | 256 kB/s                                                                                                               |

- The S1 finding was a host and one guest driving a gateway-wide 4096-ID dedupe
  map to overflow at 100–400 frames a second, restarting every room. That is
  closed structurally: the window is per room (512 IDs, 10 s TTL, bus deliveries
  only) and overflow drops that room's new bus frames. With the publish
  allowance mirroring it, a room can no longer be made to overflow its window on
  the other gateway by publishing; the window remains as the defence against
  duplicates and against a sending gateway that does not meter.
- Per gateway: a window is about 60 kB, and an instance serves at most 80
  sockets, so at most 80 rooms and 5 MB of windows, whatever the rate. Expiry
  scans a window per bus frame: 80 rooms × 51.2 = 4100 bus frames a second at
  most, 2.1 million map steps, tens of milliseconds of CPU a second.
- Limiter memory per gateway: one bucket per current member per connection, one
  publish bucket per room and destination with recent traffic (capped at 4096),
  1024 flood flags.

### Known, not fixed here (for #256)

- The Pub/Sub bus refuses a publish while 2 MB is pending gateway-wide, and the
  refusal closes whichever sender hit it with `4000`. About eleven hostile rooms
  publishing one 32 kB frame a second each can hold it there while Pub/Sub is
  slow; `main` allowed the same. The publish allowance now caps each room at
  51.2 kB a second, which makes it harder, not impossible. The follow-up is to
  drop the frame on backpressure instead of closing the sender.
- Every reconnect is an admission transaction and a departure transaction; a
  successful admission spends no budget. Reconnect churn is bounded only by the
  pending-admission limits.
