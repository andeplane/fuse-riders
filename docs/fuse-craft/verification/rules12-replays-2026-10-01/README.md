# Rules-12 command recordings — 2026-10-01

Two ordinary AI-versus-AI matches on Cortex Crossing, recorded at source `a58eb325` (rules 12, no uncommitted simulation changes) so the replay-driven browser smokes have a recording the current engine accepts. The rules-9 and older recordings elsewhere in `verification/` are rejected by rules 12 and only reproduce on their own source revisions.

| File                 | Match                             | Ticks | Final hash | Covers                                                                                            |
| -------------------- | --------------------------------- | ----: | ---------- | ------------------------------------------------------------------------------------------------- |
| `combat.replay.json` | Siege versus Siege, seat order 0  | 9,260 | `af274807` | Siege construction stages, a badly damaged building, destruction, Siege fire, wrecks, shield hits |
| `sites.replay.json`  | Balanced versus Balanced, order 0 | 6,800 | `f4315b7b` | Destruction of a paid construction site                                                           |

Both were written by the tournament harness, which replays every logged command from the initial checkpoint and refuses to write a recording whose hash diverges:

```sh
pnpm exec tsx scripts/fuse-craft-tournament.ts --out /tmp/rules12-replays --maps cortex-crossing --strategies balanced,siege --replay all
```

`combat.replay.json` is `cortex-crossing-siege-siege-0.replay.json` and `sites.replay.json` is `cortex-crossing-balanced-balanced-0.replay.json` from that run.

With the source preview on port 5174 (or `FUSE_CRAFT_URL` pointing at another one):

```sh
pnpm exec tsx scripts/fuse-craft-construction-smoke.ts
pnpm exec tsx scripts/fuse-craft-damage-smoke.ts
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/rules12-replays-2026-10-01/combat.replay.json /tmp/fuse-effects            # destruction
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/rules12-replays-2026-10-01/combat.replay.json /tmp/fuse-siege siege
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/rules12-replays-2026-10-01/combat.replay.json /tmp/fuse-wreck wreck
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/rules12-replays-2026-10-01/combat.replay.json /tmp/fuse-shield shielded
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/rules12-replays-2026-10-01/sites.replay.json /tmp/fuse-sites site
```

The effects smoke's `relay` mode has no current recording: in Relay-versus-Relay and Relay-versus-Defensive on Cortex Crossing (same harness and source) the Relay AI never completed a Relay tower, so no recording contains Relay fire.

A change to the rules makes these recordings fail their hash check; record new ones with the command above and update the smokes' default path.
