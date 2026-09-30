# Fuse Craft strategies

How to win Fuse Craft, what each AI opening does, and which opening beats which. The counters come from a deterministic AI-versus-AI benchmark on every map (method at the end). They describe these policies, not human play.

## What a strategy trades

Everything is a trade between four things:

- **Map.** Neurons sprout like creep: a queued neuron grows by itself beside the connected network. You grow one sprout at a time plus one per 50 territory cells (up to four), so map control snowballs. Territory pays a trickle of biomass and wins outright by **dominance** (40% of a duel map, 35% of a four-way map, and 1.5 times any rival, held for a minute).
- **Economy.** Deposits pay most of your income. At most two of your structures mine a deposit, and a Harvester adds one share, so an economy grows by holding more deposits, not crowding one.
- **Army.** Neurons carry no weapon. Towers are upgrades of neurons raised by your single builder, and they fire the 128 particles you route to them. The builder is the bottleneck: every tower is time not spent on anything else.
- **Tech.** Excitation (+1 damage) and Ballistics (Siege, Heavy particles) make an army hit harder; Conduction and Resonance (Relay, Swift particles) make it move faster; Growth speeds neurons and unlocks the Harvester, Bastion and Spore.

The best RTS designs make these trades circular: a rush punishes greed, greed out-scales a turtle, a turtle holds a rush. Fuse Craft borrows that triangle and adds creep (Zerg), artillery containment (siege tanks), splash against massed units (the tower-defence splash tower), and a territory victory (king of the hill).

## The openings

Each opening is what the AI plays when you pick it as an opponent, and a plan you can follow yourself.

| Opening       | Style    | Plan                                                                                                                                | Duel win rate | Beats                                  | Loses to                               |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------: | -------------------------------------- | -------------------------------------- |
| **Relay**     | Tempo    | Growth, then Resonance and cheap Relay towers: frequent small volleys that slip inside Siege's blind spot and out-pace slow builds. |           62% | Balanced, Economy, Siege, Defensive    | Pressure, Swarm                        |
| **Swarm**     | Creep    | Growth first and neurons everywhere; claim the map and threaten dominance with just enough guns to hold it.                         |           60% | Balanced, Siege, Relay; edges Pressure | Economy (edge)                         |
| **Pressure**  | Rush     | Excitation first and a straight drive at the rival with Pulse towers before a greedy economy pays off.                              |           52% | Siege, Relay                           | Economy, Swarm (edges)                 |
| **Economy**   | Greed    | Deposits and two Harvesters before guns, then out-produce the rival; switches to Spores against creep.                              |           48% | Pressure, Siege, Swarm (edges)         | Relay, Defensive                       |
| **Defensive** | Turtle   | Towers and Bastions (60% shields) around a compact network; wins the fights it is offered.                                          |           46% | Economy                                | Relay; Balanced and Siege (edges)      |
| **Balanced**  | Standard | Steady expansion, one Harvester, Pulse towers with Heavy particles; switches to Spores against creep.                               |           43% | Defensive (edge)                       | Relay, Swarm                           |
| **Siege**     | Contain  | Ballistics after Growth; artillery outranges static defences from behind a wall of neurons.                                         |           38% | Defensive (edge)                       | Pressure, Relay, Swarm; Economy (edge) |

A **counter** wins at least four more of the 18 games between the two openings than it loses (strong); an **edge** wins two or three more. Every opening beats at least one other and is beaten by at least one other, so there is no dominant opening. The loop at the heart of it: **Pressure beats Relay, Relay beats Economy, Economy edges Pressure.** Creep is answered two ways: Economy out-produces Swarm, and the Spore towers that Balanced, Defensive and Economy switch to once a rival is mostly neurons.

### Playing it yourself

- **Against Pressure:** don't be greedy on a close map. Put your first Pulse tower where its network will arrive, and take deposits behind it.
- **Against Relay:** Relays are fragile (90 HP) and fire small volleys; Pressure's Pulse towers and Excitation outtrade them. Don't rely on Siege: Relays live inside its blind spot.
- **Against Economy:** hit before the Harvesters pay off. A Relay or Pressure attack in the first three minutes finds few guns.
- **Against Swarm:** research Growth and build Spore towers at the edge of its creep. Each pod splashes the densest cluster. Or out-grow it: Economy takes the deposits Swarm spreads past.
- **Against Defensive:** don't attack Bastions head-on; take the map instead. Economy out-scales it, and Relay out-paces it.
- **Against Siege:** close the distance. Anything within two steps of a Siege tower is safe from it.

## Counters at a glance

Wins–losses of the row opening against the column opening, over 18 games (nine maps, both seats) with powerups. Draws and timeouts are omitted.

| Row vs column | Balanced | Pressure | Economy | Siege | Relay | Defensive | Swarm |
| ------------- | -------: | -------: | ------: | ----: | ----: | --------: | ----: |
| **Balanced**  |        — |      9–9 |     9–9 |   9–9 |  4–14 |      10–8 |  5–13 |
| **Pressure**  |      9–9 |        — |    8–10 |  11–7 |  11–7 |       9–9 |  8–10 |
| **Economy**   |      9–9 |     10–8 |       — |  10–8 |  6–12 |      7–11 |  10–8 |
| **Siege**     |      9–9 |     7–11 |    8–10 |     — |  3–15 |      10–8 |  4–13 |
| **Relay**     |     14–4 |     7–11 |    12–6 |  15–3 |     — |      13–5 |  6–12 |
| **Defensive** |     8–10 |      9–9 |    11–7 |  8–10 |  5–13 |         — |   9–9 |
| **Swarm**     |     13–5 |     10–8 |    8–10 |  13–4 |  12–6 |       9–9 |     — |

