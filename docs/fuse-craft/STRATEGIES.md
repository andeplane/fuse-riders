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

| Opening       | Style    | Plan                                                                                                          | Duel win rate | Beats                                     | Loses to                                        |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------- | ------------: | ----------------------------------------- | ----------------------------------------------- |
| **Relay**     | Tempo    | Growth, then Resonance and cheap Relay towers: frequent small volleys that slip inside Siege's blind spot.    |           61% | Balanced, Siege; edges Economy, Defensive | Swarm (edge)                                    |
| **Swarm**     | Creep    | Growth first and neurons everywhere; claim the map and threaten dominance with just enough guns to hold it.   |           56% | Balanced, Siege; edges Relay              | Defensive; Pressure (edge)                      |
| **Defensive** | Turtle   | Towers and Bastions (60% shields) around a compact network; wins the fights it is offered.                    |           52% | Swarm; edges Balanced, Pressure           | Siege, Relay (edges)                            |
| **Pressure**  | Rush     | Excitation first and a straight drive at the rival with Pulse towers before a greedy economy pays off.        |           51% | Balanced; edges Swarm                     | Economy, Siege, Defensive (edges)               |
| **Economy**   | Greed    | Deposits and two Harvesters before guns, then out-produce the rival; switches to Spores against creep.        |           49% | Pressure, Siege (edges)                   | Balanced; Relay (edge)                          |
| **Siege**     | Contain  | Growth, then Ballistics at once; artillery outranges Pulse towers and Bastions from behind a wall of neurons. |           43% | Balanced; edges Pressure, Defensive       | Relay, Swarm; Economy (edge)                    |
| **Balanced**  | Standard | Steady expansion, one Harvester, Pulse towers with Heavy particles; switches to Spores against creep.         |           39% | Economy                                   | Pressure, Siege, Relay, Swarm; Defensive (edge) |

A **counter** wins at least four more of the 18 games between the two openings than it loses (strong); an **edge** wins two or three more. Every opening beats at least one other and is beaten by at least one other, so there is no dominant opening. The game has several rock-paper-scissors loops:

- **Swarm beats Siege, Siege edges Defensive, Defensive beats Swarm.** Creep out-grows slow artillery, artillery outranges Bastions, and Bastions hold creep.
- **Balanced beats Economy, Economy edges Pressure, Pressure beats Balanced.** A steady army punishes greed, greed out-produces a rush, and a rush catches a standard build before it is ready.
- **Relay beats Siege, Siege edges Pressure, and Pressure edges Swarm, which edges Relay.** Fast volleys live inside artillery's blind spot; artillery outranges the Pulse towers a rush relies on.

