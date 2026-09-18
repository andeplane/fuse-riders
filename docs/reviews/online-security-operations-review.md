# Online security and operations review

Date: 2026-09-14. Independent review of the current working tree, requested before further architecture work.

Scope: `worker/index.ts`, `wrangler.jsonc`, online transport/runtime/session/UI/codec, online unit tests, CI and deployment documentation. This review makes no remote mutations and does not certify the public preview, Cloudflare billing, physical phones, or actual mobile-network behaviour. The preview URL and temporary-account ownership were supplied as context; ownership and expiry were not independently verified. Source-level findings below are distinguished from the one executed local reproduction.

## Assessment

The browser-authoritative, host-to-peer WebRTC topology fits small trusted friend rooms and avoids an always-running simulation service. Host capability verification and room-specific Durable Object routing are sensible boundaries. The current recovery and resource-limiting behaviour is experimental, however; it does not yet support the stronger promise that adverse networks or phone lifecycle events will be harmless.

I recommend recording the following as release gates, rather than expanding gameplay until they are resolved or explicitly accepted in an ADR.

## Findings

### P1 — Replacing the host socket does not revoke the old host simulation

Evidence: `worker/index.ts:55` closes an earlier socket with code 4001. `src/online/peer-transport.ts:41-45` merely stops reconnecting that socket; it does not close RTC links or notify runtime of lost authority. `src/online/runtime.ts:60-83` continues advancing an existing host session. Meanwhile `peer-transport.ts:33-36` suppresses peer-offline notifications when an RTC channel remains open, and `:72` retains an open old channel rather than negotiating with the replacement page.

A second tab using the same host localStorage token can create another authoritative simulation while existing clients retain the first tab's RTC link. An offline notification from the old socket can also follow the new online notification: `worker/index.ts:76` does not check whether a replacement connection exists. This is a source-derived split-authority/race finding, not a reproduced two-tab browser trace.

Required acceptance: host duplicate-tab takeover, host refresh, delayed old socket close, and late old RTC packets must all result in exactly one authority. Every frame/action needs a room authority epoch or equivalent fencing rule. A revoked host must stop ticking and sending immediately; clients must reject retired authority frames. Verify that the new host can steer, start/reset, and advance the exact world all guests see.

### P1 — RTC failure status does not establish a working failover path

Evidence: `peer-transport.ts:58-60` changes a status string on failure/disconnection; no timeout, heartbeat, ICE restart, or link replacement follows. `:93-99` continues selecting an open channel with a small buffer even if no packets have reached the other side. `runtime.ts:64` reports waiting after two seconds but makes no recovery attempt. Data-channel construction at `peer-transport.ts:73` uses default ordered, reliable delivery, so stale traffic can also block newer state.

The present fallback handles a closed/unavailable or locally buffered channel; it is not a liveness-based failover. A dead receive path can leave an apparently open low-buffer channel selected. The 1.5-second signalling reconnect loop has neither jitter nor backoff, and retries expired rooms indefinitely.

Required acceptance: blackhole each direction independently while RTC remains open, switch Wi-Fi/cellular, disable UDP mid-round, and restore connectivity. Bound time until WSS takes over, queued input age, resync duration and post-recovery corrections. Stop retrying terminal room errors. Define separate delivery semantics for current input/state and reliable actions. Report actual active transport rather than a status string based only on RTC connection state.

### P1 — Public resource limits omit major ingress paths and are inconsistent with supported room size

Evidence: `worker/index.ts:45-50` allows every connected identity to mint TURN credentials with no issuance rate limit or cache. `:63-74` permits up to 100 frames of 200,000 characters per second per socket, without an aggregate room byte budget. Reconnecting gives a fresh attachment counter (`:57`). The relay sends directly to the recipient with no slow-consumer policy. Direct RTC input bypasses all Worker message limits: `peer-transport.ts:66` parses any received payload; `:84` accumulates unbounded pre-description ICE candidates. A holder of a room code can invent identities, fill the twelve connection slots, or monopolize five player seats; there is no lock, approval, kick, or spectator/player capability boundary.

At the allowed maximum of twelve sockets, one host publishing at 10 Hz to eleven recipients sends 110 relay frames/second before events, exceeding its own 100-frame limit. Smaller rooms can also burst over the limit when events and signalling are included. This is directly calculated from `runtime.ts:80,88-92` and Worker limits, not a load measurement.

Required acceptance: eleven-recipient fallback run without healthy-client disconnection; malformed/oversized direct RTC and relay frames; resync flood; ICE flood; slow consumer; repeated credential requests; identity churn; and bounded retained memory after churn. Set per-message-class sizes, per-peer and per-room byte/CPU budgets, bounded ICE queues, TURN issuance cache/quotas and a reconnect-resistant abuse policy. Specify whether invite-link possession intentionally grants permission to occupy any free seat; add host eviction/lock if the product expects controllable friend rooms.

### P1 — Checkpoint restoration is neither fully validated nor atomic

Evidence: `host-session.ts:84-91` validates only a few top-level properties, assigns `this.game` and clears seats before iterating `data.sequences`. A catch returns false after those mutations. Runtime ignores the restore result (`runtime.ts:23-25`). Deep physics/state invariants, sequence types, map sizes, settings consistency and protocol/build compatibility are unchecked.

Executed local reproduction using `tsx`, without changing files: setting checkpoint tick to 999 and `sequences` to null returned `false` but left `game.tick === 999`. Removing `game.pickups` from another checkpoint returned `true`. Thus even rejected data can replace a healthy session, and accepted data can omit required state.

