# Phase 0 implementation handoff

Status: **implemented locally; final verification and player review remain open**. Work continues in `codex/neural-defence-completion`, based on the existing `codex/neural-defence-design` draft [PR #409](https://github.com/andeplane/fuse-riders/pull/409). The continuation is intended for that same PR; this document does not assert that every local change has been pushed. Merge and deployment remain separate decisions.

## Current decisions

- Menu: **New game** and **Settings**, using Fuse Riders' shared neon palette, pixel typography, controls and menu hierarchy. The earlier teal dashboard direction is superseded.
- Solo sandbox without AI, plus a separate scripted combat lab with exactly one experimental tower. Four-owner engine and adapter support exist; browser multiplayer rooms are deferred.
- One reusable builder per player delivers queued construction through a separate bandwidth lane. Each player has 128 reusable attack particles of one type. No guard, shield or refit system.
- Biomass and Insight deposits; Growth, Excitation and Conduction research. Tower construction uses any open hex with six connected friendly neighbors; `towerSite` is an optional map/editor suggestion.
- `?debug` draws clear tile boundaries. Independent instant construction/research options start unchecked and retain costs, prerequisites and travel.
- Individual colored brain/neuron sprites, sculpted terrain, one tower, distinct builder/attack particles and shared selection overlays. Visual acceptance remains the user's decision.
- Settings currently contains the working reduced-motion preference. Audio has not been implemented; inert audio controls were removed.
- Pure headless TypeScript simulation, the existing network runtime, injected side effects, typed test fakes and cumulative statistics for later graphs.

## Implemented and reviewed

`games/neural-defence/src/engine/` owns JSON map validation, pure ticking, construction and builder recovery, adjacency mining, independent research, finite attack transport/combat, statistics, codecs and canonical hashing. `src/online/` supplies the RollbackGame adapter, offline RoomRuntime session and scripted combat lab. Solo creates no transport and uses no competing authoritative timer. Shared netcode's optional `seating.minimumParticipants` defaults to two; Neural Defence uses one.

Core corrections are in `d80dc94f`, `8dd2a789` and `a9163e81`: stale routing priorities, simultaneous construction claims, severed builder edges, strict checkpoint validation, explicit local-player/spawn selection, all four lab spawn choices, and checkpoint restoration after lobby settings changes or post-match departures. The seven original checkpoint findings are resolved; the [review record](REVIEW-2026-09-25.md) preserves their context rather than an outstanding blocker list.

`12a09512` adds the resolved attack origin to presentation events. `36171725` integrates the shared Fuse UI, stable controls during tick updates, real sprite rendering, bounded visual effects and particle travel interpolation from authoritative departure/arrival ticks. Render animation does not advance simulation. The app includes map loading/retry, setup, compact Build/Research/Log panels, keyboard selection, zoom and debug options.

The delivered art inventory is in [ASSET_MANIFEST.md](ASSET_MANIFEST.md): eleven corrected biological sprites and eight new terrain/rock assets, alongside reused deposits, construction site and earlier blocker candidates. Four brains and four six-port neurons have baked team colors. Contact sheets and exact prompts are retained. Additional terrain variants and exact texture seam qualification remain later work.

## Verification at this checkpoint

- `pnpm typecheck`, `pnpm build` and focused ESLint: passed locally.
- Neural Defence tests: **44 passed**. These include engine, adapter, presentation and app regressions, with typed map failure/retry, stale response and disposal checks.
- Final `pnpm test:coverage`: **1,654 passed, zero failures**, 95.81% statements/lines, 94.52% branches and 98.46% functions; unchanged coverage thresholds passed. The earlier Docker manifest failure was fixed. A pre-existing service child-startup timeout under concurrent coverage was recorded in [issue #250](https://github.com/andeplane/fuse-riders/issues/250#issuecomment-5828682726) and moved to the explicit `pnpm test:service-health` smoke, which passed. That smoke is not included in the green CI suite count.
- Browser: real menu → setup → debug sandbox, neuron construction at cell 14, priority weight 3, selection back to brain cell 13 with slider 0. A second session built cells 26 and 38, raised income from 1.0/0.5 to 2.0/1.5 Biomass/Insight per second, completed Growth research, reset to starting resources/research and returned to the menu. Normal-timing combat lab showed both networks, its one tower and destroyed frontline cells. Generated sprites render in the game. Screenshots are in [verification/](verification/).
- Chromium geometry checks at **1440×900**, **390×844** and **568×320** found no page overflow or reported console errors in the exercised flows. This is browser emulation, not physical-device evidence.
- No production deployment, real-network qualification, competitive balance result or user approval of the visual feel is claimed.

## Remaining acceptance work

1. Publish the final local changes and completed suite/coverage result to the draft PR, then record CI separately.
2. Map failures/retry and stale responses are exercised through injected app tests; simulated browser network failure is not independently exercised. Builder cuts/recovery and all four lab spawn choices are engine/adapter regressions, not physical-device or real-network evidence.
3. Review the actual menu and game appearance with the user. The shared Fuse UI and new assets are implemented; “AAA” visual quality is not established by tests or generated contact sheets.
4. [BENCHMARK.md](BENCHMARK.md) retains the seeded, revision-specific four-owner workload: 820 ticks, 60 commands, 512-particle peak, replay hash `6670eaf7`, construction/research/combat assertions. The measured local throughput is not a balance result or AI tournament.
5. Check the remote planning branch for concurrent changes before updating the same draft PR. Do not merge or deploy without authorization.

## Running locally

Use `pnpm install --frozen-lockfile`, then `pnpm dev` at the repository root. The dev command builds the games and starts the existing service; use the full URL printed by that server. At this checkpoint, the current completion build is previewed at **http://localhost:8787/neural-defence/?mute&debug**. A static preview needs `pnpm build` after source or asset changes. Ports and running processes are transient; verify them before restarting anything.
