# Working on Fuse Riders

## Purpose and current status

Fuse Riders is a TypeScript game for 2–5 friends, preserving a LAN TV/phone mode while building online rooms with shared-screen or individual-device play. Priorities are responsive controls, consistent game outcomes, low hosting cost and no always-running simulation server where practical.

Online code now includes Phaser presentation, AI riders, shared-kernel tick prediction, lease-fenced authority, validated checkpoints and a GCP signalling service. The online beta is publicly deployed at https://andeplane.github.io/fuse-riders/ with the Cloud Run backend recorded in `docs/online/GCP-INVENTORY.md`. Public provider smoke and deployed Chrome/WebKit phone-host, room, AI, guest, settings and shared-TV checks passed at the recorded release. A 30-minute runtime soak and mobile-sized desktop renderer benchmarks passed their documented scopes. ADR037 response tuning passed a fixed 240-second measurement batch: local p95 27.6 ms and TV p95 88.2 ms, with all earlier trial outcomes retained. The final 6c1673b runtime passed exact-source CI, Pages deployment and clean public Chrome/WebKit acceptance. Physical-phone qualification remains unverified. Read `docs/online/PUBLIC-BETA-2026-09-14.md` before interpreting current release status. Read `README.md`, `docs/online/ROADMAP.md`, the online ADRs in `docs/adr/` (028 onward), and both `docs/reviews/online-*.md` reports before changing its architecture. Distinguish proposed decisions from accepted decisions and review findings from completed fixes. Do not claim robust failover, prediction, permanent deployment or mobile acceptance based on positive-path smoke tests.

## Ownership and changes

- Inspect `git status`, current sources and relevant tests before editing. Preserve unrelated changes and active agents' files. Coordinate explicit file ownership when work is delegated.
- Keep changes coherent and atomic; commit frequently when authorized. Use `codex/` for new branches unless the user requests another name. Do not use blanket staging when unrelated work is present.
- Before starting work, inspect open GitHub issues and link the change to an existing issue or create a matching issue when needed. Apply one type label (`feature`, `bug`, `docs`, `test`, or `maintenance`) and add `in-progress` when work starts. Remove `in-progress` when the work is completed or stopped; leave a handoff note when stopping so the next agent can resume without guessing. Keep this lightweight: use the issue to record scope and status, not duplicate the implementation log.
- Start architectural changes with an ADR describing alternatives, authority/time/transport invariants, failure behavior, costs and measurable acceptance criteria. Get an independent review before implementation proceeds; get another review of the resulting implementation before online release.
- Resolve blockers with regression evidence or an explicit reviewed scope decision. Do not silently weaken a requirement, lower a coverage threshold, or turn a failed assertion into a status note.
- Preserve the LAN `/display` and `/controller` path and the selected neon/pixel aesthetic. Skins and themes must not change simulation geometry, timing or player identity.

## Architecture boundaries

`src/shared/` owns deterministic simulation and rule types. `src/server/` owns LAN authority. `src/online/` owns browser-hosted authority, replication, prediction and transports. `src/service/` owns the production-target Cloud Run room gateway with Firestore metadata/leases and Pub/Sub signalling. `worker/` is the local/legacy Cloudflare coordination adapter. Neither backend simulates or relays gameplay: direct WebRTC failure must produce an explicit retry state. `src/client/` owns Phaser presentation, Canvas fallback, audio and pointer controls reused by both paths.

`src/shared/rider-motion.ts` is the shared pure motion kernel. Preserve turn-then-move fixed-step equivalence and applied-tick ledger/snapshot atomicity. `src/shared/bot-controller.ts` emits ordinary authority inputs; bots get no privileged physics. Phaser may render supplied fractional snapshot time but must never run authoritative physics, game timers or an independent competing render loop. See `docs/PHASER.md`, ADRs 029/033/035/036 and `docs/online/PROTOCOL.md`.

