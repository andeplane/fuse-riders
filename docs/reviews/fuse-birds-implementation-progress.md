# Fuse Birds Phase 1 implementation evidence

Worktree: `codex/fuse-birds-concept`, based on `0386f4af`. Engine rules: `fuse-birds-4`; room checkpoint format: `fuse-birds-4-snapshot2`. Local implementation and verification; no merge or deployment.

## Delivered behavior

The default `fuse-birds-game` package is a headless, caller-driven library. Its rules own seeded terrain, opening-shot validation, movement/hop, wind, projectiles, simultaneous blast outcomes, destructible terrain, falling bodies, shootable supplies, deadlines, rising water, results and validated checkpoints. UI, Phaser rendering and peer rooms are adapters. The default import loads none of them.

The browser exposes create/join, 2–5-player rooms, individual-device and shared-TV modes, complete turns, results and rematch. Pebble is unlimited; Scatter starts at three and splits into three fragments. Counts come from the view; zero disables Scatter, refill grants one up to five, and rematch resets inventory. Healthy peer recovery preserves terrain and ammunition; failed operations show retry.

Phones have independent pan/pinch/zoom/recenter controls. TV always fits the full map. Keyboard I/J/K/L adjusts the same quantized aim, Shift increases adjustment, Enter launches and Escape cancels. Plus/minus zoom; arrows move and Space hops. Zoomed views show direction labels for off-screen birds and ammo. Second touch, resize, blur, weapon change and turn change cancel uncommitted aim.

Neon burrow uses original sky/rock assets, occupancy-clipped faceted terrain, cyan edges, world-aligned strata, small authored birds/crates, sling/trajectory feedback, water animation, damage/refill labels, impacts and optional sound. Four dirty chunks per frame bound composition/upload work; the previous complete image remains until replacement terrain and bodies agree. Engine clocks never wait for rendering. Context restoration rebuilds the current view.

## Current verification

| Area                    | Evidence                                                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full suite and coverage | `/tmp/fuse-birds-accessible-coverage.log`: 1,668 tests, zero failures; actual Chromium render and room flows; 95.04% lines/statements, 95.57% branches, 98.16% functions. Existing thresholds/exclusions unchanged.                                                                       |
| Build/types             | `/tmp/fuse-birds-accessible-build.log`, `/tmp/fuse-birds-keyboard-typecheck.log`; passed. Final formatting/lint review follows documentation consolidation.                                                                                                                               |
| Public library          | Node default-import full match, action-log replay and checkpoint continuation tests; CLI uses exclusive output files and validates bounded input.                                                                                                                                         |
| Cross-runtime rules 4   | Complete 2/3/5-player matches agree tick-for-tick in Node, Chromium and WebKit, including checkpoint restores: `/tmp/fuse-birds-rules4-cross-runtime.log`. Firefox failed before game load because its installed browser could not find its profile; no Firefox gameplay pass is claimed. |
| Maps/range              | 400 seeded opening maps across 2–5 players, 35 retries, zero fallbacks; 1,050 terrain-free range cases. Opening certificates cover directed pairs/all allowed winds.                                                                                                                      |
| Continuing play         | 40 ordinary-action matches, 589 directed samples, 29 movement-assisted routes. Of 24 initial search misses, three expanded direct and nineteen excavation routes independently replay with surviving shooters and target damage. Two late cases are classified below.                     |
| Inventory               | Room NE49: mouse-fired Scatter exhausts inventory, ×0 disables/selects Pebble, exhausted bird collects a naturally spawned crate with an ordinary Pebble, recovered checkpoint and visible next-turn ×1 agree. `/tmp/fuse-birds-empty-refill.log`.                                        |
| Full online game        | GK83: move/hop/land, pointer aim cancellation, keyboard aim/cancel/Scatter launch, shared counts, phone reload, complete result and rematch. `/tmp/fuse-birds-keyboard-online.log`. Coverage independently repeated the flow in ZB98.                                                     |
| Phone cameras           | UJ13: independent 390×844 and 430×932 touch contexts plus 1440×900 TV; real two-contact pinch, active-aim resize and dispatched blur cancel without ammo spending. `/tmp/fuse-birds-markers-phones.log`.                                                                                  |
| Retry and succession    | XW90: injected room-create HTTP 503 exposes retry, subsequent creation succeeds, creator leaves lobby, successor starts with newcomer, successor leaves midmatch, survivor applies ordinary action. `/tmp/fuse-birds-retry-handoff.log`.                                                  |
| Recovery limits         | Fake-clock runtime tests exercise late-peer recovery over a 48,000-byte/second reliable link, duplicated/dropped/reordered delivery and rapid alternating passes. Compressed real checkpoints are approximately 24–33 KB.                                                                 |
| Renderer                | Actual Pebble crater/close-up and `WEBGL_lose_context` loss/restoration in Chromium; no match reset. Coverage exercises the same renderer.                                                                                                                                                |
| Visual review           | Durable [real-flow captures and V2 comparison](../design/fuse-birds-playtest/README.md). Controls/counts fit inspected portrait/landscape views. User feel/appearance playtesting remains separate.                                                                                       |

