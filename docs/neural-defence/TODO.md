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

## Powerups

- [ ] With powerups, six Twin Pass mirror matches stall to the 900 s cap instead of ending in a simultaneous draw (8 Twin Pass timeouts of 42). Non-mirror matchups are unaffected. See [Versus and powerups](verification/versus-powerups-2026-09-30/README.md).
- [ ] The AI claims only about 0.9 powerups per match, since it races for one only when it has no weapon to place. Humans may exploit that; revisit once people play.
- [ ] The roster smoke's on-screen check for raised bodies failed once under heavy CPU load (a tournament running in parallel) and passed on the next run.

## Rendering and visuals

- [x] Neurons at default play zoom read as glowing orbs. Somas are now low domes with thicker branches; see the lighting pass in [organic network and light](verification/organic-light-2026-09-30/README.md).
- [ ] The light layer approximates bloom with wide halos and spills team light onto the ground, but it is not a screen-space bloom pass: that needs the whole battlefield rendered on the GPU.

- [ ] Cached team tints are not checked against a native-filter reference image, so exact hue match is unproven. See [cached tints](verification/cached-tints-2026-09-27/README.md).

## Platform and multiplayer

- [x] Online multiplayer: Versus rooms with create/join, lobby, room bots, rematch and return to lobby. See [Versus and powerups](verification/versus-powerups-2026-09-30/README.md).
- [ ] Online Versus has been exercised on the local room service with two browsers on one machine; it has not been played across real networks or phones.
- [ ] Versus reports no match results or ratings to `fuse-platform` (admission only, like Fuse Choppers).
- [ ] A page refresh during a Versus match rejoins as the same member, but there is no in-room chat, spectating UI or kick button yet.
- [ ] No win verified on a real phone, and touch or trackpad controls have only been exercised in emulation.
- [ ] Not deployed. Cloud Run serves extra games only when `EXTRA_GAME_IDS` names them; add `neural-defence` there to open online rooms.

## Verification gaps

- [x] Re-run the browser smokes and the 210-case AI matrix after the merge with `main`. All 210 cases match the qualified matrix exactly; network, terrain, UI and roster smokes pass in Chromium and WebKit. See [organic network and light](verification/organic-light-2026-09-30/README.md).
- [ ] The other browser smokes (construction, damage, effects, expansion, watch, upgrade, finish, player victory, raster and tint) have not been re-run on the new renderer.
- [ ] Top-row buildings' heads sit under the HUD when the camera rests at the map's top edge, so players cannot click them there. Consider letting the camera pan a little past the top edge.
- [ ] CI for this pull request skips coverage, smoke and end-to-end jobs; they run on `main` only.
- [ ] Map load failure and retry are covered by injected app tests, not by a simulated browser network failure.

## Documentation

- [ ] `docs/neural-defence/` holds about 40 report files, many superseded. Fold the current ones into the README and archive the rest.
- [ ] [HANDOFF.md](HANDOFF.md), [PHASE_0.md](PHASE_0.md) and [FIRST_VERSION.md](FIRST_VERSION.md) still point to the closed PR #409 and the old `codex/neural-defence-*` branches.
