# ADR 031: Room boundaries and operations

Date: 2026-09-14. Status: proposed; service ownership and capacity not yet accepted.

## Decision

Use one SQLite Durable Object per room for room membership, host epoch/lease, signalling and optional WSS relay. Static assets use Worker assets. This recommendation reuses the existing prototype; provider pricing and permanent account ownership must be reverified at release. A temporary deployment is an experimental preview, never proof of permanent hosting.

Support five player seats plus one display initially; publish and enforce the connection cap consistently at UI, host and service boundaries. Invite possession permits requesting a free player seat; only host capability permits start/reset/settings and future seat eviction/room lock. Display role never grants host rights. Room/peer capabilities are scoped, unguessable, expire and are excluded from invites/logs. Distinct display identities prevent accidental host replacement.

Room preferences are versioned in host localStorage: shared/device presentation, wins/fixed rounds and powerup enable/weights. Host validates and broadcasts accepted revisions. Zero weights disable; all-zero disables drops. Stored defaults never overwrite recovered active settings implicitly. UI shows normalized probabilities and when pending settings apply.

Resource policy must cover both RTC and Worker paths: class-specific size limits, sustained/burst byte and message budgets per peer and room, bounded ICE/resync queues, bounded dedup history, slow-consumer eviction/resync and identity-churn-resistant admission. Derive host relay allowance from supported fanout plus control headroom; do not use the existing conflicting 100-frame cap unchanged. TURN credentials are cached and rate-limited with short TTL; TURN is disabled unless explicitly configured. Validate cross-room routing and management commands at their actual trust boundaries.

Preview and production use separate bindings. Negotiate protocol/build compatibility on join; incompatible clients reload with explanation before participating. Release artifact is built once, tested, then deployed. Record deployment version, operator account/service inventory, URL, date, rollback command and verified smoke result without secrets. Redacted metrics cover direct/TURN/WSS usage, bytes, disconnect reasons, resync, lease expiry, simulation/frame timing and bounded queue drops. Cost estimates use measured relay fraction and current published prices; no paid services are enabled implicitly.

## Alternatives and consequences

Database/Redis/VPS are not needed for the selected friend-room topology. Hibernation reduces idle work but relayed gameplay still invokes service work; it is not zero backend usage. Larger spectator capacity is deferred until measured, rather than allowing an untested twelve-socket cap. Host migration/ranked competition are separate architectural changes.

## Acceptance

Five players plus display run forced fallback without rate-limit disconnects. Malformed/oversized RTC and WSS traffic, ICE/resync floods, reconnect churn, slow receivers and credential bursts stay bounded. Cross-room/host privilege tests reject unauthorized actions. Release evidence includes privacy scan, protocol mismatch, rollback compatibility, Worker tests, artifact checks and permanent ownership/expiry verification. Physical device and WAN acceptance remain ADR 032 requirements.

Concrete proposed protocol amendment: [v2 contract](../online/PROTOCOL.md).
