# Up to four players online, generalised to N — 2026-09-30

Branch `claude/fuse-craft`, rules 12, adapter `neural-defence-12-watch-7`.

## What changed for N players

- `RULES.maxPlayers` is 8. Maps take 1–8 spawns; rooms, checkpoints, palettes (eight team colours and names), sprite tints and the lobby all read it instead of assuming two.
- Versus seats every connected human and bot on the map's spawns in seat order. The lobby now drops bots beyond the chosen map's seats, newest first, and explains when humans alone overfill a table. Before this fix a host could add a bot too many, or switch to a smaller map, and the match silently refused to start.
- Tie-breaks follow each seat's own view of the map, so mirror-image seats on four- and six-seat maps make mirror-image choices. Before, seat 0 won 44% of four-player free-for-alls (fair: 25%).
- Two seats claiming the same cell on the same tick used to meet a rotating "first" seat: with four players, neighbours in the rotation won three ties in four against each other, and the AI's 20-tick rhythm always met the same order. Each tick now shuffles every seat by a hash of match, tick and slot (`claimPrecedence`), tested pairwise fair for up to eight seats.
- Dominance scales with the number of players (40% of a duel map, 35% of a four-way map) and needs 1.5 times any rival.
- An eliminated player's territory is cleared at once; previously a finishing elimination left it behind and made the checkpoint invalid.

## Evidence

- **Four browsers, real room service.** `scripts/fuse-craft-versus-smoke.ts http://localhost:8787 <out> 4 cortex-crossing` (against `pnpm dev`): the host creates a room and picks Cortex Crossing, three friends join by link, every page sees all four seats and the map, only the host can start, all four switch on Auto expand, every view agrees on the networks, and the host returns everyone to the lobby. Passed with no page errors. Captures: [lobby](versus-lobby.png), [host](versus-host.png), [friend](versus-friend.png), [third](versus-third.png), [fourth](versus-fourth.png).
- **Six browsers, real room service.** The same script with `6 grand-cortex`: six players, the six-seat map, synced growth and return to lobby. Passed on an idle machine (an earlier attempt timed out while nine benchmark processes loaded it). Captures: [lobby](six-lobby.png), [host](six-host.png).
- **In-memory mesh.** `tests/online-session.test.ts` runs four members through a full Cortex Crossing match (all four spawns taken, every device sees every player's own commands, settled structures agree), and a six-seat Grand Cortex room with four humans and two bots (a third bot is refused).
- **Engine.** `tests/territory.test.ts` plays a three-player free-for-all through one elimination to the last brain, and seats eight players on one map. `tests/maps.test.ts` checks every map's seats get the same opening and that every seat breaks ties like its mirror image.

**Four-AI free-for-all.** `scripts/fuse-craft-ffa.ts` plays every set of four openings on Cortex Crossing in every seat order, both ways round: 280 games on source `5924ba29` (143 by dominance, 135 by elimination, one draw, one timeout; median 510 s). Wins by seat are 65, 65, 67 and 81 of 278: no seat is favoured. Opening shares and what they mean are in [Strategies](../../STRATEGIES.md#free-for-all); [results](../strategies-2026-09-30/ffa4-cortex-crossing.jsonl).

Not verified: play across real networks, and phones.
