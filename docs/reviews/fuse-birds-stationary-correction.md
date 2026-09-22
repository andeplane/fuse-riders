# Fixed birds — rules 7

Birds keep the x/y position assigned during map preparation for the entire round. Walking, hopping, knockback, falling, support correction and fall damage are absent. Player state has no velocity, grounded, fall-height or movement-budget fields. Destroying terrain under a bird never moves it or disables its slingshot. Pebble, Scatter, direct/blast damage, destructible terrain, falling shootable crates, water hazards, turns and rematch remain.

This supersedes rules 6, which removed player-controlled movement but still allowed knockback/falling. The user asked for stationary birds for now. Rules/checkpoint identity is `fuse-birds-7-snapshot2`; refresh and create a fresh room rather than mixing old tabs into the match.

## Current evidence

Independent review of the rules-7 diff found no actionable regressions and separately passed 21 engine/physics checks.

- All 58 focused Birds tests and all 1,669 repository tests pass. Build/typecheck pass. Regression tests cover a surviving direct hit, destruction of all support, launching without support, passing, water elimination and checkpoint continuation with unchanged bird coordinates. Legacy walking/hopping commands remain rejected at the engine and peer boundaries.
- The shared replay driver checks fixed bird coordinates on every tick after preparation, including completed 2/3/5-player matches and checkpoint restores. Golden outcomes were intentionally regenerated for rules 7. Cross-browser replay evidence is being refreshed for this version.
- Real room ZK31: an ordinary mouse-fired Pebble damaged Ember from 100 to 66 and cut the terrain. The recovered peer checkpoint proved both birds retained exactly their starting coordinates. The same room exhausted all three Scatter shots, disabled ×0, collected a naturally dropped refill with Pebble and recovered the correct ammo. [Actual impact capture](../design/fuse-birds-playtest/stationary-impact.png).
- Real room VO09: two players and TV passed slingshot/keyboard aiming and cancellation, Scatter counts, reload/recovery, result and rematch. No locomotion controls or land-before-aim gate remains. [Current aiming capture](../design/fuse-birds-playtest/stationary-aim.png).
- 400 seeded opening maps and 1,050 terrain-free range cases pass. The fixed-position continuing corpus covers 40 complete matches and **709 directed post-destruction checks, all with surviving direct Pebble hit witnesses and zero failures**. No walking, knockback, falling or excavation route qualifies these witnesses. Every corpus tick also checks unchanged positions.
- `games/fuse-birds/tests/fixtures/fixed-position-reachability.json` retains the full action histories, current-state hashes and shot witnesses. `scripts/fuse-birds-continuing-check.ts --verify-saved` regenerates and verifies them. The older escape fixture has zero entries because this corpus has zero counterexamples; it is not used instead of the successful corpus. The escape verifier requires exact coverage of any future reported counterexamples.

The 15 unresolved samples under rules 6 resulted from movable-bird states and are superseded, not relabelled as successful fixed-position samples. The rules-7 corpus uses newly generated matches and their actual actions. Finite seed/range coverage is not a mathematical proof for every possible terrain configuration, and browser emulation is not physical-phone/TV performance evidence.

Earlier rules-5 coverage and cross-runtime artifacts remain historical. No merge or deployment is authorized; the corrected local preview is `http://localhost:8893/fuse-birds/?mute`.
