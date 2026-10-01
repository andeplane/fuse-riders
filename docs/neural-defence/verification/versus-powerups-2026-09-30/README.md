# Online Versus and powerups — 2026-09-30

Branch `claude/fuse-craft`, rules 10, adapter `neural-defence-10-watch-5`.

## Online Versus

The menu offers **Single player** (Player vs AI, Watch, sandbox, lab) and
**Multiplayer**. A room is created through the shared room service and
joined by code, link or QR code; the lobby shows the players and the host's
rules (map, bot opening, powerups). The host adds or removes room bots and
starts once two players up to the map's capacity are ready. Settings name a
bundled map (`mapId`) because a whole map does not fit one settings packet.
Every seat, human or bot, owns a network; bots play through the
single-player AI.

Evidence:

- `scripts/fuse-craft-versus-smoke.ts` against the local service (`pnpm dev`,
  port 8787): two Chromium browsers create and join a room, the host starts,
  both enable auto-expand, the two views agree on the networks, and the
  host returns everyone to the lobby. Passed with no page errors.
  [Lobby](versus-lobby.png), [host](versus-host.png) and
  [joiner](versus-friend.png) captures.
- `tests/online-session.test.ts` runs two members of the real online session
  on an in-memory mesh: seating, rule changes, room bots, the match, a
  joiner's command reaching both devices, host-only return to the lobby.
- `tests/versus.test.ts` covers settings size and validation, seating on
  spawns, lone players and full maps staying in the lobby, bots playing and
  checkpoints. `tests/multiplayer.test.ts` covers the menu, create/join,
  lobby controls for the host and others, and moving between lobby and
  battlefield.

Not verified: play across real networks, on phones, or through Cloud Run
(which serves the game only once `EXTRA_GAME_IDS` names `neural-defence`).

## Powerups

On by default for Player vs AI, Watch and Versus. The first spawns one
minute in, then every 40 s while fewer than two are out, on open ground at
least three steps from every brain and with the brains' distances within one
step of each other; each fades after 45 s. Spawns hash the match id with a
spawn counter, so there is no generator state and replays and peers agree.
The first network to touch one claims it; two touching networks keep it
contested. Nutrient cache (+150 biomass, +50 insight), Regrowth (heals every
structure except the brain by 40%), Growth surge (double build speed, 30 s),
Synaptic frenzy (double fire rate, 20 s). [A live spawn](powerup-watch.png)
between the networks at 1:01.

`tests/powerups.test.ts` covers spawning, fairness, determinism, checkpoint
validation, claiming and contesting, each effect, expiry and the AI race.

## AI against AI

`pnpm exec tsx scripts/fuse-craft-tournament.ts --maps all --seconds 900
--powerups` (each case's match id is its key, so powerup draws vary per case).

**Without powerups**, rules 10 reproduces all 210 cases of the qualified
matrix in [durable reconnect](../durable-reconnect-2026-09-27/README.md) by
result and duration, with zero rejected commands
([results](matrix-rules10-without-powerups.jsonl)).

**With powerups**, source `8e6d0d24` ([results](matrix-powerups.jsonl),
[manifest](matrix-powerups-manifest.json)), compared with the same cases
without them:

|                          | With powerups | Without |
| ------------------------ | ------------- | ------- |
| Decisive                 | 183           | 148     |
| Mutual-destruction draws | 18            | 60      |
| Timeouts (900 s)         | 9             | 2       |
| Median length            | 464 s         | 471 s   |

- Every opening wins between 26 and 35 of its 70 cases (Pressure 26,
  Balanced 29, Siege 30, Relay 31, Defensive 32, Economy 35).
- Mirror matches split 18–19 by spawn slot: no seat bias.
- Non-mirror cases barely change (146 decisive, 3 timeouts, 1 draw versus
  148 and 2). Powerups mostly break the perfectly symmetric mirrors that used
  to end with both brains dying on the same tick.
- Twin Pass keeps 8 timeouts; six are mirrors that used to end in that
  simultaneous draw and now stall at its choke points instead.
- The AI claims about 0.9 powerups per match.

Tuning on the way: the first powerup run had 14 timeouts, 11 on Twin Pass,
with about 4.3 claims per match. Regrowth no longer heals brains, and the AI
now races for a powerup only when it has no weapon to place; those two
changes brought Twin Pass from 11 to 8 timeouts. Lowering Regrowth to 20%
left Twin Pass unchanged at 8, so it stays at 40%.

These are deterministic policy comparisons, not human win rates.
