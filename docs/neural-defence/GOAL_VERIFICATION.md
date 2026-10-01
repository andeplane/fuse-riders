# Goal verification

## Update: territory, strategies and N players, 2026-09-30

Branch `claude/fuse-craft`, rules 12. The current online adapter is `neural-defence-12-watch-9` ([`src/online/game.ts`](../../games/neural-defence/src/online/game.ts)); the evidence below was recorded at `neural-defence-12-watch-7`. The goal: the game works end to end over the established networking for up to four players and generalises to N; several documented, benchmarked strategies with counters to all, built on an RTS/tower-defence playbook with good economy play; taking over the map with neurons at the core; several tower types with distinct particles and mechanics; a tutorial, in-game docs, at least eight maps, and strong end-of-match statistics.

| Requirement                                                          | Evidence                                                                                                                                                                                                                                                                        | Assessment                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| End to end online, up to four players                                | Four browsers play a Cortex Crossing room on the local room service (create, join by link, pick map, start, grow, agree, return to lobby); mesh tests for four- and six-member rooms. [Four players](verification/four-player-2026-09-30/README.md)                             | Verified locally; not across real networks or phones |
| Generalises to N players                                             | `RULES.maxPlayers` 8 throughout engine, rooms, palettes and UI; six browsers play Grand Cortex; eight players seat on one map in tests; seats verified fair (mirror duels 61–58; four-player wins 104/98/114/103 over a balanced seat design)                                   | Verified to six online, eight in the engine          |
| Bugs fixed on the way                                                | Over-full tables silently refused to start; a finishing elimination left an invalid checkpoint; raw-index tie-breaks favoured seat 0 on four-way maps; rotating claim precedence favoured neighbouring seats; neurons firing made the widest network the biggest army           | Fixed with regression tests                          |
| Taking over the map is the core                                      | Territory claims, contested cells, income, creep-like sprouting that snowballs with territory, and dominance victory; dominance decides about half of four-player games and 34 of 504 duels (mostly Synapse Islands)                                                            | Implemented; [tech tree](TECH_TREE.md)               |
| Several strategies, documented and benchmarked, with counters to all | Seven openings; 504-match duel matrix on nine maps (2026-10-01): every opening wins 39–61% and has at least one favourable matchup and one counter; 420-game four-player free-for-all in which every pair of openings meets in every pair of seats. [Strategies](STRATEGIES.md) | Met for these AI policies; no human data             |
| RTS / tower-defence playbook, economy play                           | Rush, greed, turtle, contain, tempo and creep openings; two-miner deposit cap and Harvesters; Spore splash as the answer to massed creep; map-dependent metas (rushes on close maps, economies on wide ones)                                                                    | Implemented and measured                             |
| Multiple tower types, particles and mechanics                        | Pulse, Siege (blind spot), Relay, Bastion (shields), Spore (lobbed splash aimed at clusters), Harvester; Pulse, Heavy and Swift particles; powerups                                                                                                                             | Implemented, with a distinct spore-burst effect      |
| Tutorial, in-game docs                                               | Coached tutorial on Slate Basin that advances from the live world; How to Play from the menu or **?** in a match, generated from the catalog and benchmark counters                                                                                                             | Implemented and exercised in the browser             |
| At least eight maps                                                  | Eleven maps, four new from a symmetric generator (two-, four- and six-seat), all tested for symmetry and per-seat fairness                                                                                                                                                      | Met                                                  |
| End-of-match statistics                                              | Match report: "what decided it" findings, territory/economy/army/damage charts with key moments, scoreboard, research paths, key-moment log                                                                                                                                     | Implemented and inspected in the browser             |

Local checks: all repository tests, typecheck, lint and build pass; the PR's CI is green. Remaining open items are in [TODO](TODO.md).

## Update — 2026-09-30

