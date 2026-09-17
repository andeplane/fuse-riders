# ADR 035: Direct WebRTC gameplay, signalling-only backend

> **Superseded by [ADR 047](047-p2p-input-log-lockstep-rollback.md)** for the host-star protocol text below, replaced by the peer-to-peer input log on 2026-09-15. The direct-only policy (no gameplay relay, no TURN) still stands; ADR 047 carries it forward.

Date: 2026-09-14. Status: accepted scope decision explicitly requested by the user.

The user requested less backend complexity: no Pub/Sub gameplay traffic, with a visible connection failure acceptable if WebRTC cannot work. Pub/Sub between Cloud Run instances remains allowed for coordination/signalling. This supersedes gameplay WSS/Pub/Sub fallback in ADRs 028–034 and their corresponding release gates; it does not waive state consistency, local responsiveness, or direct-path recovery tests.

Gameplay envelopes are sent only on peer data channels. Cloud Run/Worker sockets carry membership, service time, authority grants and validated SDP/ICE signalling. Pub/Sub carries only addressed SDP/ICE between gateways. A `relay` request is rejected. No TURN service is provisioned by this decision.

Probe acknowledgements determine direct-path health. Failed delivery stops gameplay sends and shows reconnection status; bounded renegotiation retries. Joining intent retries until a direct path and authoritative membership are established. No stale shots may accumulate during the failure. Shared Wi-Fi is encouraged for local parties, while the actual ICE candidate path determines whether connectivity is direct. The application cannot guarantee LAN routing based on an IP or a user-selected mode.

Verification must prove: no gameplay envelope reaches WSS or Pub/Sub, blocked direct channels produce an explicit failure, healthy direct links recover after a temporary interruption, old state/actions remain fenced, and fresh join/resync follows recovery. Forced relay throughput/cost gates from earlier ADRs are removed because there is no gameplay relay. Poor direct-network correctness and performance benchmarks remain required, with disconnected periods reported as failures/degradation rather than smooth play.

## Reviewed direct-path liveness correction

The traced poor-network browser investigation found that the prototype retained a two-second relay recovery quarantine and used a link-creation deadline for all later restarts. Once that deadline passed, a brief probe gap could recreate an otherwise viable RTC channel and trigger another quarantine, queued-message loss and world-baseline churn.

For direct-only play, two fresh probe acknowledgements permit gameplay without a relay dwell period. Gameplay still stops when acknowledgement freshness exceeds 600 ms. Forced renegotiation requires eight continuously unhealthy seconds; fresh health clears that interval, and the existing retry backoff remains bounded. A three-second application blackout on an open RTC channel should therefore recover through fresh probes on that channel. Eight seconds is the renegotiation budget for sustained failure, not a relaxation of the two-second post-connectivity gameplay recovery requirement. Typed regressions cover long healthy uptime followed by a three-second blackout, two-ack recovery, eight-second sustained failure, and expired/duplicate/pre-failure probe rejection. Root independently reviewed this bounded implementation before commit; final browser recovery evidence remains required.

## Reviewed bounded keyframe receipt amendment

The post-liveness application-loss trace demonstrated missing/reordered delta dependencies followed by dropped replacement keyframes and resync requests. Root independently approved this bounded amendment before implementation: each peer retains one immutable full world envelope (keyframe plus settings, movement ledger and received-input acknowledgements from the same tick). The sender retries that exact envelope no more often than every 500 ms and withholds dependent deltas until a receipt names its generation, stream ID, sequence, match and round. A queued transport send is not receipt.

Repeated resync requests while that baseline is pending coalesce rather than generating additional streams. A pending baseline expires after five seconds, requiring a fresh encoder generation; peer/authority changes clear pending delivery, and match/round changes force a fresh baseline. The receiver remembers only its last accepted keyframe envelope and acknowledges an exact duplicate again when the first ACK was lost. Unseen or changed invalid envelopes are not acknowledged merely because they name a familiar generation. This is bounded metadata/receipt handling on direct RTC only, not gameplay relay or a general codec rewrite. It does not guarantee recovery under arbitrary repeated loss; the existing two-second measured freshness and post-outage gates remain unchanged.

Compatibility: all participants in an experimental online room must reload together for this application-protocol change. Older bundles do not emit keyframe receipts; a new host cannot safely treat their queued transport delivery as acknowledgement. Mixed old/new rooms and seamless live upgrades are not supported by this release. Signalling protocol v2 alone does not negotiate this application capability.
