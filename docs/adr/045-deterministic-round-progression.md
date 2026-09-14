# ADR045: Advance ordinary rounds inside the deterministic simulation

Date: 2026-09-14. Status: independently approved design and implementation; 647 tests, coverage and build pass. Final-source sustained/browser acceptance is in progress. Extends ADR041–044 on `codex/deterministic-action-log`, issue #82. No deployment authorization.

## Problem and alternatives

The constrained mobile run reaches round two but cannot prepare round three: peers stop the old segment at different verified finality ticks, causing full checkpoint fallback despite reconstructing the same action stream. Pacing repeated preparation headers reduces congestion but does not remove this dependency. A new finality-convergence barrier would add another distributed round transition. Treat the ordinary next-round transition as a deterministic game rule instead: its deadline, roster, seed and settings are already simulation data.

## Invariants and implementation

Only the direct simulation changes. LAN and solo retain their existing session manager. When a direct step reaches the round-over deadline and at least two players remain connected, derive the next round with the shared `startNextRound` rule after applying that tick’s ordinary actions and shared step, at that exact tick. Boundary-tick controls therefore belong to the ending round and are cleared before the new countdown. Preserve the segment alias, absolute tick numbering, per-player action and gesture sequence identities, clock and repair queues. No next-round management packet, preparation barrier or checkpoint is generated for an unchanged roster.

Reset held controls and active bomb gestures together at the boundary, retaining each latest gesture identity so an old release cannot fire in the next round. Locally generated actions remain tick-stamped and follow the same rule during replay. A fresh press uses the next gesture identity. On each finalized round increase, cancel local controls once through the existing origin and ordinary action delivery before notifying the UI to clear held controls. This origin reset retains the consumed UI revision as well as wire/gesture counters, so the next user revision is not swallowed. No reset is emitted from a speculative round change. Controller-only peers receive monotonically increasing finalized round/tick status in the same segment instead of being limited to the preparation header’s initial round; reject regressions and wrong roster/owner identities. Record and test controls crossing the boundary, including actions delivered late and out of order.

Pending powerup settings must remain deterministic and checkpointed; preserve current behavior that powerups apply next round while match format and length remain fixed for the match. Store pending round settings in validated direct state, set them identically during lifecycle derivation from the authenticated room plan, and include them in replay hashes and checkpoint byte limits. Bump the direct rules version because replay semantics and checkpoint shape change. Explicit start/rematch, room commands, membership changes and recovery retain existing bounded lifecycle barriers and finalized-state fencing.

Shared outcomes still require existing coordinator finality and local proof/hash validation. Speculation may cross the round boundary but cannot publish the new round until finality crosses it. Presentation must use a coherent finalized scene when speculative and finalized round identities differ; never combine new spawn geometry with old round scores/alive state. Preserve event round identity when an event is committed after simulation has entered a later round. Rendering still cannot advance physics.

## Failure behavior and costs

The existing rollback, finality, clock, action-repair, setup and recovery bounds remain unchanged. Missing actions can delay finality and produce explicit bounded recovery; no missing action is guessed into a committed result. A roster with fewer than two connected players stays at round-over pending an explicit room decision. No extra per-round packet, world cache or unbounded history is introduced. Full checkpoint fallback remains available for actual lifecycle changes.

## Acceptance

1. Independent design review before implementation and bounded implementation review afterwards.
2. Exact deterministic next-round tick and bootstrap/hash roundtrip; pending settings validation and match-format preservation; too-few-connected-player behavior.
3. Late/reordered actions across round boundaries converge to the same state and outcomes; old bomb releases cannot launch in a new round; fresh gestures still work; committed events retain their original round.
4. Serialized runtime play completes multiple rounds with one segment alias and no next-round preparation/chunk traffic; explicit management and recovery remain covered.
5. Finalized presentation stays coherent across speculative round advancement.
6. Repeat the unchanged mobile and regional six-context profiles, preserving both prior failures and exact source hashes; then run sustained repeated matches and report application payloads separately from unmeasured wire bytes.


[Implementation evidence](../online/direct-actions-evidence/deterministic-rounds/manifest.json) preserves intermediate mobile failures, the short passing run, source hashes and current complete test results.
