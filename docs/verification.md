# Verification guide

This document explains how to verify the current source. It is not a claim that a particular revision was released or that every check below has passed. Historical release evidence belongs in [release records](online/PUBLIC-BETA-2026-09-14.md), the [deployment inventory](online/DEPLOYMENT.md), and measurement reports such as [PHASER.md](PHASER.md).

## Pull-request checks

The `verify` job in [.github/workflows/ci.yml](../.github/workflows/ci.yml) installs locked dependencies, then runs:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

`npm run lint` is ESLint with a deliberately small type-aware rule set ([eslint.config.js](../eslint.config.js)): no floating or misused promises, and no empty block — a `catch` that swallows on purpose says why in a comment. Prettier owns formatting.

`npm test` runs the same unit-test file globs without coverage instrumentation: `tests/*.test.ts` and `packages/*/tests/*.test.ts`. Use focused tests during iteration and the broader checks at integration milestones. Add a regression for a confirmed bug; test the observable contract and failure/recovery boundaries rather than copying implementation logic.

Do not freeze a test count or coverage percentage in this document. Obtain them from the exact revision's command output and `coverage/coverage-summary.json`. [.c8rc.json](../.c8rc.json) includes all game and networking source by default, with exact-file exemptions documented in [coverage exclusions](coverage-exclusions.md). New source modules automatically join the gate. Thresholds remain 95% lines/statements/functions and 85% branches. Substantial UI, rendering and production-adapter code remains exempt; passing the gate is not 95% coverage of the entire product. Removing those exemptions needs focused tests and remains tracked in [#257](https://github.com/andeplane/fuse-riders/issues/257).

## What the suites establish

| Area                            | Evidence                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Simulation                      | `tests/game.test.ts` plus motion, geometry, pickups, weapons, portals, trail lifecycle, statistics and moment suites   |
| Replay and network coordination | Input-log, stream, packet, snapshot, checkpoint, rollback, generation-replay and room-runtime tests                    |
| LAN authority and controls      | Server, server-review, client and controller tests with serialized WebSocket boundaries and injected time              |
| Networking libraries            | `packages/*/tests/`, including room service/gateway, admission, authority and transport-policy tests                   |
| Audio and presentation helpers  | Audio-director, radio, replay, viewport, effects and trail-cache tests; this does not cover all DOM/Phaser integration |

Use typed fakes for clocks, scheduling, transport, storage and browser surfaces. Malformed data must leave healthy state intact. For changed networking behavior, exercise the relevant dropped, duplicated, reordered, cancelled and stale-generation paths, as well as successful recovery. The current fixture scheduler does not by itself prove realistic hidden-phone timer behavior.

## Browser checks

CI runs the browser matrix on main pushes, manual dispatch and pull requests explicitly labelled `full-ci`; it normally skips it on PRs. Inspect the actual run and revision before citing browser success. Use the affected local smoke when practical, and report what could not run. A green `verify` job alone proves no browser interaction.

[README](../README.md#tests-and-evidence) lists smoke commands. `scripts/ci-local.sh` runs the local mirror, with `ONLY` selecting relevant checks and `PORT` avoiding occupied matches:

```sh
ONLY=core PORT=8801 scripts/ci-local.sh
ONLY=keyboard PORT=8801 scripts/ci-local.sh
```

`core` includes formatting, lint, typecheck, coverage and build. Room-service browser checks serve `dist/`, so build first. Install the required Playwright browsers before running them. The local mirror still has tracked drift and script consolidation work in #257; consult the workflow for the authoritative matrix.

`npx tsx scripts/determinism-replay.ts` compares a seeded input recording in Node, Chromium and WebKit. It is cross-engine evidence for that workload, not proof that all mechanics or arbitrary inputs were exercised. Phaser lifecycle, LAN rounds, online WebRTC, keyboard, touch-layout and recap flows each have separate smokes. Browser emulation is not physical-phone evidence; application-message impairment is not real IP packet loss.

## Release and performance claims

Before production deployment, run the release suite and browser checks relevant to the release:

```sh
npm run typecheck
npm test
npm run test:coverage
npm run build
```

Follow [GCP-DEPLOY.md](online/GCP-DEPLOY.md) for exact-source verification, protocol compatibility and rollback. Record local checks separately from GitHub CI and publication. Do not infer deployment from a push or queued run.

For performance measurements retain the command, source revision, workload/seed and results. Distinguish application payload bytes from wire bytes, rendering FPS from input-to-state latency, and synthetic browser workloads from real-device observations. Sustained impairment and physical-device qualification belong to changes that affect those behaviors or explicitly request them; never disrupt an occupied match.
