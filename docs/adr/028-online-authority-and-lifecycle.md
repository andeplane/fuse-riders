# ADR 028: Online authority and host lifecycle

Date: 2026-09-14. Status: proposed; implementation and independent acceptance review required.

## Context and decision

Online rooms support five friends and a separate TV. The creator can play on a phone. Keep the existing LAN server available. For online play use a trusted browser listen-server in a star topology: the creator simulates the world; guests predict their own steering; only the authority confirms collisions, pickups, deaths and scores. Cloudflare Worker/SQLite Durable Object services allocate rooms, fence host ownership, signal WebRTC and relay when needed. No continuously provisioned simulation process is required.

This is a recommendation conditional on the network and phone acceptance gates in ADR 032. A browser host is not equivalent to five independently authoritative riders. Local response is immediate prediction, not permission to overwrite shared outcomes. No competitive anti-cheat or equal host latency is claimed.

The room service allocates a monotonically increasing authority epoch on host connection replacement. Every handshake, snapshot, action and acknowledgement carries that epoch and protocol version. A replacement is advertised to every peer; stale epochs are rejected before decoding. Revocation stops the old runtime, closes its peer connections and prevents automatic takeover loops. During signalling loss, existing authenticated RTC can continue only under a bounded renewable authority lease; after lease expiry the host visibly pauses. This trades indefinite offline continuation for single-authority safety. Initial lease proposal: 10 seconds, renew every 3 seconds; measure request cost before accepting.

Phone hosting must be explicit in the UI. Request wake lock when supported after a user gesture, but do not rely on it. Visibility/pagehide handlers neutralize input, save best-effort state and announce pause. Peers independently detect missing heartbeats. Resume establishes a fresh control epoch and baseline before play continues. Back-forward cache restoration must recreate or resume the runtime. Permanent host departure pauses the room; no silent election or divergent replacement simulation. An explicit reset remains available to the returning host.

Checkpoint restore validates a versioned, bounded complete state into temporary objects and atomically commits only on success. Invalid storage leaves current state unchanged and presents a recovery/reset message. Restored peers start disconnected until authenticated rejoin. Periodic writes are best effort; storage failure or OS eviction means there is no guaranteed one-second rollback bound.

## Alternatives and consequences

- Always-on authoritative Node: simpler trust and host availability; violates the cost/idle preference unless made optional. Existing LAN implementation remains useful.
- On-demand edge authority: avoids phone suspension and guest/host authority asymmetry but incurs simulation work throughout games and needs separate performance/cost validation. Reconsider if phone-host or fairness gates fail; do not conceal failure by lowering the gates.
- Full peer mesh/independent rider authority: rejected because shared trails, bombs and simultaneous outcomes still require arbitration and conflict resolution.
- Automatic host migration: deferred until a replicated checkpoint/ownership protocol is separately reviewed; refresh recovery is not migration.

## Acceptance

Duplicate host tab, refresh, delayed old socket close, delayed old RTC frames, signalling loss beyond lease, background/resume, bfcache and denied storage tests prove exactly one accepted authority and neutral controls on recovery. Corrupt nested checkpoint fields/maps, unknown versions and malformed sequences leave the original session byte-for-byte unchanged. Physical iOS/Android hosting remains a separate required release check.

Review basis: [netcode](../reviews/online-netcode-review.md), [security/operations](../reviews/online-security-operations-review.md). Existing prototype does not implement this full contract.
