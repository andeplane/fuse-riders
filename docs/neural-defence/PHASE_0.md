# Neural Defence Phase 0

Status: **implemented locally; final verification and player review remain open** on draft PR #409. This describes the first playable slice and current rules, not a claim of complete browser, visual, balance or network acceptance. See [HANDOFF.md](HANDOFF.md) for exact checks and remaining work, and the [checkpoint review](REVIEW-2026-09-25.md) for resolved findings.

## Playable slice

The main menu offers **New game** and **Settings**, using Fuse Riders' shared neon/pixel presentation rather than a separate dashboard theme. New game selects a JSON map, spawn and either a solo sandbox without AI or a scripted combat lab. The sandbox keeps running with one brain and no automatic victory. The lab has one opposing network and exactly one experimental tower; its opponent issues ordinary priority actions. Settings holds the working local reduced-motion preference; audio is not implemented. Online rooms, multiplayer browser UI, career settlement and deployment are outside Phase 0, although the engine and adapter handle up to four owners headlessly.

The player grows brain-connected neurons, reaches Biomass and Insight deposits, researches and sets attack demand on owned structures. Construction uses **one separate reusable builder per player**. A queued job waits for legality and funds; dispatch pays once; the builder travels through completed friendly structures to an adjacent anchor; work starts on arrival; it returns before the next job. A paid site can be attacked or cancelled without refund. A severed route sends the builder into delayed recovery. The builder cannot fight and is never one of the 128 attack particles.

An ordinary neuron fires at adjacent targets when supplied. The **one test tower type** costs more, can be built on an open hex enclosed by six connected friendly structures, and fires at range two only while its own connection and all six supports remain intact. It consumes the same supplied attack particles. `towerSite` is a map/editor hint for a useful test location, not exclusive build permission. This assays tower support and supply; it does not establish a tower roster or balance.

`?debug` shows hex boundaries and offers **independent**, initially unchecked instant construction and instant research options on setup. Instant construction removes work time after builder delivery. Instant research removes research time. Both retain costs, prerequisites and travel. The flags are saved in match settings; the engine does not read the URL.

## Authoritative values

[`engine/types.ts`](../../games/neural-defence/src/engine/types.ts) (`RULES`) and [`engine/index.ts`](../../games/neural-defence/src/engine/index.ts) own exact rules. Currency is integer milli-units (1,000 = one displayed unit). Values are first-play hypotheses, not balance findings.

| Rule                     | Current value                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tick rate                | 20 Hz; one engine step per tick                                                                                                                           |
| Starting state per owner | One 240 HP brain, 60 Biomass, 0 Insight, one builder and 128 attack particles                                                                             |
| Baseline income          | 1 Biomass/s and 0.5 Insight/s per living brain                                                                                                            |
| Deposit income           | Biomass 6/s or Insight 3/s with six connected neighbors; proportional to each owner's connected sides                                                     |
| Construction             | Neuron 20 Biomass, 120 work ticks, 60 HP; tower 60 Biomass, 240 work ticks, 100 HP; paid site 20 HP                                                       |
| Research                 | 10 Insight and 400 ticks each; one active job; Growth, Excitation and Conduction are independent                                                          |
| Growth                   | New neuron jobs take 80 work ticks                                                                                                                        |
| Excitation               | Attack becomes 3 instead of 2 when particles return to or depart from the brain                                                                           |
| Conduction               | New builder and attack edge traversals take 3 ticks instead of 4                                                                                          |
| Supply                   | Fixed 128 attack particles per living owner; up to eight priority destinations, weight 1–3; node deployment cap 32; edge launch 8/tick and transit cap 32 |
| Combat                   | Every 20 ticks; neuron spends up to 4 supplied particles, tower up to 8; spent particles enter delayed brain recovery                                     |
| Bounds                   | Construction queue 32; bank cap 1,000,000 displayed units per currency                                                                                    |

Priority weight `0` clears a destination. Growth and mining never create attack stock. Defence is structure HP, positioning, counterfire and maintained supply. Guard, shield, absorption and refit are not Phase 0 actions.

## Map and state contract

Version 1 JSON maps use `odd-r` offset hexes with row-major cells, dimensions 1–64 per side and 1–4 explicit spawn slots. Cells are open (optionally with a visual variant or `towerSite` suggestion), blocked, or a Biomass/Insight deposit. Deposits and blockers cannot hold structures. [`loadMap`](../../games/neural-defence/src/engine/map.ts) validates schema, spawn identity, connected open terrain and each spawn's expansion neighbor. Map fairness and lab layout need separate tests; structural validity alone does not make a competitive map.

[`createMatch`](../../games/neural-defence/src/engine/index.ts) takes an explicit 1–4 player roster and slots. Ownership, balances, jobs, research, priorities, particles and statistics are per owner. The same `step` handles solo, lab and multi-owner headless runs. Commands carry actor, sequence and optional match scope. Encoding, decoding and hashing support replay and checkpoint restoration. Statistics (`biomassEarned`, `insightEarned`, `built`, `damage`, `lost`) reserve a future graphs seam; historical series and graphs remain later work.

## Acceptance boundary

Focused regressions cover four-owner state/replay, simultaneous construction claims, builder travel and cuts, shared deposits, independent research, supplied/starved tower firing, particle conservation and latency, checkpoint rejection and lobby/match lifecycle restoration. Shared UI and individual sprites are integrated; particle motion interpolates authoritative travel and attack flashes use resolved event origins. [ASSET_MANIFEST.md](ASSET_MANIFEST.md) distinguishes delivered files from later visual variety.

Browser checks have exercised menu/setup, debug construction and priority controls, with desktop and narrow-screen geometry checks. Complete live error/retry, economy/research, builder recovery and combat acceptance remain to be recorded. The [review](REVIEW-2026-09-25.md) preserves resolved findings; [HANDOFF.md](HANDOFF.md) tracks exact test results and remaining limits. Local tests or an open PR alone do not establish visual acceptance or RTS balance.
