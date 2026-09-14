# Action replication prototype

Issue [#82](https://github.com/andeplane/fuse-riders/issues/82), branch `codex/deterministic-action-log`, isolated worktree `/private/tmp/fuse-riders-action-log`. [ADR040](../adr/040-deterministic-action-replication.md) and [independent implementation review](../reviews/action-log-implementation-review.md) approve this bounded opt-in milestone. No public deployment is part of this work.

This document describes the earlier host-coordinated prototype. The selected replacement is [ADR041 direct actions and world rollback](../adr/041-direct-actions-and-world-rollback.md); its [implementation status](DIRECT-ACTIONS-IMPLEMENTATION.md) distinguishes completed components from remaining gameplay integration. The prototype's bandwidth measurements below do not describe the new direct-mesh design.

## What works

The existing host coordinates accepted inputs at shared 20 Hz ticks. A shared reducer records exact applied controls, transient bomb commands, bot actions, input cancellation and lifecycle changes. Held controls are persisted; only changes carry a per-player action record. The absolute-tick amendment now writes the full applied tick into each record (`fuse-actions-3`). MessagePack tuples encode these records. Full views reconstruct the complete world from a validated checkpoint and subsequent transactions. Shared-TV controller phones receive reduced status worlds and release their full replica when changing roles; the TV continues simulating.

The reliable WebRTC channel retains incarnation, authority and connection fencing. Explicit version/rules negotiation rejects incompatible participants. Receipts acknowledge accepted state, not queued sends. Bounded retransmission, sequence/generation fences, chunked recovery, transaction hashes, decoder budgets and atomic candidate validation handle invalid, stale, dropped and reordered application messages. Repeated hash divergence stops the experimental stream visibly.

Exact cross-engine replay exposed native distance/trigonometry differences. Shared numeric helpers now use fixed arithmetic and pinned JavaScript stdlib implementations, including the shared motion kernel used for prediction. Checkpoints preserve signed zero; accepted input aims normalize zero before MessagePack encoding. Compatibility changed to `fuse-simulation-2` / initially `fuse-actions-2` (now `fuse-actions-3` for absolute action ticks); old saved checkpoints are rejected into a fresh lobby. Low-order physics bits change on both default and experimental paths. The default network mode and LAN paths are preserved.

## How to try it

```sh
cd /private/tmp/fuse-riders-action-log
npm ci --ignore-scripts
npm run build
npx wrangler dev --port 8812
```

Open `http://localhost:8812/?replication=actions` and create a room. Invite/TV links retain the mode. Use the same branch build everywhere. The local Worker only coordinates the room; gameplay still uses direct WebRTC. The public beta is unchanged.

## Measured scope

Working-tree development checks passed three 2,400-tick five-bot traces in both Chromium and WebKit, including a weapon/portal checkpoint, with exact hashes at every transaction and zero mismatches. Replay including cloning, validation and hashing took roughly 0.48–0.55 ms/tick in Chromium and 0.64–0.80 ms/tick in WebKit on this desktop. These are total-time averages, not phone frame-time percentiles.

A mixed-engine real WebRTC room exercised five riders plus a separate TV, normal delivery, 45 seconds of bounded application-level delay/drop/duplicate/reorder, guest refresh, full-view to controller mode and restoration. It recorded zero hash mismatches and page errors. This is a short desktop scenario; humans ride straight and some samples include completed rounds/matches. It is not a sustained all-features gameplay soak or real UDP packet-loss test. Seeded offline bot traces complement this scope. Chrome and WebKit LAN smoke passed.

On the same five-bot state traces at 20 Hz, for one full-view player:

| Host downlink application payload | Measured rate |
| --- | ---: |
| Existing JSON state deltas, settings, prediction metadata and envelope | 28.7–29.1 KB/s |
| Prototype MessagePack replay, settings, prediction metadata and envelope | 12.7 KB/s |
| Action records alone, already included in the prototype total | 212–213 B/s |

That is about **56% less host downlink payload** in this controlled comparison. It includes bootstrap cost and uses representative connection identifiers. It excludes upstream inputs, receipts, probes, signalling, authoritative effects and SCTP/DTLS/IP overhead. The live room measured roughly 64–66 KB/s aggregate binary host sends to five full views during its normal sample windows. Application impairment counts represent attempted queued binary payloads before the harness drops/duplicates them, not wire bytes.

The records are already small; repeated settings, prediction metadata, clock progress and envelopes dominate this prototype's remaining traffic. The final edge-only design's 100–500 B/s estimate must not be presented as the current total network rate.

The pinned numeric helper's standalone bundle is 45,144 bytes minified / 12,951 bytes gzip. The audited 143-file execution graph contains no native trigonometric or addon dispatch. Package versions are locked; [distributed notices](../../public/action-math-NOTICES.txt) retain upstream licenses and port notices.

## Verification and evidence

Final runtime `85f8d58` passed all required checks. Browser harness `f8a7faa` adds negative negotiation tests; runtime/package/coverage sources are identical between those revisions. All 471 tests pass; coverage is 99.52% lines, 94.57% branches and 99.53% functions. The final mixed-engine room run passed 18 sample points, negotiation failure cases, wrong-sender rejection, the actual TV invite, impaired delivery, guest reconnect and both role transitions, with no recorded hash mismatches or page errors. Both LAN browser engines and the default snapshot online smoke also passed. These are local checks; no branch CI or public release is claimed.

[Verification manifest and source/build hashes](action-replication-evidence/verification.json), [exact replay](action-replication-evidence/action-replay-browser.json), [payload comparison](action-replication-evidence/action-payload-benchmark.json), [live room samples](action-replication-evidence/action-room-browser.json), [numeric dependency graph](action-replication-evidence/action-math-dependencies.json), and [retained native-math failure](action-replication-evidence/action-replay-browser-native-math-failed.json). Completed check logs are gzip-compressed in the same directory.

Reproduce with:

```sh
npm run typecheck
npm run typecheck:worker
npm test
npm run test:coverage
npm run build
node --import tsx scripts/action-replay-browser.ts
node --import tsx scripts/action-payload-benchmark.ts
ONLINE_URL=http://localhost:8812/ node --import tsx scripts/action-room-browser.ts
node --import tsx scripts/browser-smoke.ts
BROWSER=webkit node --import tsx scripts/browser-smoke.ts
```

Coverage retains the existing thresholds and adds the action protocol module. Runtime/transport/UI browser integration remains outside the named unit-coverage surface. Browser reports identify revision, dirty state, seeds and scope. Earlier native-math failures are retained alongside passing evidence.

## Absolute-tick amendment verification

Runtime `2c02750` uses full absolute applied ticks in action tuples under `fuse-actions-3`. Its independent schema review passed; both typechecks, all 474 unit tests with enforced coverage, production build, and 7,200 exact replay ticks per engine in Chromium/WebKit passed. Old replay-rule checkpoints are rejected and host-save compatibility remains unchanged. [New verification and raw evidence](action-replication-evidence/absolute-ticks/verification.json) are separate from the original prototype evidence above. On the same payload benchmark, action records increase to 231–234 B/s and total downlink remains about 12.7 KB/s; timestamps are still a small part of the traffic. This amendment does not implement direct peer streams, continuous speculative world simulation or event-driven network sends.

## Target architecture after user clarification

The intended online architecture is direct per-player action streams and continuous full-world simulation on every viewing device, including bounded rollback for late input. A coordinator handles setup, membership, finality and recovery without being a normal-input relay. The existing host-star, 20 Hz publication and opt-in snapshot compatibility are transitional prototype choices, not permanent requirements. See the revised [brief](DETERMINISTIC-ACTION-LOG-BRIEF.md). Controller-only phones remain lightweight, and the separate LAN path is preserved.

## Follow-up milestones

- Replace refreshed upstream inputs with acknowledged gesture edges and explicit freshness repair.
- Compact repeated metadata and envelopes; measure real total bidirectional and wire traffic.
- Add speculative full-world rollback, correction budgets and render reconciliation. Current local motion prediction and confirmed remote interpolation remain in place.
- Specify and qualify an unreliable data channel with redundancy/retransmission. This prototype uses reliable ordered delivery and host coordination; it is not full mesh.
- Add a replay archive/import UI and durable format/version management. Reducer/checkpoint replay exists, but no instant-replay product UI is implemented.
- Complete extended gameplay/resource soaks, real network and physical-phone lifecycle testing, production backend compatibility and release review before enabling it publicly.
