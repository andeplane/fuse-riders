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

- **Per sender and target member: 80 frames, refilled at 10 a second.** 80 covers
  one negotiation at the ceiling (67) with room for a restart offer; 10 a second
  refills a whole negotiation within the 8 s restart interval. A rejoin into a
  full room gets five independent allowances instead of a fifth of one. Targets
  the gateway's view does not contain share a single bucket, so naming strangers
  mints no allowance, and the bucket is charged before the target is resolved, so
  a refused frame costs no database read and no bus publish. Buckets belong to
  the connection and are pruned to the current members: memory is one bucket per
  member plus one.
- **All frames: 400 a second for every member** (the creator's old allowance; a
  guest links to as many peers as the creator). 335 fits. Byte allowances are
  unchanged (2 MB a second for the creator, 256 kB otherwise; the ceiling burst is
  about 155 kB).
- **Waiting on the database or bus: 400 frames and 2 MB.** `ws` hands over every
  frame that arrived in one read in the same turn, and a cross-gateway frame
  waits for its publish, so a burst is briefly all pending. The byte bound is the
  memory the old 64 × 32 kB cap allowed.
- **A refused frame is dropped and the socket stays open.** The sender gets
  `{"type":"notice","notice":"signal-throttled","dropped":n}` at most once a
  second, `n` counting drops since the previous notice. Deployed clients ignore
  unknown frame types. A dropped candidate costs nothing ICE cannot do without. A
  dropped offer or answer leaves the link without probe acknowledgements; after
  8 s `LinkHealth.shouldRestart` lets the initiator send a fresh offer, which the
  answerer accepts whether or not it ever saw the first, up to four times. The
  cost of a drop is a late link, never a torn-down mesh.
- **Only a flood closes.** Each refused frame spends a tolerance of 400, refilled
  at 50 a second. No honest workload above reaches it. Ten times the per-link
  refill to one target is closed after about ten seconds; a storm above the frame
  cap within the second. The close is `1008 "Signalling flood"`. No close code
  makes a deployed client wait (even with reconnect backoff a welcomed socket
  resets it), so the gateway holds the back-off itself: for 60 s that member's new
  connections start each bucket at 10 frames rather than 80. It can link again;
  it cannot buy a burst by reconnecting. The memory is per gateway instance and
  bounded to 1024 members.

### What abuse is still bounded to

- One connection relays at most 80 + 10 a second per target, 400 in any one
  second and 60 a second sustained across five targets and the strangers' bucket
  (was 32 + 5 a second). Bytes are bounded as before by the byte allowance.
- The S1 finding was a host and one guest driving a gateway-wide 4096-ID dedupe
  map to overflow at 100–400 frames a second, restarting every room. That is
  closed structurally, not by this limit: the window is per room (512 IDs, 10 s
  TTL, bus deliveries only) and overflow drops that room's new bus frames. A
  window sustains 51 frames a second. One flooding member can now overflow its
  own room's window on the other gateway by itself (about 1000 frames in 10 s),
  where it used to take the whole room (6 × 82 = 492); the effect is confined to
  that room's cross-gateway signalling, and a member can already end its own
  room's match. An honest full-room renegotiation split three and three is
  9 links × 27 = 243 frames into each gateway; at the 64-candidate ceiling it is
  603, and the overflow is the last 91 trickled candidates.
- Per gateway: a window is about 60 kB, and an instance serves at most 80
  sockets, so at most 80 rooms and 5 MB of windows, whatever the rate. Expiry
  scans a window per bus frame: if all 80 sockets of the other instance flood,
  one gateway is offered 80 × 60 = 4800 bus frames a second sustained, 2.5 million
  map steps, tens of milliseconds of CPU a second. Frames beyond a room's window
  are dropped after that scan.
- Not changed here: the Pub/Sub bus refuses a publish while 2 MB is pending
  gateway-wide, and that refusal closes the sender `4000`. It is shared by rooms.
