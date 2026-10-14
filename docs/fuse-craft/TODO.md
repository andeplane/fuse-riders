# Fuse Craft TODO

Everything known to need fixing or deciding, in one list. Tick an item when its fix is merged, and add new findings here instead of in a new report file. Link evidence rather than pasting it.

Last reviewed: 2026-09-30 (rules 12), branch `claude/fuse-craft` ([PR #417](https://github.com/andeplane/fuse-riders/pull/417)).

## Needs a decision from Anders

- [ ] Play the current build and say what falls short in look and feel. This is the one open acceptance item in [GOAL_VERIFICATION.md](GOAL_VERIFICATION.md).
- [ ] Decide whether the SVG battlefield with its GPU light layer is enough, or whether the whole battlefield should move to WebGL (true bloom, lit terrain, tilted camera). See [organic network and light](verification/organic-light-2026-09-30/README.md).
- [ ] Brains and towers keep painted bio-mechanical art, rooted into the creep and lit in team colour. Say if you would rather see them redrawn as organic structures.
- [x] The game lives in `games/fuse-craft/` and is served at `/fuse-craft/`; `/neural-defence/` (its working name) redirects there with its query, so old room links still work. The docs, scripts, netcode label and rules string (now `fuse-craft-13-watch-9`) and saved-settings key carry the new name too; settings saved under the old key are still read. Dated records keep the branch names and rules strings they were recorded with.

## Performance

- [ ] WebKit at device pixel ratio 2 still misses 60 FPS in a live battle: median 22 ms, p95 44 ms, none over 50 ms, 46 callbacks per second. It was 52.7 per second before the light layer, and resolution capping did not recover it. Chromium on the GPU holds 60. See [organic network and light](verification/organic-light-2026-09-30/README.md).
- [ ] The placement preview still uses a live SVG filter instead of the tint cache.
- [ ] Measure frame rate on a real phone. Every number so far is a headless callback interval.

## Gameplay and balance

- [x] Territory, dominance victory, creep-like sprouting, unarmed neurons, the Spore splash tower and the Swarm opening (rules 11 and 12). Every opening has a counter in the duel benchmark; see [Strategies](STRATEGIES.md).
- [x] At least eight maps: eleven, including four-seat Cortex Crossing and six-seat Grand Cortex from the symmetric map generator.
- [x] End-of-match report, tutorial and How to Play.
- [ ] No human balance data. All win rates come from deterministic AI against AI.
- [ ] Relay is the best duellist (62%) but the weakest four-player opening (8% of games, fair 25%): its small volleys spread thin against three rivals. Decide whether free-for-all needs its own tuning. See [Strategies](STRATEGIES.md#free-for-all).
- [ ] Siege is the weakest duel opening (38%); every opening has a counter, but Siege's only favourable matchup is an edge over Defensive.
- [ ] Synapse Islands ends mostly by dominance and Twin Pass keeps a few 900-second timeouts; both are map character so far, not bugs.
- [ ] Status-effect particles are still deferred in [EXPANSION_PLAN.md](EXPANSION_PLAN.md); area damage now exists as the Spore tower.
- [ ] The tutorial teaches growth, economy, research, towers and supply against no opponent. A second lesson could cover combat and the match report.

## Powerups

- [ ] The AI claims only about 0.9 powerups per match, since it races for one only when it has no weapon to place. Humans may exploit that; revisit once people play.
- [ ] Browser smokes time out under heavy CPU load (parallel tournaments) and pass on an idle machine; they are not in CI. See the input-lag item under Verification gaps.

## Rendering and visuals

- [x] Neurons at default play zoom read as glowing orbs. Somas are now low domes with thicker branches; see the lighting pass in [organic network and light](verification/organic-light-2026-09-30/README.md).
- [x] Bloom: the light layer blurs its lights at quarter resolution and adds them back. Painted sprites themselves do not bloom; that would need the whole battlefield on the GPU.

- [ ] Cached team tints are not checked against a native-filter reference image, so exact hue match is unproven. See [cached tints](verification/cached-tints-2026-09-27/README.md).

## Platform and multiplayer

- [x] Online multiplayer: Versus rooms with create/join, lobby, room bots, rematch and return to lobby. See [Versus and powerups](verification/versus-powerups-2026-09-30/README.md).
- [x] Up to four players online: four browsers on the local room service play a Cortex Crossing room end to end, and the in-memory mesh tests four- and six-member rooms. See [four players](verification/four-player-2026-09-30/README.md).
- [x] Six browsers play a Grand Cortex room end to end on an idle machine.
- [ ] Online Versus has not been played across real networks or phones.
- [ ] Versus reports no match results or ratings to `fuse-platform` (admission only, like Fuse Choppers).
- [ ] A page refresh during a Versus match rejoins as the same member, but there is no in-room chat, spectating UI or kick button yet.
- [ ] No win verified on a real phone, and touch or trackpad controls have only been exercised in emulation.
- [x] Online rooms are live: `EXTRA_GAME_IDS` names `fuse-craft` since 2026-10-01, and the production gateway creates Fuse Craft rooms. Play across real networks and on phones is still unverified.

## Verification gaps

- [x] Re-run the browser smokes and the 210-case AI matrix after the merge with `main`. All 210 cases match the qualified matrix exactly; network, terrain, UI and roster smokes pass in Chromium and WebKit. See [organic network and light](verification/organic-light-2026-09-30/README.md).
- [x] Browser smokes refreshed for rules 12 on 2026-10-01 (all accept `FUSE_CRAFT_URL`; replay smokes default to the [rules-12 recordings](verification/rules12-replays-2026-10-01/README.md)). Passing in Chromium and WebKit: UI, camera, network, roster, terrain, build queue, finish, watch, expansion, upgrade, construction, damage, effects (destruction, siege, wreck, shielded, site), audio (Chromium only), raster, raster refresh and tint; the benchmark passes with a Pulse tower in its workload.
- [ ] The player-victory smoke has a rules-12 plan that wins every headless replay of it, but has not yet won in a browser: under heavy machine load the page falls behind and the plan loses. Re-run it on an idle machine; delete it if it still fails there.
- [x] Rules 13 (2026-10-01): the replay smokes default to the [rules-13 recordings](verification/rules13-replays-2026-10-01/README.md); construction, damage and effects (destruction, siege, wreck, site, shielded) pass in Chromium and WebKit against them.
- [ ] The effects smoke's `relay` mode has no rules-13 recording yet; record one from a tournament match in which a Relay tower fires (`--replay all`).
- [ ] When the browser cannot simulate in real time, solo commands are stamped at the wall-clock tick (`RoomRuntime.ownTick()`) and take effect only once the lagging simulation catches up, so clicks appear to do nothing for many seconds. Seen in every smoke under heavy load; consider stamping solo commands against the shown world.
- [ ] Headless Chromium on software GL renders about 1.5 frames per second with the WebGL2 light layer (55 without WebGL), which makes Chromium smokes slow under load.
- [ ] Top-row buildings' heads sit under the HUD when the camera rests at the map's top edge, so players cannot click them there. Consider letting the camera pan a little past the top edge.
- [ ] CI for this pull request skips coverage, smoke and end-to-end jobs; they run on `main` only.
- [ ] Map load failure and retry are covered by injected app tests, not by a simulated browser network failure.

## Documentation

- [ ] `docs/fuse-craft/` holds about 40 report files, many superseded. Fold the current ones into the README and archive the rest.
- [ ] [HANDOFF.md](HANDOFF.md), [PHASE_0.md](PHASE_0.md) and [FIRST_VERSION.md](FIRST_VERSION.md) still point to the closed PR #409 and the old `codex/neural-defence-*` branches.
