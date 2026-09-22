# Slingshot-only correction — rules 6

Walking and hopping were an incorrect interpretation of the user's request. They are removed from the public engine action type, runtime admission, network action adapter, state/checkpoint/view contracts, browser UI, keyboard controls and verification drivers. Birds still respond to blast impulses, unsupported terrain, gravity and fall damage. The legal turn choices are launch or pass. This supersedes the movement-based portions of the original implementation evidence.

`fuse-birds-6` intentionally changes the rules/checkpoint identity; start a fresh room after refreshing the preview. Old rules-5 tabs/checkpoints must not mix with the corrected game. Golden matches have been regenerated using launch/pass only.

Verification on the corrected source:

- Build/typecheck pass; all 58 focused Birds tests and all 1,669 repository tests pass. Explicit engine and peer-entry regressions reject both legacy locomotion commands. The engine regression compares against a no-input tick so normal settling is not mistaken for walking.
- Independent review found no runtime regression and separately passed 16 physics/online tests. Its stale-evidence and README findings were addressed by marking the old report historical, replacing the witness fixture and correcting the controls text.
- Real room XE33 passes two players plus TV, slingshot/keyboard aiming and cancellation, Scatter inventory, phone reload recovery, result and rematch. The UI assertion requires no walking/hopping buttons. The current [aiming capture](../design/fuse-birds-playtest/stationary-aim.png) shows the corrected controls.
- 400 seeded opening maps and 1,050 terrain-free range cases pass. These certify opening shots without movement; they do not certify arbitrary cover after destruction.
- The new stationary continuing-play corpus covers 40 matches and 628 directed checks. The first search misses 95; expanded stationary search verifies 22 direct and 58 excavation routes, leaving 15 unresolved samples. A further 64-unit launch-lattice probe found no direct surviving shot for those samples. A search miss is not a proof of geometric impossibility, but those samples are not verified reachable.

The retained `continuing-play-witnesses.json` now contains the rules-6 results, initial hashes and verified route hashes. `scripts/fuse-birds-escape-check.ts --verify-saved` replays them after regenerating the deterministic corpus. Both search and verification exit nonzero for unresolved routes. No movement-based witness or water-only damage qualifies. The hard-coded rules-5 late-water comparison was removed because its starting states no longer apply.

Unresolved samples: seed 3/four players turns 18–29 (two covered survivors); seed 4/three players turns 36–37; seed 10/five players turn 40. These need further reachability investigation before claiming that every later covered position is validated. The locomotion correction itself is implemented and playable. Earlier rules-5 cross-browser and coverage results remain historical, not fresh evidence for rules 6.
