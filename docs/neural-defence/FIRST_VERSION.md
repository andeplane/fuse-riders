# First playable skirmish

This version implements player versus AI on a 24 × 20 arena, animated supply and
combat, three tower roles, three particle profiles, and five researches.
It supersedes Phase 0's one-tower/no-AI limits. Sandbox, ghost placement, mobile
gestures and the QWE/ASD command card remain available. Work is reviewed in
[PR #409](https://github.com/andeplane/fuse-riders/pull/409); no merge or deployment.

## Rules and architecture

The AI is a stateless policy over public world state. It generates ordinary
validated commands in the room ticker, including during rollback. It receives
no extra income, instant construction, privileged path or private timer.
Balanced, pressure and economy policies support reproducible headless assays.

The rotationally symmetric arena has 480 cells, two equal starts, nearby
deposits and alternate approaches. Home-relative tie ordering governs AI
decisions, supply paths, builder staging, particle allocation and target
selection. The opening regression and swapped-start matrix verify symmetry.

The immutable engine catalog owns construction, research, particle profiles and
weapon statistics. UI locks and requirement explanations read those definitions.
Pulse towers trade reach for sturdy close-range firepower; Siege towers are
fragile, expensive long-range pressure; Relay towers offer quicker, cheaper
construction and smaller frequent volleys. Towers need one connected neighbor.

Pulse, Heavy and Swift use the same conserved 128-particle pool. Heavy trades
travel and recovery speed for per-shot damage; Swift trades damage for response
and recovery. Refits occur at brain return/departure; in-flight and frontline
profiles stay latched. Growth, Excitation and Conduction lead to Ballistics and
Resonance. All attacks consume actual delivered particles.

Neural rules are version 3; older checkpoints are rejected. Guards validate
research prerequisites on jobs, queued/built advanced structures and every
particle, as well as the selected profile. The existing action log, replay and
checkpoint boundaries remain authoritative. Fuse Riders rules are unchanged.

## Play and presentation

New game → Player vs AI starts the arena. Build chooses a structure before map
placement. The top row offers Q Particles, W Build and E Research. The brain exposes S Auto expand and D Log; a friendly frontline
structure exposes D / Charge. Arrow/Enter placement, disabled-button explanations,
clock progress, wheel/drag and phone pinch/pan remain available.

Builder and attack-particle journeys interpolate authoritative edges. Attack
flashes originate from actual damage events; arrival pulses show delivery.
Supply orbits derive phase from presentation time, so stock/HP updates do not
restart them. Stored and operating-system reduced-motion settings stop orbits.
No cosmetic animation advances game rules.

Victory, Defeat and Draw results provide Play again and Menu. The result card
has a bounded, compact landscape layout above the command dock.

## Balance evidence

Run:

```sh
pnpm exec tsx scripts/neural-defence-skirmish.ts
pnpm exec tsx scripts/neural-defence-tower-assay.ts
```

Both commands use the ordinary engine. Skirmishes use normal timings/resources.
The controlled tower assay gives both sides identical research, profiles,
initial supply and redundant routes, on a rotationally symmetric small arena.

| Balanced AI opponent | First contact |          Finish | Swapped-start result                        |
| -------------------- | ------------: | --------------: | ------------------------------------------- |
| Idle                 |         334 s |           354 s | Same statistics and duration; balanced wins |
| Balanced mirror      |         126 s | 900 s assay cap | Identical income, builds, damage and losses |
| Pressure             |         130 s |           494 s | Same statistics and duration; balanced wins |
| Economy              |         152 s |           632 s | Same statistics and duration; balanced wins |

All eight runs accept their generated commands without rejection. Mirror policy
stalemates are retained as unresolved results, not reported as victories or
time-limit rules. Normal varied-policy games finish in roughly 8–10½ minutes;
the passive opponent loses in roughly 6 minutes. Supplying four forward nodes
uses the full finite pool and resolves the earlier economy endgame stall.

At range two, the controlled equal-supply assay shows Pulse beating Siege in
5 seconds and Relay beating Siege in 6.5 seconds, identically with sides swapped.
Pulse beats the cheaper Relay in 6 seconds. Pulse and Relay mirrors mutually
destroy their towers; Siege mirrors remain symmetric at the 60-second assay cap.
The content test separately proves only Siege reaches three hexes and checks
each tower's actual volley and cadence.

These are evidence of equal starts, usable weapon tradeoffs and functional
counterplay, not a claim that every strategy or human skill level is equally
strong. The pressure policy loses to the balanced policy; human playtesting can
still motivate tuning. No ranked/competitive or physical-phone qualification is
claimed.

## Verification and review

- Typecheck, focused lint and production build pass.
- Full repository suite: 1,674 tests passed; the subsequently added tower-cadence
  regression also passes in the focused content file.
- Headless replay benchmark: 820 ticks / 60 commands / 4 owners; final and replay
  hash `9219e083`; conserved peak 512 particles. See [benchmark](BENCHMARK.md).
- Chromium and WebKit: desktop, narrow phone and short landscape HUD, placement,
  camera, progress and requirements flows pass. Chromium also verifies trusted
  pinch/pan. The actual menu-to-skirmish flow verifies 480 cells, two brains,
  AI construction, locked Heavy requirements and changing supply-orbit transforms.
- The real normal-time defeat/rematch browser smoke passes in Chromium and
  WebKit: the ordinary AI wins at 5:54, the result stays above the phone landscape
  dock with reachable buttons, and Play again restores both brains. The WebKit
  screenshot was visually inspected. See verification/skirmish-defeat-landscape.png.
- Independent engine review found two prerequisite bypasses; both were fixed
  with corrupt-checkpoint regressions and re-reviewed clear (24 focused tests).
- Independent UI review found landscape result overlap and orbit resets; both
  were fixed, with phase-preservation regression and a real-match geometry smoke.
  Its reduced-motion follow-up was fixed with an explicit transform override.

Browser emulation is not physical-device or real-network acceptance. The existing
headless multiplayer adapter and rollback tests remain covered; this first
version exposes local PvAI rather than a new multiplayer lobby.

Verified implementation revision: `994ce5cb`. The PR's CI `verify` gate passed
on that revision (run 36120359332); this final evidence update changes only docs
and screenshots. The PR remains open for human playtesting, with no merge or
deployment. All requested first-version features and the checks above are complete.
