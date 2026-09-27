# Goal verification — 2026-09-27

Objective: complete a more complex game with multiple working strategies,
AI-vs-AI balance evidence, beautiful animation and particles, and greater visual
depth. Current game source: `f76bdc5d`; world rules 9, AI policy 5, adapter
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

Further live profiling found a concrete unresolved animation issue:
[WebKit callback cadence](verification/frame-profile-2026-09-27/README.md) falls
far below Chromium during the same early battle. Building-image raster cost is
under investigation; screenshot/flow checks did not reveal this limitation.

The goal remains open on animation smoothness and visual/play-feel acceptance. Green tests,
more effects and completed AI matches do not establish AAA quality. The user has
been asked to try the concrete preview and identify what still falls short.
No additional architecture rewrite is assumed from an unanswered question.

Preview: http://127.0.0.1:5174/games/neural-defence/?mute