Keep authority explicit: clients can predict presentation, but shared collisions, pickups, scores and outcomes need one consistent authority. A successful transport send means queued data, not application acceptance. Design input/action age, sequence, epoch, acknowledgement, retry and cancellation semantics before changing delivery ordering. Validate data at service/Worker, RTC, checkpoint and storage boundaries; TypeScript types do not validate runtime input.

Do not mix clocks or advance simulation from render frames. Prefer a shared pure movement kernel and injected tick/clock dependencies for prediction and authority. Scope state/actions/events to their lifecycle so old packets cannot affect a new room authority, match or round. Restore validated state atomically, leaving healthy state unchanged on rejection. Bound queues, parsers, retained history, resync attempts and resource usage.

Browser-host suspension and a trusted host are product limitations requiring clear UI and documentation. WebRTC does not remove latency, host availability, NAT or consistency constraints. Do not describe local checkpoints as durable failover or guarantee a rollback window without evidence.

## Type-safe tests and dependency injection

Use explicit interfaces and typed fakes for clocks, scheduling, random sources, transport delivery, storage and browser surfaces. Existing examples include `ServerDependencies`, manual server ticks, `ControllerInputState`, and `ControllerPointerBindings`. Avoid `as any`, private-field mutation, global monkeypatches or real sleeps to make unit tests pass. Browser impairment harnesses may instrument browser APIs when their limits are documented.

Test observable invariants and real boundaries: serialized messages, command application, exact deterministic replay, stale/reordered/duplicated/dropped packets, held/released/cancelled input, replacement connections, corrupt state, and lifecycle transitions. Cover both successful recovery and explicit safe failure. Add regressions for every behavior defect. Do not write tests that merely restate an implementation.

Run checks appropriate to each change and the complete release suite before deployment:

```sh
npm run typecheck
npm run typecheck:worker
npm test
npm run test:coverage
npm run build
```

See README for Chrome/WebKit LAN and online smoke commands and browser installation. Coverage is enforced by `.c8rc.json` over its named modules; retain thresholds and report excluded surfaces. Browser/Worker integration tests and physical-device checks complement coverage rather than being inferred from it. Do not claim a test passed unless its completed output was inspected for the relevant revision.

## Network and release evidence

Follow `docs/online/ROADMAP.md` and the reviewed ADRs for acceptance budgets. Preserve reproducible commands, build/commit identity, seeds, profile definitions, raw samples and result distributions. Separate application payload bytes from wire bytes, local input response from host application time, and simulated impairments from real network/phone evidence. Record p95/p99/max corrections, snapshot age, recovery downtime and frame time where the requirement calls for them; a single latest metric is insufficient.

Run sustained five-player plus display scenarios with latency, jitter, loss/reordering, constrained bandwidth, transport failure, host/guest reconnect and phone lifecycle cases. Current exploratory benchmark JSON is a baseline, not certification. Keep the LAN game available while online changes are qualified. Never run automated participants or disruptive network/restart tests against a user's occupied match.

`npm run deploy` targets the legacy Cloudflare adapter, not the selected GCP/Pages production path. It only builds and deploys; it is not a verification command. Follow `docs/online/GCP-DEPLOY.md` for the guarded current-CI-head GCP release and Pages artifact flow. Test the release artifact in a preview, review compatibility with connected old clients/checkpoints and rollback behavior, then verify the actual destination. Document exact service names, public endpoints, deployment/version evidence, owner status, operational limits and cost assumptions. Temporary Cloudflare previews must stay labeled temporary until claim/ownership/expiry are verified. Do not enable paid services without user authorization.

## Documentation and secrets

Keep README onboarding, ADR status, roadmap, deployment inventory and evidence aligned with the actual code. Historical `docs/architecture.md` contains LAN and old balance details; verify constants from source before using them. Prefer links to current rule definitions over duplicated balance tables.

Never commit or expose host/player bearer tokens, temporary deployment claim links, TURN secrets, `.dev.vars`, Wrangler account files or unredacted credential-bearing logs. Public invite links must not carry host capabilities. Log useful redacted transport/room diagnostics; avoid treating Origin checks as authentication. Use the configured origin for git operations and verify external state before asserting publication, ownership, CI or deployment success.