Mirror matches split 64–56 by seat, within chance.

## Maps change the answer

Rushes are strongest where brains are close and routes are short; expansion is strongest where the map is wide and rich.

| Map              | Seats | Median length | Wins by dominance | Timeouts | Best openings (win rate) |
| ---------------- | ----: | ------------: | ----------------: | -------: | ------------------------ |
| Close Quarters   |     2 |         195 s |                 0 |        0 | Pressure 92%, Relay 75%  |
| Synaptic Reach   |     2 |         242 s |                 0 |        0 | Economy 75%, Relay 75%   |
| Open Synapse     |     2 |         228 s |                 0 |        0 | Economy 75%, Siege 67%   |
| Scarce Reach     |     2 |         389 s |                 1 |        0 | Pressure 83%, Relay 75%  |
| Twin Pass        |     2 |         352 s |                 6 |        3 | Economy 92%, Swarm 67%   |
| Twin Hemispheres |     2 |         344 s |                 0 |        0 | Economy 92%, Swarm 83%   |
| Synapse Islands  |     2 |         431 s |                25 |        0 | Pressure 83%, Relay 75%  |
| Cortex Crossing  |     4 |         291 s |                 2 |        0 | Relay 67%, Defensive 67% |
| Grand Cortex     |     6 |         346 s |                 0 |        0 | Relay 75%, Swarm 75%     |

Pressure and Relay rule the close and poor maps, where a greedy start has no time to pay off; Economy rules the wide, deposit-rich hemispheres and passes. Synapse Islands is the dominance map: single-cell synapses make it hard to reach a rival's brain, so 25 of its 56 duels end by holding the map instead. Twin Pass keeps three 900-second timeouts at its two choke points. The Cortex Crossing and Grand Cortex rows are duels on those maps; the four-player results follow.

## Free-for-all

Four AIs on Cortex Crossing, every set of four openings in every seat order both ways round: 280 games.

| Opening   | Games | Wins | Share (fair: 25%) |
| --------- | ----: | ---: | ----------------: |
| Pressure  |   160 |   60 |               38% |
| Balanced  |   160 |   49 |               31% |
| Defensive |   160 |   48 |               30% |
| Economy   |   160 |   41 |               26% |
| Siege     |   160 |   40 |               25% |
| Swarm     |   160 |   27 |               17% |
| Relay     |   160 |   13 |                8% |

143 games end by dominance and 135 by elimination; the median lasts 510 seconds. Wins by seat are 65, 65, 67 and 81: no seat is favoured.

A free-for-all plays differently from a duel. Relay, the best duellist, is the weakest here: its small volleys spread thin against three rivals. Pressure's early towers and Defensive's shields hold up when attacked from two sides, and about half the games are won by whoever holds 35% of the map with a clear lead while the others fight.

## How this was measured

- **Duels:** `pnpm exec tsx scripts/fuse-craft-tournament.ts --maps <map> --seconds 900 --powerups --out <dir>`, one process per map, all seven openings against each other in both seats: 504 matches on source `5924ba29` (rules 12), no simulation changes uncommitted. Results: [duel-matrix.jsonl](verification/strategies-2026-09-30/duel-matrix.jsonl), [manifests](verification/strategies-2026-09-30/duel-manifests.json). Each match id is its case key, so powerup draws vary per case; the tournament replays a sample from its command log to check determinism.
- **Free-for-all:** `pnpm exec tsx scripts/fuse-craft-ffa.ts --map cortex-crossing --players 4 --seconds 900 --jobs 6`: [results](verification/strategies-2026-09-30/ffa4-cortex-crossing.jsonl), [summary](verification/strategies-2026-09-30/ffa4-cortex-crossing-summary.json).
- **Tables** come from these files. Win rates count decisive games; draws and timeouts are listed separately.

These are deterministic AI policies playing each other, not people. They show that every opening has a working answer under these rules, not how humans will play.

## How the balance got here

Rules 11 added territory and dominance, but across 382 matches no one ever dominated: networks peaked near 20% of the map because one builder built everything. Rules 12 let neurons sprout without the builder. Then, over fourteen tuning rounds of 224 to 448 matches each:

- **Neurons stopped firing.** A wide network was also the biggest army, so expansion openings won everything and nothing punished greed. Now creep is territory and towers are the army.
- **The Spore became a real counter.** It fired half as often as a Pulse tower and lost even against dense creep; it now fires as often, splashes half its damage onto every neighbour, and aims at the densest cluster in reach.
- **Greed was capped, not banned.** Surrounding one deposit with six neurons paid six shares; now two structures mine a deposit, and sprouts grow one per 50 cells, up to four, instead of one per 30, up to six.
- **Seats became fair.** Ties broke by raw cell index, which mirrors a duel map but not a four-way one: seat 0 won 44% of four-player games. Ties now follow each seat's own view of the map. Two cells wanted by two seats on the same tick went to a rotating "first" seat, which with four players favours neighbours in the rotation three ties to one, and always met the AI's 20-tick rhythm the same way; each tick now shuffles all seats by a hash of match, tick and slot. An apparent leftover seat bias turned out to be the benchmark rotating seats in one direction only, which paired each seat with the same matchup; it now rotates both ways.
- **Dominance needs a lead.** At 30% a four-way share was almost automatic (136 of 140 four-player games); it now needs 35% and 1.5 times any rival.
- **Openings were retuned** so each has a favourable matchup and a counter: Pressure researches Excitation first, Siege and Relay research Growth first, every opening values fresh territory, Swarm spreads a little less wide, and Siege fires every three seconds.