Required acceptance: malformed sequences, missing maps, invalid numeric values, oversized maps, unknown schema/build versions and corrupt nested trails must leave the existing session byte-for-byte unchanged. Restore into a validated temporary object, then atomically swap. Define migrations or an explicit safe recovery/reset message. Mark restored peers disconnected until they rejoin; stale connected flags currently come from the checkpoint. This is a robustness boundary against corruption and old versions, not a claim that a trusted local host must be prevented from cheating.

### P2 — Phone lifecycle recovery is incomplete and not bounded by one second in all cases

Evidence: `runtime.ts:68-71` pauses only when the host's scheduled tick observes `document.hidden`; abrupt suspension can precede that callback. `ui.ts:105` calls `runtime.stop()` on every `pagehide`, but there is no `pageshow` handler to restart after a back-forward cache restore. Periodic checkpoints and their write failures are best effort (`runtime.ts:86`, `:95`). There is no host election or wake lock.

Required acceptance: actual iOS Safari and Android Chrome host screens off/on, app switch, browser navigation and back-forward restoration, memory eviction, denied/full localStorage, and recovery after host disappearance. Make a product decision: visible pause with explicit resume, host transfer, or server authority. State the rollback window as measured/best effort, not guaranteed. A trusted browser host is a valid choice, but all other players inherit its availability.

### P2 — Deployment compatibility and cost diagnostics are not yet operational gates

Evidence: `package.json` deploy runs build plus Wrangler without tests or Worker typecheck. `.github/workflows/ci.yml` checks types, unit coverage, local browser smoke and codec consistency, but not Worker adversarial tests, actual hibernation/reconnect semantics or network-budget regressions. Its evidence upload keeps coverage and PNGs, not Worker logs or benchmark JSON. `wrangler.jsonc` disables observability, has one environment, and names no explicit production account or deployment version. Transport `sentBytes` counts attempted envelopes rather than successful wire bytes; `stats()` counts RTC candidates but does not count WSS fallback receivers.

The use of `acceptWebSocket` and serialized attachments enables hibernation, but every relayed gameplay message still invokes room work. Continuous relay gameplay is not idle signalling. A socket can keep a room alive indefinitely (`worker/index.ts:79-81`). No independent billing or hibernation measurements were made in this review.

Required acceptance: documented temporary-preview claim/expiry owner; permanent account and service inventory without secrets; separate preview/production bindings; rollback with old connected clients; protocol/build negotiation and incompatible-checkpoint handling; redacted structured connection/error/relay-byte telemetry and quota alerts. Exercise the same release artifact through local tests and preview smoke before production. Preserve benchmark JSON and Worker logs as CI evidence. Make cost estimates conditional on measured direct/TURN/WSS usage rather than a single bandwidth figure.

### P2 — Host credentials are bearer capabilities requiring an explicit lifecycle

> **Status (2026-09-17): tokens in URLs — fixed** (issue #256 S3). The ICE request sends the token as `Authorization: Bearer` and the room socket authenticates with its first frame; no room service URL carries a token, and the service logs neither URLs nor frames. Old pages are still admitted with `?token=` by the Cloud Run entry during a logged, removable rollout window. See [TOKEN-TRANSPORT.md](../online/TOKEN-TRANSPORT.md). Revocation, rotation and host transfer remain open.

Evidence: room and peer tokens are stored under `fuse-room-${code}` (`ui.ts:29,34-35`) and included in query strings for WebSocket/ICE requests (`peer-transport.ts:19,28`). Invite links correctly omit the host token (`ui.ts:79`), and peers cannot directly route guest-to-guest messages (`worker/index.ts:72-73`). Origin checking is present, but it does not replace possession-based authorization. There is no capability revocation/rotation or host transfer API.

Required acceptance: cross-room routing and guessed host commands rejected at the actual Worker boundary; duplicate identity behaviour defined; credentials absent from copied invites, diagnostics and logs; expiration/revocation behaviour documented. Keep tokens out of URLs where feasible or ensure URL query redaction throughout operations. The room code has 40 bits of generated entropy (ten hex characters), rather than the larger alphabet accepted by the route; evaluate lookup throttling based on that actual entropy.

## ADRs to settle before implementation proceeds

1. **Authority and recovery:** trusted browser host vs edge simulation; backgrounding contract; single-host fencing/epochs; permanent host departure; checkpoint schema and rollback guarantees.
2. **Transport semantics:** star topology, message-class reliability/ordering, congestion and liveness detection, RTC restart, WSS/TURN fallback, resync and event replay policy.
3. **Room security and budgets:** invite/host/player/display capabilities, identity churn, seat management, per-peer/room resource ceilings, room lifetime and TURN quotas.
4. **Release and operation:** permanent provider/account ownership, preview vs production, compatibility across releases, deployment/rollback gates, observability/privacy, measured cost thresholds and billing alerts.

Each ADR should state rejected alternatives, measurable acceptance conditions and the explicit limits retained by the choice. “No server running 24/7” should mean no provisioned always-on simulation process; it must not imply that relays or per-message service work are free.

## Evidence and review limits

The existing online unit tests cover basic host-only actions, independent HostSession instances, settings parsing, a valid checkpoint round trip and a malformed JSON string. Those do not prove Worker room isolation, hostile input bounds, transactional recovery or phone lifecycle safety. Browser smoke is useful positive-path evidence but cannot substitute for the failure scenarios above.

No production deployment, destructive action, billing change, remote load test or secret access was performed. Only this review document was added. Findings should be independently triaged against the implementation revision used for the next release; source line numbers reflect the files reviewed today.
