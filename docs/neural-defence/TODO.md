# Fuse Craft TODO

Everything known to need fixing or deciding, in one list. Tick an item when its fix is merged, and add new findings here instead of in a new report file. Link evidence rather than pasting it.

Last reviewed: 2026-09-30, branch `claude/fuse-craft` ([PR #417](https://github.com/andeplane/fuse-riders/pull/417)).

## Needs a decision from Anders

- [ ] Play the current build and say what falls short in look and feel. This is the one open acceptance item in [GOAL_VERIFICATION.md](GOAL_VERIFICATION.md).
- [ ] Decide whether the SVG battlefield with its GPU light layer is enough, or whether the whole battlefield should move to WebGL (true bloom, lit terrain, tilted camera). See [organic network and light](verification/organic-light-2026-09-30/README.md).
- [ ] Brains and towers are still painted mechanical sprites, now rooted into the creep. Decide whether they should become organic structures in the same procedural style as neurons.
- [ ] Decide whether to rename `games/neural-defence/`, the `/neural-defence/` URL and the internal identifiers to Fuse Craft. Only the display name and commit scope have changed so far.

## Performance

- [ ] WebKit at device pixel ratio 2 still misses 60 FPS in a live battle: median 22 ms, p95 44 ms, none over 50 ms, 46 callbacks per second. It was 52.7 per second before the light layer, and resolution capping did not recover it. Chromium on the GPU holds 60. See [organic network and light](verification/organic-light-2026-09-30/README.md).
- [ ] The placement preview still uses a live SVG filter instead of the tint cache.
- [ ] Measure frame rate on a real phone. Every number so far is a headless callback interval.

## Gameplay and balance

- [ ] Pressure against Relay does not finish within the 900-second cap in either seat; both run to 968 seconds. See [durable reconnect](verification/durable-reconnect-2026-09-27/README.md).
- [ ] No human balance data. All win rates come from deterministic AI against AI.
- [ ] Status-effect particles and area-damage towers are deferred in [EXPANSION_PLAN.md](EXPANSION_PLAN.md). Decide whether they are in scope.

## Rendering and visuals

- [ ] Neurons at default play zoom read as glowing orbs; branch silhouettes are clearer only when zoomed in. Consider thicker branches or a size bump with age.
- [ ] The light layer's bloom is additive glow, not a true bloom pass; there is no light falling on terrain from effects beyond the glow itself.

- [ ] Cached team tints are not checked against a native-filter reference image, so exact hue match is unproven. See [cached tints](verification/cached-tints-2026-09-27/README.md).

## Platform and multiplayer

- [ ] No online multiplayer UI. The engine and adapter support four owners, but there are no browser rooms.
- [ ] No win verified on a real phone, and touch or trackpad controls have only been exercised in emulation.
- [ ] Not deployed. Cloud Run serves extra games only when `EXTRA_GAME_IDS` names them.

## Verification gaps

- [x] Re-run the browser smokes and the 210-case AI matrix after the merge with `main`. All 210 cases match the qualified matrix exactly; network, terrain, UI and roster smokes pass in Chromium and WebKit. See [organic network and light](verification/organic-light-2026-09-30/README.md).
- [ ] The other browser smokes (construction, damage, effects, expansion, watch, upgrade, finish, player victory, raster and tint) have not been re-run on the new renderer.
- [ ] Top-row buildings' heads sit under the HUD when the camera rests at the map's top edge, so players cannot click them there. Consider letting the camera pan a little past the top edge.
- [ ] CI for this pull request skips coverage, smoke and end-to-end jobs; they run on `main` only.
- [ ] Map load failure and retry are covered by injected app tests, not by a simulated browser network failure.

## Documentation

- [ ] `docs/neural-defence/` holds about 40 report files, many superseded. Fold the current ones into the README and archive the rest.
- [ ] [HANDOFF.md](HANDOFF.md), [PHASE_0.md](PHASE_0.md) and [FIRST_VERSION.md](FIRST_VERSION.md) still point to the closed PR #409 and the old `codex/neural-defence-*` branches.
