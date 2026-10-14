# Fuse Craft expansion and balance pass

Authorized scope: improve content, balance, graphics and the existing playable local game. Preserve the finite 128-particle pool, one builder, connected supply, normal resource rules, mobile controls and deterministic replay. No merge or deployment is authorized.

Implemented expansion and current limits are recorded in [BALANCE_REPORT.md](BALANCE_REPORT.md). Rules 5 also reduces Siege volley/cadence and improves AI reconnection and strategic targeting. Additional status-effect particles and area-damage towers remain deferred, as scoped below.

## Continuing goal: completion remains unproven

The user explicitly requested more complexity, multiple viable strategies, AI-versus-AI balance evidence and substantially more dimensional, beautiful animation and particle effects. The initial expansion does not close that goal.

- **Strategic breadth:** five openings already show counters on Close Quarters. The new Defensive anchor/artillery opening must retain a useful anti-pressure role without becoming universally dominant. Wider-map stalled fights still require diagnosis and another measured rules/policy iteration.
- **Further content:** choose the next mechanic from those failures rather than add unconditional damage upgrades. Evaluate a supply-disruption or area-control role against entrenched lines, including counterplay, finite-pool costs, readable previews and shared catalog prerequisites. Nothing in this paragraph is implemented content.
- **Visual depth:** the [angled battlefield milestone](OBLIQUE_BATTLEFIELD.md) adds a shared oblique ground projection, upright depth-sorted bodies and directional silhouette shadows, alongside projected combat effects. This illustrated 2.5D treatment does not prove the user's requested AAA appearance. Further environmental composition and animation inspection remain necessary.
- **Acceptance:** broaden strategy trials to more layouts and meaningful variations, inspect actual animated battles and ordinary desktop/mobile interaction, and preserve honest limits. Green tests and one attractive screenshot cannot close the goal.

## Baseline — 003efb84

The three current policies were paired on Synaptic Reach in both starting positions. Balanced beats Pressure at 494 seconds and Economy at 632 seconds; Economy beats Pressure at 642 seconds. All mirrors remain unfinished at the 900-second cap. Swapped seats produce matching outcome/time/statistics, and no commands are rejected. Pressure inflicts no damage against Balanced: investigate policy behavior and ranged construction pressure before changing damage numbers. Nine isolated close-range tower assays provide separate mechanical evidence; they do not account for technology, cost or full-match supply.

## Implementation order

1. Build a repeatable full strategy tournament with swapped seats, multiple symmetric map layouts, ordinary commands, normal timings, result/timeout distinction, composition/economy/supply diagnostics, source revision and replayable command records. Preserve deterministic behavior; no external mutable random source.
2. Add two distinct choices through the shared catalogs:
   - **Harvester**: Growth unlock, 60 Biomass, 12-second construction, fragile non-firing economic building. Requires a deposit-adjacent open tile and live connected support. Provides a fixed extra extraction contribution per adjacent deposit, capped at one specialist bonus per deposit per player. Remains a network conduit. No attack-priority/Charge commands.
   - **Bastion**: Growth unlock, 70 Biomass, 16-second construction, durable range-one defensive anchor. Uses ordinary supplied particles; artillery outranges it and severing its network disables it. Initial numbers are tuning hypotheses, not a balance claim.
3. Expand policies into genuinely different openings and decisions: pressure, economy, Siege timing, Relay/Swift, defensive and balanced adaptive. Each must handle supply, threatened construction and tech counters rather than endlessly repeat a losing build.
4. Run the tournament, inspect match diagnostics and representative rendered games, tune narrowly, then repeat on held-out layouts. Document unsuccessful policies and unfinished matches rather than hiding them. Distinguish policy weakness from unit strength.
5. Deliver matching sculpted artwork, ghosts/portraits/cards, informative locked-state help, economy inspection, updated tech tree and desktop/phone verification. Commit and push completed milestones to the existing PR.

Specialized status-effect particles and an area-damage tower are a later expansion only if this pass establishes a useful need. Do not dilute existing roles with another unconditional damage upgrade.

## Engineering contracts

Catalog definitions own prerequisites, deposit requirements, economic bonus and weapon capability. UI consumes those definitions. Extraction remains integer arithmetic with checkpointed remainders; one bonus per deposit prevents specialist stacking. Old rules-version checkpoints are rejected after changing authoritative behavior. New structures share normal placement, planning, connectivity, health, construction damage, routing and ownership rules. Match logs contain public game commands and no service credentials.

## Acceptance

### Evidence-driven rule correction

Initial matches exposed 20-HP construction being erased by one Siege volley and the lowest-HP targeting rule repeatedly preferring scaffolds over completed threats. Rules 4 gives paid construction its building's catalog durability, preserves damage through completion, and prioritizes brains and completed threats over scaffolds. Costs, supply pool and travel remain ordinary; there is no invulnerability or construction healing. Subsequent tournament results must be interpreted separately from the initial baseline.

Focused rule/guard/UI tests; deterministic replay and seat-symmetry checks; actual normal-time construction and supply in Chromium/WebKit; phone layout and gestures; full repository tests/build/lint before push; independent PR review. Tournament evidence must state its maps, policies, caps and source revision. AI results do not certify human balance or physical-phone behavior. No automatic merging or deployment.