Branch `claude/fuse-craft`, [PR #417](https://github.com/andeplane/fuse-riders/pull/417)
(replaces #409, merged with current `main`). The visual pass answers the
user's review ("neurons look alike and static; want a more 3D, Zerg-like
growth"; then "AAA style, animations and colours"):

| Requirement                 | Evidence                                                                                                                                                                                                                                                     | Assessment                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Balance, AI against AI      | All 210 cases on the merged source match the qualified matrix exactly by replay hash, result and duration; zero rejected commands; the same two Pressure/Relay timeouts                                                                                      | Unchanged and reconfirmed                                                                       |
| Richer motion and particles | Procedural, swaying neurons with signal sparks; cocoon growth; spreading and receding creep with heartbeat ripples; breathing brains; neuron death bursts; a GPU light layer with axon signals, lit particles, spores, hit flashes, sparks, embers and motes | Implemented; see [organic network and light](verification/organic-light-2026-09-30/README.md)   |
| Less flat presentation      | Raised creep slab with side and shadow, shaded somas with nuclei, buildings rooted into tissue mounds, additive emissive light and a vignette                                                                                                                | Clearly less flat; still an oblique 2D scene, not a 3D camera                                   |
| Colour                      | Muted creep so units stand out, three tones per team for neurons, emissive glow, graded edges                                                                                                                                                                | Implemented; the user asked for the muted creep                                                 |
| Performance                 | Chromium on GPU: locked 60 at DPR 2 with light. WebKit: median 22 ms, p95 44 ms, none over 50 ms                                                                                                                                                             | WebKit still below 60; better than before the branch                                            |
| Overall AAA quality         | Captures and clips retained                                                                                                                                                                                                                                  | **Not proven.** Needs the user's play review; the main known gaps are listed in [TODO](TODO.md) |

The 2026-09-27 audit follows unchanged for its evidence.

## 2026-09-27

Objective: complete a more complex game with multiple working strategies,
AI-vs-AI balance evidence, beautiful animation and particles, and greater visual
depth. Gameplay verification source: `f76bdc5d`; current renderer: `180251c2`.
World rules 9, AI policy 5, adapter
`neural-defence-9-watch-4`. PR #409 remains open; no merge or deployment occurred.

| Requirement                           | Current evidence                                                                                                                                                                                                                                                                                                             | Assessment                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| More strategic complexity             | [Tech tree](TECH_TREE.md): four weapon roles, Harvester economy, three particle profiles, five researches, paid construction and neuron specialization, finite shared particle supply and vulnerable connected routes                                                                                                        | Implemented and exercised by engine and browser checks                                                                                       |
| Multiple strategies work              | [Complete matrix and per-map wins](verification/durable-reconnect-2026-09-27/README.md): six openings, five maps, both seats; every opening wins a different-opening matchup on the default map; strengths change across maps                                                                                                | Demonstrated for these deterministic policies; human win rates are not established                                                           |
| Check AI against AI                   | 210 cases, 208 finish within 900 seconds; both remaining Pressure/Relay cases finish at 968 seconds. Zero rejected commands, no seat-dependent winner changes. Exact-source verification reproduces both 572-second mirrors and both extensions command by command                                                           | Complete for the specified matrix; no universal-balance claim                                                                                |
| A playable match through completion   | [Player victory](verification/player-victory-2026-09-27/README.md): 45 ordinary UI actions, research/build/supply/profile control, Victory at 2:46, then Play again restores both brains. Existing sandbox smokes cover specialization/cancellation; the finish smoke covers defeat                                          | Desktop end-to-end victory verified; physical-phone victory is unverified                                                                    |
| Richer motion and particles           | [Live battle](verification/battle-framing-2026-09-27/README.md), [conduits](verification/conduits-2026-09-27/README.md), [building collapse](verification/wreck-collapse-2026-09-27/README.md): curved supply motion, weapon trails, shields, recoil, construction, smoke, debris and collapse, with reduced-motion handling | Implemented and visually inspected in Chromium/WebKit captures                                                                               |
| Less flat presentation                | Oblique ground projection, raised building/terrain art, depth ordering, cast/contact shadows, dimensional conduits, curved shields and rising impact effects                                                                                                                                                                 | Greater depth is visible; the renderer remains sprite/SVG based rather than a fully 3D battlefield                                           |
| Requested overall visual/feel quality | Runnable preview and retained clips/screenshots, plus agent inspection                                                                                                                                                                                                                                                       | **Not proven:** user review is needed to establish whether this presentation meets the intended quality bar or requires a fully 3D direction |

Local verification on the final gameplay source: all 1,803 repository tests,
typecheck, focused lint and build pass. The PR's `verify` gate is green for
`f76bdc5d` ([CI run](https://github.com/andeplane/fuse-riders/actions/runs/36325219100)).
Coverage and hosted browser jobs were skipped by this PR workflow; they are not
claimed as runs. The focused browser evidence linked above was run locally.

Further live profiling exposed a WebKit animation issue that screenshot/flow
checks had missed. [Adaptive building rasters](verification/adaptive-raster-2026-09-27/README.md)
on source `a63e84f2` improve the measured median/p95 callback interval from
100/152 ms to 17/27 ms, with no intervals over 50 ms in the retained sample.
Chromium remains at 16.7/16.7 ms. All 1,806 tests, typecheck, focused lint and
build pass. These are headless callback measurements, not physical-phone FPS.
The subsequent [camera-only refresh fix](verification/raster-refresh-2026-09-27/README.md)
also updates ready artwork after game frames stop. Both browser regressions and
all 1,807 repository tests pass on that source.

The additional DPR-2 desktop WebKit profile is still slow: median/p95 71/79 ms.
The goal remains open on high-density animation smoothness and visual/play-feel acceptance. Green tests,
more effects and completed AI matches do not establish AAA quality. The user has
been asked to try the concrete preview and identify what still falls short.
No additional architecture rewrite is assumed from an unanswered question.

Preview: http://127.0.0.1:5174/games/neural-defence/?mute