## Reachability investigation

Retained routes are in `games/fuse-birds/tests/fixtures/continuing-play-witnesses.json`. Generate the corpus with `scripts/fuse-birds-continuing-check.ts`, then use `scripts/fuse-birds-escape-check.ts --verify-saved`. Initial/final hashes, action timing and scopes, shooter survival and target damage are checked. Damage from rising water alone cannot qualify a shot route; excavation can legitimately cause a fall into existing water. Other players pass during these existence witnesses, so they do not promise victory against resisting opponents.

The corpus checkpoint writer originally retained a mutable terrain-revision array. It now copies it. Rerunning all 40 matches reproduced the same cases, and retained witnesses were reverified against correct checkpoint hashes.

The two strict current-state misses are seed 3/four players, turns 32–33. Bounded search examined 410 and 802 settled movement/budget states without finding a surviving direct shot. `--late-comparison` verifies successful two-shot excavation routes at earlier real turns 20/21 with identical terrain bits, bird positions, health and wind. At the late states the same ordinary sequence ends after one launch: water rises to 481 while the low bird's feet are at 484.996. The retained `late-water-comparison.json` records both outcomes. This is an earlier missed opportunity followed by sudden-death loss, not evidence that the geometry permanently prevents reaching that player.

The strict current-state verifier deliberately still exits nonzero for those two misses; the separate comparison explains them, rather than counting them as successful shots. Finite seed/range/movement sweeps provide coverage, not a universal proof over all possible later terrain. ADR-050 does not guarantee a winning move from every strategically lost position.

## Reliability evidence and limits

Older uninstrumented online smoke runs timed out during repeated PASS. A source review found stale turn acquisition in the harness and an assertion that could accept natural 25-second expiry as PASS success. The current smoke reacquires peers, scopes the clicked control to the sampled turn, requires at least twelve seconds remaining and requires advancement within five seconds. Real room OB24 passed normally and BY08 passed with 4× CPU slowdown on every page. Current keyboard flows also use the stronger check. These are current-flow passes, not a retrospective claim that the old failure's product cause was proven.

The first coverage run failed an existing service-start deadline; the same failure reproduced on main. The coverage runner now bounds Node test-process concurrency at four without changing that test's deadline. Fresh complete runs pass. Actual Vite source maps are checked against captured source; generated Vite/tsx identities remain separate before c8 remapping. The coverage job installs Chromium and owns free-port Vite/room servers. Vite logged WebSocket EPIPE during successful room teardown in ZB98; no browser page error or gameplay failure occurred.

A previous refill capture showed ×4 because the other bird collected. The stronger current test requires the exhausted bird and captures ×1. Old evidence is not used to claim exhausted-inventory recovery.

The renderer's retained 90-frame idle measurement at seed 123/four players, 1600×1000/DPR1, headless Chromium measured roughly 33.3 ms median and 50 ms p95. This is not a 60 fps claim, physical-phone result or worst-case explosion benchmark. Physical devices, arbitrary network environments and Firefox gameplay remain unqualified.

## Delivery still to finish

Complete the final documentation/diff checks, integrate current main, open the implementation PR, and perform the required independent PR review with fixes or written responses. Leave the reviewed PR open with a runnable muted preview. No merge or deployment is authorized.

The dev-only render/replay HTML pages are verification harnesses, not alternative shipping game implementations.
