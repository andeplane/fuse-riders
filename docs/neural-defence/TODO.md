# Fuse Craft TODO

Everything known to need fixing or deciding, in one list. Tick an item when its fix is merged, and add new findings here instead of in a new report file. Link evidence rather than pasting it.

Last reviewed: 2026-09-30, branch `claude/fuse-craft` ([PR #417](https://github.com/andeplane/fuse-riders/pull/417)).

## Needs a decision from Anders

- [ ] Play the current build and say what falls short in look and feel. This is the one open acceptance item in [GOAL_VERIFICATION.md](GOAL_VERIFICATION.md).
- [ ] Decide whether the sprite/SVG oblique battlefield is enough, or whether the game should move to a fully 3D renderer.
- [ ] Decide whether to rename `games/neural-defence/`, the `/neural-defence/` URL and the internal identifiers to Fuse Craft. Only the display name and commit scope have changed so far.

## Performance

- [ ] WebKit at device pixel ratio 2 still drops frames in a live battle: median 21 ms, p95 47 ms, 15 intervals over 50 ms in 20 seconds. Target is a steady 60 FPS. See [cached tints](verification/cached-tints-2026-09-27/README.md).
- [ ] The placement preview still uses a live SVG filter instead of the tint cache.
- [ ] Measure frame rate on a real phone. Every number so far is a headless callback interval.

## Gameplay and balance

- [ ] Pressure against Relay does not finish within the 900-second cap in either seat; both run to 968 seconds. See [durable reconnect](verification/durable-reconnect-2026-09-27/README.md).
- [ ] No human balance data. All win rates come from deterministic AI against AI.
- [ ] Status-effect particles and area-damage towers are deferred in [EXPANSION_PLAN.md](EXPANSION_PLAN.md). Decide whether they are in scope.

## Rendering and visuals

- [ ] Cached team tints are not checked against a native-filter reference image, so exact hue match is unproven. See [cached tints](verification/cached-tints-2026-09-27/README.md).

## Platform and multiplayer

- [ ] No online multiplayer UI. The engine and adapter support four owners, but there are no browser rooms.
- [ ] No win verified on a real phone, and touch or trackpad controls have only been exercised in emulation.
- [ ] Not deployed. Cloud Run serves extra games only when `EXTRA_GAME_IDS` names them.

## Verification gaps

- [ ] Re-run the browser smokes and the 210-case AI matrix on the branch after the merge with `main`. Only typecheck, lint and the unit suite (1,970 tests) were re-run.
- [ ] CI for this pull request skips coverage, smoke and end-to-end jobs; they run on `main` only.
- [ ] Map load failure and retry are covered by injected app tests, not by a simulated browser network failure.

## Documentation

- [ ] `docs/neural-defence/` holds about 40 report files, many superseded. Fold the current ones into the README and archive the rest.
- [ ] [HANDOFF.md](HANDOFF.md), [PHASE_0.md](PHASE_0.md) and [FIRST_VERSION.md](FIRST_VERSION.md) still point to the closed PR #409 and the old `codex/neural-defence-*` branches.
