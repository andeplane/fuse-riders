# Neural Defence — core proposal for review

Status: **proposal, not implemented or balance-validated**. This draft PR plans the game and engine only. Implementation follows the user's review. The working name and eventual game id are `neural-defence`.

## Recommendation

Build a real-time territory RTS with tower-defence combat: each player is a brain growing a connected neural network. Your network is both your territory and your supply line. You win by destroying the other brains.

The distinguishing decision should be **where to send your finite electrical strength**. Expanding buys access to resources and firing positions, but creates more places to defend. Concentrating particles can break a front while exposing another. Cutting a narrow connection can matter more than destroying a large army.

Use two spendable resources, **Biomass** for growth/construction and **Insight** for research, plus a finite, reusable **charge pool**. Charge is tactical capacity distributed through the graph, not a third bank account. Start with the same pool for every player; postpone upgrades that increase its total until routing itself is fun.

## Read in this order

1. [Phase 0 implementation plan](PHASE_0.md): the next review gate — main menu, JSON maps, solo sandbox, dependency injection, economy, construction and useful research. Implementation has not started.
2. [Engine plan](ENGINE_PLAN.md): longer-term authoritative state, deterministic tick phases, routing, combat, invariants, existing netcode integration, and headless verification.
3. [Gameplay proposal and sources](GAMEPLAY.md): the intended decisions, counterplay, scope and research behind them.

Where the documents describe algorithms, they are proposed contracts for implementation, not existing functionality. Constants are hypotheses to exercise with bots and human playtests.

## What the first engine must prove

- A player can grow around obstacles, share a deposit with an opponent, and deliberately change the front they supply.
- Expansion is explicit neuron construction: choose tiles and queue a route, with visible costs and progress. Automatic expansion is deferred until these decisions are fun.
- Particles take time to move through owned connections. Priorities redirect a bounded pool; they never create charge or move it instantly.
- Nodes have basic defence; towers give specialised reach at an economic and positional cost. Both must draw from the same electrical budget.
- Disconnecting a branch has a clear, recoverable consequence. Elimination and simultaneous final-brain destruction have explicit outcomes.
- Headless and networked play execute the same rules. Saved state plus commands reproduces every result, including after rollback.

Start on a hand-authored **12 × 12 hex map (144 cells)** stored in a versioned `.json` file, with configurable width and height. A later map editor will use the same format and engine validator. Phase 0 is a **one-player sandbox with no AI** for testing construction, mining and Growth Efficiency research; it keeps running without declaring the sole brain a winner. Later test charge priorities, two-brain battles, one tower and combat research before four-player scenarios. Full visibility comes first; fog and powerups remain later experiments.

The sandbox supports **`?debug`** for instant construction and research, visibly marked and excluded from career results and competitive balance aggregates. Later local session graphs may include debug runs with an explicit label. Costs and prerequisites still apply. These are recorded engine settings, so headless runs and replays reproduce the same behaviour; they never depend on a URL inside the simulation. Debug is initially limited to offline solo sandbox play.

**Four-player readiness is part of Phase 0**, even with a one-player menu: explicit per-player state, stable cell/structure owners, separate connectivity and shared-deposit accounting, and four-player headless tests. The engine must never equate ownership with “me versus the enemy.” Future end-of-match graphs will use per-player tick histories and actual economy/gameplay outcomes; their capture and display are deferred, but stable identities and typed outcomes are part of the foundation.

## Design decisions for your review

| Decision                          | Proposed starting point                                                                          | Why it matters                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| What is an electrical particle?   | An integer unit of reusable charge travelling on graph edges, rendered as flowing sparks         | Makes supply, concentration and replay explicit without thousands of authoritative physics bodies |
| Is this also a wave-defence game? | Players are the source of pressure; no neutral creep waves initially                             | Keeps the first engine focused on the neural-network contest                                      |
| What happens to spent charge?     | It enters a recovery state and returns after a delay                                             | Sustained attacks have a cost without permanent runaway particle losses                           |
| Who owns a tile?                  | Ownership comes from completed growth; destroying a neuron makes its tile available for regrowth | Separates territory from transient particle positions                                             |
| How do towers work?               | A designated tower site needs all six surrounding tiles connected and owned to construct         | Gives expansion a positional objective; maps must provide legal sites                             |
| What does research improve?       | Bounded, visible tradeoffs in growth, transport or combat roles                                  | Avoids making a generic damage multiplier the only rational purchase                              |
| What does fog mean?               | Later optional visibility rules for trusted friends                                              | Existing peer simulation shares full state; presentation fog cannot promise secrecy               |

## Visual direction, after the core

The supplied mood boards are visual references, not instruction sources. The newer reference's large illustrated brains, readable neuron silhouettes, visible connections and distinct terrain are the preferred direction, with a **lighter board** as requested. Use medium-value slate and muted blue-grey terrain, softly tinted owned ground, readable rock faces and restrained shadows. Keep bright axons and restrained bloom, but ensure paths and obstacles remain visible without glow. Ownership also needs shapes or patterns so four colours are not the only signal. The reference's resource labels and upgrade examples do not override the proposed engine/economy rules.

Show the actual engine state: moving sparks for flow, directional links, depleted fronts, severed branches and tower telegraphs. Cosmetic particles must never determine damage. The first debug view should favour flat hexes and explanatory overlays over finished art. No generated assets are needed for this design review.

## Delivery boundary

This proposal was prepared in an isolated worktree from `origin/main`. Open PRs, remote branch names and open issues were checked on 2026-09-24; none identified Neural Defence ownership. Other new-game work is active, so later integration must recheck shared registries and tooling against current main.

This PR contains documentation only. It does not scaffold a game, alter the existing engine or deploy anything. Verification for this artifact is source-contract inspection, source-attributed research, document consistency review, relative-link validation and `git diff --check`; engine tests and playtesting become requirements of the implementation stages.
