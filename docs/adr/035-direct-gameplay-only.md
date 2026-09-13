# ADR 035: Direct WebRTC gameplay, signalling-only backend

Date: 2026-09-14. Status: accepted scope decision explicitly requested by the user.

The user requested less backend complexity: no Pub/Sub gameplay traffic, with a visible connection failure acceptable if WebRTC cannot work. Pub/Sub between Cloud Run instances remains allowed for coordination/signalling. This supersedes gameplay WSS/Pub/Sub fallback in ADRs 028–034 and their corresponding release gates; it does not waive state consistency, local responsiveness, or direct-path recovery tests.

Gameplay envelopes are sent only on peer data channels. Cloud Run/Worker sockets carry membership, service time, authority grants and validated SDP/ICE signalling. Pub/Sub carries only addressed SDP/ICE between gateways. A `relay` request is rejected. No TURN service is provisioned by this decision.

Probe acknowledgements determine direct-path health. Failed delivery stops gameplay sends and shows reconnection status; bounded renegotiation retries. Joining intent retries until a direct path and authoritative membership are established. No stale shots may accumulate during the failure. Shared Wi-Fi is encouraged for local parties, while the actual ICE candidate path determines whether connectivity is direct. The application cannot guarantee LAN routing based on an IP or a user-selected mode.

Verification must prove: no gameplay envelope reaches WSS or Pub/Sub, blocked direct channels produce an explicit failure, healthy direct links recover after a temporary interruption, old state/actions remain fenced, and fresh join/resync follows recovery. Forced relay throughput/cost gates from earlier ADRs are removed because there is no gameplay relay. Poor direct-network correctness and performance benchmarks remain required, with disconnected periods reported as failures/degradation rather than smooth play.
