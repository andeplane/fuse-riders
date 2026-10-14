# Rules-13 command recordings — 2026-10-01

Two ordinary AI-versus-AI matches on Cortex Crossing, recorded on branch `codex/fuse-craft-queue-fullscreen` at sources `bffa9965` (combat) and `07208b16` (shielded), which differ only by documentation and a merge without engine changes (rules 13: cut-off sprouts are refunded and wait, plans on taken hexes are dropped) so the replay-driven browser smokes have recordings the current engine accepts. The [rules-12 recordings](../rules12-replays-2026-10-01/README.md) are rejected by rules 13.

| File                   | Match                                  | Ticks | Final hash | Covers                                                                          |
| ---------------------- | -------------------------------------- | ----: | ---------- | ------------------------------------------------------------------------------- |
| `combat.replay.json`   | Balanced versus Balanced, seat order 0 | 5,220 | `60329321` | Siege construction stages, damage, destruction, Siege fire, wrecks, a lost site |
| `shielded.replay.json` | Defensive versus Defensive, order 0    | 8,820 | `259f7aee` | Bastion shield absorption                                                       |

Both were written by the tournament harness, which replays every logged command from the initial checkpoint and refuses to write a recording whose hash diverges:

```sh
pnpm exec tsx scripts/fuse-craft-tournament.ts --out /tmp/rules13-replays --maps cortex-crossing --strategies balanced,siege --replay all
pnpm exec tsx scripts/fuse-craft-tournament.ts --out /tmp/rules13-defensive --maps cortex-crossing --strategies defensive,siege --replay all
```

`combat.replay.json` is `cortex-crossing-balanced-balanced-0.replay.json` from the first run and `shielded.replay.json` is `cortex-crossing-defensive-defensive-0.replay.json` from the second. With the current AI, Siege versus Siege builds no Siege tower on this map, so the Balanced mirror (which builds one each) carries the Siege coverage.

With the source preview on port 5174 (or `FUSE_CRAFT_URL` pointing at another one):

```sh
pnpm exec tsx scripts/fuse-craft-construction-smoke.ts
pnpm exec tsx scripts/fuse-craft-damage-smoke.ts
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/rules13-replays-2026-10-01/combat.replay.json /tmp/fuse-effects            # destruction
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/rules13-replays-2026-10-01/combat.replay.json /tmp/fuse-siege siege
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/rules13-replays-2026-10-01/combat.replay.json /tmp/fuse-wreck wreck
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/rules13-replays-2026-10-01/combat.replay.json /tmp/fuse-sites site
pnpm exec tsx scripts/fuse-craft-effects-smoke.ts docs/fuse-craft/verification/rules13-replays-2026-10-01/shielded.replay.json /tmp/fuse-shield shielded
```

All passed in Chromium and WebKit on 2026-10-01. The effects smoke's `relay` mode still has no recording.
