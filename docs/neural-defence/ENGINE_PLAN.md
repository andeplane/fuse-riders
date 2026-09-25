# Neural Defence engine plan and implementation map

Status: the Phase 0 engine and adapter are implemented locally and under review; the [checkpoint review](REVIEW-2026-09-25.md) and [handoff](HANDOFF.md) identify open corrections and acceptance work. This document records the rule pipeline and extension boundaries. [`PHASE_0.md`](PHASE_0.md) and the current [`RULES`](../../games/neural-defence/src/engine/types.ts) define the playable slice and numbers.

## Current authority

[`engine/index.ts`](../../games/neural-defence/src/engine/index.ts) exposes `createMatch`, `isAction`, `step`, `observe`, `encodeState`, `decodeState` and `hashState`; [`map.ts`](../../games/neural-defence/src/engine/map.ts) validates versioned `odd-r` maps. A world contains 1–4 explicit owners. Each has independent resources, research, one builder, 128 reusable attack particles, priorities, queues and statistics. Structures have stable owner/entity IDs. Connectivity traverses completed friendly structures only. Static deposit cells stay neutral and pay each owner according to that owner's connected sides.

One step clones the incoming world, increments the tick and resolves canonical commands with sequence and match scope. It updates income and research, resolves each firing cadence with simultaneous damage, refreshes connectivity and stale priorities, arbitrates eligible construction claims, advances builders, then routes attack particles. Combat precedes construction completion so a destroyed paid site cannot emerge healthy in the same tick. Paid construction reserves a site and pays once; one builder moves through the friendly graph and returns or recovers after work. A separate 128-unit attack pool moves with edge latency/capacity, can be redirected by weighted priorities, fires only where stationed and recovers after spending. The test tower is constructible on an open hex with six connected friendly neighbors and needs that support ring to fire; `towerSite` is only a map/editor hint.

Growth, Excitation and Conduction are independent one-tier research choices, sharing one active job and costing Insight. Growth reduces later neuron work time; Excitation changes later attack profile; Conduction changes later builder and attack edge time. No guard/defence particles, mix/refit, armour arithmetic or second timer belong to Phase 0. Preserve these boundaries if adding a new role later.

## Replay and integration

The [`RollbackGame` adapter](../../games/neural-defence/src/online/game.ts) folds management and current-generation player streams into commands. Offline play uses that adapter through [`RoomRuntime`](../../games/neural-defence/src/online/session.ts) and typed runtime dependencies, without constructing WebRTC transport. Engine map/action/state guards are runtime checks, not TypeScript casts. Restore a checkpoint only after validating scope, map/settings identity, per-owner state, capacities and cross-field consistency; reject malformed states without changing healthy runtime state. Keep queues, parsers, history and recovery bounded. For changes to these rules, test both deterministic replay and negative cases such as dropped/duplicate/reordered actions and malformed checkpoints.

The UI currently launches solo sandbox and scripted lab. Four-owner behavior belongs to headless engine/adapter tests now, while browser multiplayer, network qualification and production deployment are future integrations. Future graphs may derive per-player histories from confirmed outcomes and counters, replacing rolled-back observations rather than double-counting them. They must not feed back into authority.

## Next evidence gates

The following matrix is the Phase 0 completion target. A focused test proves a particular behavior; it does not substitute for browser or real-network evidence.

| Boundary                 | Required observation                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four owners and map      | Explicit noncontiguous spawn assignments, independent resources/research/priority/stock, shared deposit sides, foreign-ownership rejection, and a structurally valid but unfair map identified separately            |
| Construction and builder | Competing same-tick claims without player-name advantage; unpaid queue vs paid site; dispatch, edge latency, return, cancellation, cut at both edge endpoints, delayed recovery and no lost/duplicated builder       |
| Attack and combat        | All 128 units accounted for per living owner; weighted priority redistribution without teleporting; edge launch/transit and receiving bounds; spent/recovered profiles; simultaneous damage and final-brain outcomes |
| Tower                    | Legal construction on any fully enclosed open hex, one fixture initialized at a route-derived lab cell, range/two-hop occlusion, supplied vs starved fire, support loss and restored support, and no free damage     |
| Replay/checkpoints       | Canonical state/hash round trip, watcher and sparse-seat round trips, wrong scope/shape/identity rejected atomically, late-input replay convergence, duplicate/reordered action handling and bounded state           |
| App/browser              | Landing to menu, New game, Settings, map loading/error/retry, sandbox and lab, queue/build/mine/research, priority/latency, reset/menu, independent debug toggles, keyboard and narrow viewport                      |
| Art                      | Four team-specific neuron silhouettes, terrain/rock variants, deposits, builder and attack readability, genuine alpha, shared overlays and screenshots from the real flow                                            |

Future graph work needs a stable event vocabulary and sampling contract. Current `Outcome` records confirmed events for one tick and `Player.statistics` holds cumulative Biomass/Insight earned, built structures, damage and losses. Later history should distinguish stock from interval flow, record actual spend and delivery delays if needed, key every record by match/player/tick, and replace rolled-back windows rather than append duplicates. It must keep no authority outside the checkpointed simulation and must state retention limits before online use.

Close the concrete issues in the review, inspect actual sprites, and exercise the browser flow. Run focused tests during edits and broader repository checks at integration. Report local, browser, CI and deployment evidence separately. Balance needs repeatable headless scenarios, matched seats and human play beyond a passing suite.

Later mechanics—additional particle roles, a tower roster, repair/shields, AI policies, fog, map editing and online rooms—need their own contracts and tests rather than compatibility code in this initial slice. The broader strategy and source notes are in [`GAMEPLAY.md`](GAMEPLAY.md) and [`RTS_PLAYBOOK.md`](RTS_PLAYBOOK.md).
