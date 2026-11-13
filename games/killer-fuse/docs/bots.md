# Killer Fuse bots

Bots fill every seat no person holds. They live in `src/engine/bot.ts` and `src/engine/nav.ts` and run inside the engine step, so they play in online games, in rollback and in the headless runner exactly alike. How well they play is measured in [balance.md](balance.md).

## What a bot is

`botInput(state, slot)` returns the same `Input` a person's controller would: left, right, down and the button. A bot has no other way to act. It gets no privileged physics, sees nothing a player could not see on the screen, and obeys every rule.

A bot is a pure function of the round state. Its memory (`BotMind`: goal, target, the reaction timer, the move being flown, this round's plan) is part of the state, so it is hashed, copied by rollback and restored with everything else. Its randomness comes from the round's seeded stream. Two peers therefore compute the same bot inputs, and a test feeds a bot's inputs to a human slot and checks the game plays out identically.

## Levels

Three levels: easy, medium and hard (`BOT_LEVELS`). They differ in how well a bot perceives, reacts and decides, never in what the rules let it do.

| Setting      | Easy | Medium | Hard | Meaning                                                                             |
| ------------ | ---- | ------ | ---- | ----------------------------------------------------------------------------------- |
| `think`      | 38   | 16     | 6    | Steps between decisions: the reaction delay (0.63 s, 0.27 s, 0.1 s)                 |
| `aimError`   | 14   | 6      | 2    | Largest error, in pixels, on the point a flyer aims for                             |
| `flapMin`    | 5    | 4      | 4    | Fewest steps between two flaps                                                      |
| `flapJitter` | 3    | 2      | 0    | Random extra steps on top: flap precision                                           |
| `blunder`    | 14   | 3      | 0    | Chance, in percent per decision, of freezing                                        |
| `idleSteps`  | 45   | 24     | 0    | How long a freeze lasts                                                             |
| `awareness`  | 20   | 30     | 40   | How far, in pixels, a flyer notices a military threat                               |
| `smart`      | 40   | 75     | 96   | Chance, in percent, that a decision is the considered one, not "charge the nearest" |
| `lead`       | 0    | 4      | 8    | Steps of the target's motion a hunter aims ahead by                                 |
| `flee`       | 0    | 28     | 40   | How far, in pixels, a Worker starts running from a military unit; 0 never runs      |
| `soldier`    | 50   | 70     | 80   | Chance, in percent, that a team's first Worker plans to become a Warrior            |
| `rider`      | 40   | 50     | 50   | Chance, in percent, that a team's second Worker plans to ride the snail             |

A bot steers at where its target was when it last decided, so the reaction delay is also how stale its picture of the world is.

## The plan

At the start of a round each Worker bot draws a plan: the first Worker of a team (slots 2 and 3) may be a soldier, the second (slots 4 and 5) may be a rider. A Worker with neither plan gathers berries for the hive.

## Worker decisions

In order, the first that applies:

1. A military enemy within `flee` range: run away from it (considered decisions only, and not while invulnerable).
2. Carrying a berry: a soldier takes it to the quickest warrior gate its team may use; a rider that has no speed yet takes it to a speed gate; anyone else banks it in the nearest empty hole of its own hive.
3. An enemy is riding the snail: the free Worker of the team that can reach the snail's mouth soonest walks into it, which halts the snail for the length of a meal.
4. A rider whose snail is free: go and mount it.
5. Otherwise fetch the berry that is quickest to reach, from a pile or lying loose.
6. No berries left: ride the snail if it is free, else wait at the spawn.

A Worker on its way somewhere hops over the snail, since touching it mounts, and hops off if it mounted by accident.

## Queen and Warrior decisions

A decision that is not "considered" charges the nearest enemy. A considered one goes, in order:

1. A military enemy close by and not clearly below: get out from under it, sideways and up. A Queen looks further and gives way sooner with every egg she has lost.
2. An enemy is riding the snail: hunt the rider.
3. Queen only: claim the nearest gate her team does not own that no enemy military unit guards, unless a Worker to kill is closer. A gate with someone standing in it comes first; speed gates come last.
4. A military enemy that is already below: attack it from above. A Queen with few eggs passes on distant duels.
5. Hunt the enemy Worker that is nearest, preferring one standing in a gate and then one carrying a berry.
6. A Warrior with nothing else to do hunts the enemy Queen.
7. Otherwise hover over the own hive.

A hunter aims at a Worker's middle and at a point 9 px above a military target, since height wins the contact. A Queen bot dives when she is over her target.

## Navigation

Both tables are derived from the map and the tuning with integer arithmetic, once, and cached. They are not round state: every peer derives the same tables.

- **Workers** use a graph of ledge-to-ledge moves. The graph is found, not drawn: from sample points along every platform, each plausible move (walk off, short jump, full jump, with a direction before and after the top of the arc) is flown through the real `moveUnit`. A move is kept only if it lands on the same platform from a pixel either side of its launch point too. Shortest routes are precomputed. A bot walks to a move's launch point, stops, and replays the same controls. There is one graph for plain Workers and one for speed Workers.
- **Flyers** use a grid of 12 px cells with a shortest path between every pair of free cells, and head for the next cell on the way, or straight at the target once it is in the next cell.

Both are mirror-symmetric. The Worker graph keeps a move only together with its mirror image, and the grid search looks at a right-half target's neighbours in mirrored order. Before this the left-to-right search gave the two teams different routes, which showed as a side bias of up to 58.5% on map 2 over 1000 games.

## Tests

`tests/bot-decisions.test.ts` puts a bot in a set situation and checks the decision it makes (as a majority over nine copies of the round with different random streams), and that the levels are ordered. `tests/bot-nav.test.ts` checks the navigation tables are their own mirror image on every map. `tests/bot-soak.test.ts` plays whole games on every map at every level with invariants checked on every step, checks a lone Worker fills its hive, a lone soldier becomes a Warrior, a lone rider rides home and a lone Queen claims every gate, and runs the level ladder.

## Known weaknesses

- Bots do not coordinate beyond the two Worker plans and the one-Worker snail stall. They never escort a rider or a berry carrier, and never guard a gate on purpose.
- Bots never kick a loose berry toward a hive on purpose. Kick-ins happen by accident (0.25 per game at hard).
- A Queen never uses a gate claim to lock out a Worker that is about to enter; she only prefers gates that are in use.
- Easy and medium bots mostly lose to Queen deaths, because they fly into fights they cannot win. Their games are short and nine in ten are military wins; see [balance.md](balance.md).
- Worker bots only make moves that are in the graph, so they do not improvise a jump from where they happen to stand.