Balanced is the weakest duellist and the strongest free-for-all opening; Relay is the reverse (see [Free-for-all](#free-for-all)).

### Playing it yourself

- **Against Pressure:** don't be greedy on a close map. Put your first Pulse tower where its network will arrive, and take deposits behind it; Siege outranges its towers and Bastions absorb its volleys.
- **Against Relay:** Relays are fragile (90 HP) and fire small volleys. Spread creep wide and fast like Swarm, or hold it with Bastions. Don't rely on Siege: Relays live inside its blind spot.
- **Against Economy:** hit before the Harvesters pay off. A steady Pulse-tower army or a Relay attack in the first three minutes finds few guns.
- **Against Swarm:** build Bastions and towers at the edge of its creep and hold them; Spore towers splash the densest clusters. A rush also catches it thin.
- **Against Defensive:** don't attack Bastions head-on with towers; bring Siege, which outranges them, or out-pace it with Relays.
- **Against Siege:** close the distance. Anything within two steps of a Siege tower is safe from it; Relays and fast creep get there first.
- **Against Balanced:** almost anything specialised wins a duel against it; in a free-for-all it is the opening to beat.

## Counters at a glance

Wins–losses of the row opening against the column opening, over 18 games (nine maps, both seats) with powerups. Draws and timeouts are omitted.

| Row vs column | Balanced | Pressure | Economy | Siege | Relay | Defensive | Swarm |
| ------------- | -------: | -------: | ------: | ----: | ----: | --------: | ----: |
| **Balanced**  |        — |     5–13 |    11–7 |  7–11 |  5–13 |      8–10 |  5–11 |
| **Pressure**  |     13–5 |        — |    8–10 |  7–10 |   8–9 |      8–10 |  10–8 |
| **Economy**   |     7–11 |     10–8 |       — |  10–8 |  8–10 |       9–9 |   9–9 |
| **Siege**     |     11–7 |     10–7 |    8–10 |     — |  3–15 |      10–8 |  4–14 |
| **Relay**     |     13–5 |      9–8 |    10–8 |  15–3 |     — |      10–8 |  8–10 |
| **Defensive** |     10–8 |     10–8 |     9–9 |  8–10 |  8–10 |         — |  11–7 |
| **Swarm**     |     11–5 |     8–10 |     9–9 |  14–4 |  10–8 |      7–11 |     — |

Mirror matches split 61–58 by seat, within chance.

## Maps change the answer

Rushes are strongest where brains are close and routes are short; expansion is strongest where the map is wide and rich.

| Map              | Seats | Median length | Wins by dominance | Timeouts | Best openings (win rate)   |
| ---------------- | ----: | ------------: | ----------------: | -------: | -------------------------- |
| Close Quarters   |     2 |         202 s |                 0 |        1 | Pressure 83%, Relay 75%    |
| Synaptic Reach   |     2 |         252 s |                 0 |        0 | Economy 100%, Relay 75%    |
| Open Synapse     |     2 |         233 s |                 0 |        0 | Defensive 75%, Economy 67% |
| Scarce Reach     |     2 |         388 s |                 0 |        0 | Relay 75%, Pressure 67%    |
| Twin Pass        |     2 |         363 s |                 7 |        5 | Economy 83%, Relay 50%     |
| Twin Hemispheres |     2 |         344 s |                 1 |        0 | Economy 83%, Balanced 75%  |
| Synapse Islands  |     2 |         425 s |                19 |        0 | Pressure 75%, Relay 75%    |
| Cortex Crossing  |     4 |         287 s |                 3 |        0 | Siege 75%, Defensive 67%   |
| Grand Cortex     |     6 |         345 s |                 0 |        0 | Swarm 75%, Defensive 67%   |

Pressure and Relay rule the close and poor maps, where a greedy start has no time to pay off; Economy rules the wide, deposit-rich hemispheres and passes. Synapse Islands is the dominance map: single-cell synapses make it hard to reach a rival's brain, so 19 of its 56 duels end by holding the map instead. Twin Pass keeps five 900-second timeouts at its two choke points. The Cortex Crossing and Grand Cortex rows are duels on those maps; the four-player results follow.

## Free-for-all

Four AIs on Cortex Crossing: every set of four openings in each of its twelve even seat orders, 420 games. That design puts every ordered pair of openings in every ordered pair of seats exactly once per set, whatever the map's geometry.

| Opening   | Games | Wins | Share (fair: 25%) |
| --------- | ----: | ---: | ----------------: |
| Balanced  |   240 |  104 |               43% |
| Defensive |   240 |   88 |               37% |
| Economy   |   240 |   64 |               27% |
| Swarm     |   240 |   57 |               24% |
| Siege     |   240 |   54 |               23% |
| Pressure  |   240 |   45 |               19% |
| Relay     |   240 |    7 |                3% |

236 games end by dominance, 183 by elimination and one times out; the median lasts 506 seconds. Wins by seat are 104, 98, 114 and 103: no seat is favoured.

A free-for-all plays differently from a duel. More than half the games are won by whoever holds 35% of the map with a clear lead while the others fight, so steady, all-round openings outlast specialists: Balanced, the weakest duellist, wins most, and Defensive's shields hold up when attacked from two sides. Relay, the best duellist, almost never wins: its small volleys and fragile towers spread thin against three rivals.

## How this was measured

- **Duels:** `pnpm exec tsx scripts/fuse-craft-tournament.ts --maps <map> --seconds 900 --powerups --out <dir>`, one process per map, all seven openings against each other in both seats: 504 matches on source `f504deef` (rules 12), no simulation changes uncommitted. Results: [duel-matrix.jsonl](verification/strategies-2026-10-01/duel-matrix.jsonl), [manifests](verification/strategies-2026-10-01/duel-manifests.json). Each match id is its case key, so powerup draws vary per case; the tournament replays a sample from its command log to check determinism.
- **Free-for-all:** `pnpm exec tsx scripts/fuse-craft-ffa.ts --map cortex-crossing --players 4 --seconds 900 --jobs 5` on the same simulation source: [results](verification/strategies-2026-10-01/ffa4-cortex-crossing.jsonl), [summary](verification/strategies-2026-10-01/ffa4-cortex-crossing-summary.json).
- **Tables** come from these files. Win rates count decisive games; draws and timeouts are listed separately.

These are deterministic AI policies playing each other, not people. They show that every opening has a working answer under these rules, not how humans will play.

## How the balance got here

Rules 11 added territory and dominance, but across 382 matches no one ever dominated: networks peaked near 20% of the map because one builder built everything. Rules 12 let neurons sprout without the builder. Then, over fourteen tuning rounds of 224 to 448 matches each:

- **Neurons stopped firing.** A wide network was also the biggest army, so expansion openings won everything and nothing punished greed. Now creep is territory and towers are the army.
- **The Spore became a real counter.** It fired half as often as a Pulse tower and lost even against dense creep; it now fires as often, splashes half its damage onto every neighbour, and aims at the densest cluster in reach.
- **Greed was capped, not banned.** Surrounding one deposit with six neurons paid six shares; now two structures mine a deposit, and sprouts grow one per 50 cells, up to four, instead of one per 30, up to six.
- **Seats became fair.** Ties broke by raw cell index, which mirrors a duel map but not a four-way one: seat 0 won 44% of four-player games. Ties now follow each seat's own view of the map. Two cells wanted by two seats on the same tick went to a rotating "first" seat, which with four players favours neighbours in the rotation three ties to one, and always met the AI's 20-tick rhythm the same way; each tick now shuffles all seats by a hash of match, tick and slot. An apparent leftover seat bias turned out to be the benchmark rotating seats in one direction only, which paired each seat with the same matchup; it now rotates both ways.
- **Dominance needs a lead.** At 30% a four-way share was almost automatic (136 of 140 four-player games); it now needs 35% and 1.5 times any rival.
- **The free-for-all benchmark became balanced.** Rotating one seat order and its reverse kept the same openings opposite each other in every game of a set. It now plays the even seat orders, which put every pair of openings in every pair of seats equally often.
- **Siege got its timing back.** After the AI stopped wasting builder time on sprouts a rival had already paid for, Siege beat no one; researching Ballistics straight after Growth restored its wins over Balanced, Pressure and Defensive.
- **Openings were retuned** so each has a favourable matchup and a counter: Pressure researches Excitation first, Siege and Relay research Growth first, every opening values fresh territory, Swarm spreads a little less wide, and Siege fires every three seconds.
