# Killer Fuse bots

Bots fill every seat no person holds. They live in `src/engine/bot.ts` and `src/engine/nav.ts` and run inside the engine step, so they play in online games, in rollback and in the headless runner exactly alike. How well they play is measured in [balance.md](balance.md).

## What a bot is

`botInput(state, slot)` returns the same `Input` a person's controller would: left, right, down, the jump / flap button and the attack button. A bot has no other way to act. It gets no privileged physics, sees nothing a player could not see on the screen, and obeys every rule.

A bot is a pure function of the round state. Its memory (`BotMind`: goal, target, the reaction timer, the move being flown, this round's plan, how far it misjudges its sword's reach) is part of the state, so it is hashed, copied by rollback and restored with everything else. Its randomness comes from the round's seeded stream. Two peers therefore compute the same bot inputs, and a test feeds a bot's inputs to a human slot and checks the game plays out identically.

In a tutorial room (`passive`) every bot holds no controls at all and draws nothing from the random stream: Queens, Workers and the learner's own teammates stand where they are.

## Levels

Three levels: easy, medium and hard (`BOT_LEVELS`). They differ in how well a bot perceives, reacts and decides, never in what the rules let it do.

| Setting      | Easy | Medium | Hard | Meaning                                                                                                    |
| ------------ | ---- | ------ | ---- | ---------------------------------------------------------------------------------------------------------- |
| `think`      | 38   | 16     | 6    | Steps between decisions: the reaction delay (0.63 s, 0.27 s, 0.1 s)                                        |
| `aimError`   | 14   | 6      | 2    | Largest error, in pixels, on the point a flyer aims for                                                    |
| `flapMin`    | 15   | 12     | 10   | Fewest steps between two flaps: 4, 5 and 6 presses a second, none faster than a person comfortably presses |
| `flapJitter` | 5    | 3      | 0    | Random extra steps on top: flap precision                                                                  |
| `blunder`    | 14   | 3      | 0    | Chance, in percent per decision, of freezing                                                               |
| `idleSteps`  | 45   | 24     | 0    | How long a freeze lasts                                                                                    |
| `awareness`  | 20   | 36     | 50   | How far, in pixels, a flyer notices a threat                                                               |
| `smart`      | 65   | 75     | 96   | Chance, in percent, that a decision is the considered one, not a lapse                                     |
| `lead`       | 0    | 4      | 8    | Steps of the target's motion a hunter aims ahead by                                                        |
| `flee`       | 0    | 70     | 70   | How far, in pixels, a Worker starts running from a military unit; 0 never runs                             |
| `soldier`    | 50   | 50     | 60   | Chance, in percent, that a team's first Worker plans to become a Warrior                                   |
| `rider`      | 40   | 35     | 15   | Chance, in percent, that a team's second Worker plans to ride the snail                                    |
| `swing`      | 8    | 30     | 100  | Chance, in percent per step, that a flyer takes an opening to attack or dive that it sees                  |
| `parry`      | 0    | 10     | 90   | Chance, in percent per step, that a flyer meets a sword coming at it with its own                          |
| `contest`    | 0    | 300    | 200  | How far along toward the enemy's goal, in thousandths of the way, a free snail is ridden back; 0 never     |
| `duel`       | no   | yes    | yes  | Whether a Queen with every egg goes for an enemy Queen that cannot answer                                  |
| `carriers`   | 99   | 4      | 4    | Filled holes in the enemy hive from which flyers hunt berry carriers before anyone else; 99 never          |
| `press`      | 99   | 8      | 8    | Filled holes in the enemy hive from which a Queen with a life to spare drops her caution; 99 never         |
| `muster`     | 99   | 99     | 10   | Filled holes in the enemy hive from which a team without a Warrior turns its next berry into one; 99 never |

A bot steers at where its target was when it last decided, so the reaction delay is also how stale its picture of the world is. Each bot also draws, once per round, how far it overestimates its sword's reach (half a unit to two units), so bots of one level do not all swing from the same distance.

## The plan

At the start of a round each Worker bot draws a plan: the first Worker of a team (slots 2 and 3) may be a soldier, the second (slots 4 and 5) may be a rider. A Worker with neither plan gathers berries for the hive.

## Worker decisions

In order, the first that applies:

1. A military enemy within `flee` range: run away from it, jumping when it is close (considered decisions only, and not while invulnerable).
2. Carrying a berry: a soldier, or anyone on a team with no Warrior once the enemy hive has `muster` holes filled, takes it to the quickest warrior gate its team may use and stands still in it until the gate lets it out; a rider that has no speed yet does the same at a speed gate; anyone else banks it in the empty hole of its own hive that is quickest to touch.
3. An enemy is riding the snail: the free Worker of the team that can reach the snail's mouth soonest walks into it, which halts the snail for the length of a meal.
4. The snail stands free at least `contest` of the way toward the enemy's goal: the free Worker that reaches it soonest mounts it and rides it back.
5. A rider whose snail is free: go and mount it.
6. Otherwise fetch the berry that is quickest to reach, from a pile or lying loose.
7. No berries left: ride the snail if it is free, else wait at the spawn.

Distances are the real ones: a Worker counts the walk to each launch point and from each landing, goes the long way round a floor that spans the screen when a block stands in the short way, and treats a platform a block cuts in two as two places.

A Worker on its way somewhere hops over the snail, since standing on it mounts, hops off if it mounted by accident, and hops over an enemy in its path rather than bump into it.

## Queen and Warrior decisions

A decision that is not "considered" is a lapse. A Warrior in a lapse charges the nearest enemy, whatever it is. A Queen in a lapse drifts back over her own hive: she has the game to lose. A considered decision goes, in order:

1. An enemy is riding the snail: hunt the rider. A Queen on her last life does not.
2. A ready enemy sword too close: get away from it, sideways and up. "Ready" is a fighter whose attack is off cooldown or already lethal. A flyer whose own sword is ready stands its ground; one whose sword is cooling down gives way inside `awareness` range. A Queen always keeps 8 u from a ready sword, which also keeps her out of the line of a dash and out from under a diving Queen, and looks further with every egg she has lost. The Queen she is duelling (below) does not count.
3. Warriors whose Queen is on her last life stay with her and meet whoever comes within 90 px of her.
4. Queen only: claim the nearest gate her team does not own that no enemy fighter guards, unless a Worker to kill is closer. A gate with someone standing in it comes first; speed gates come last.
5. Hunt, in this order, leaving a target a bot teammate already hunts to it:
   - the nearest berry carrier, once the enemy hive has `carriers` holes filled;
   - the enemy Queen;
   - the nearest Warrior;
   - the nearest Worker, preferring one standing in a gate, then one carrying a berry.
6. Otherwise hover over the own hive.

A Queen is choosier about the enemy Queen than a Warrior is. With every egg left she goes for her when the other cannot answer (a duel, levels with `duel`): the other's sword is cooling down, she stands on a floor, where a dive from above meets no sword, or she faces away. Otherwise only from within 40 px. Once she has lost an egg she leaves the other Queen to her Warriors, and on her last life she leaves Warriors and carriers alone too. The exception is a hive about to be lost: from `press` filled holes a Queen with more than one egg plays as if she had lost none, and takes the duel against a ready sword as well.

A Warrior that is over or under its target aims for a point 2 u beside it, since a sword only reaches sideways; a Queen comes in above a fighter or a rider to dive.

So a bot Queen does not follow the plain target order: she evades and claims gates first.

### Striking

Decisions pick where to fly; the attack itself is decided on every step, from what the bot sees then (`opening`):

- **Swing.** An enemy level with the bot (within 1 u of height), within 3 u plus the bot's misjudgement, and the bot already moving at it: press attack toward it, with chance `swing`.
- **Parry.** An enemy fighter whose sword is already coming this way, or one that is ready within about 2 u: strike back so the swords glance, with chance `parry`.
- **Dive.** A Queen in the air with an enemy less than 1 u to the side and 1 to 3 u below (4 u for the enemy Queen): dive, with chance `swing`. A Queen hunting a Warrior comes in 2.5 u above it for this. She also dives simply to get down when her next point is well below her.

Once it has decided to strike, a bot goes on wanting to for 10 steps, so a press that lands during the cooldown still comes out.

## Navigation

Both tables are derived from the map and the tuning with integer arithmetic, once, and cached. They are not round state: every peer derives the same tables.

- **Workers** use a graph of ledge-to-ledge moves. The graph is found, not drawn: from sample points along every platform, each plausible move (walk off, short jump, full jump, with a direction before and after the top of the arc) is flown through the real `moveUnit`. A move is kept only if it lands on the same platform from a pixel either side of its launch point too. Routes are precomputed per move: for every move and platform, the steps from that move's landing point to the platform, with every walk between a landing and the next launch counted at its real length. A bot takes the move that makes the whole way shortest from where it stands, so two moves can never send it back and forth. A bot walks to a move's launch point, stops, and replays the same controls. There is one graph for plain Workers and one for speed Workers. Hive holes and piles that take a jump to touch are reached by the same kind of recorded move.
- **Flyers** use a grid of cells with a shortest path between every pair of free cells, and head for the next cell on the way, or straight at the target once it is in the next cell. A point inside a platform or in a gap too low to fly in stands for the nearest free cell in plain sight of it, not one on the far side of a platform. A flyer standing right over its next point walks off the nearer end of its platform. A flyer flaps when coasting would leave it below where it wants to be, and lets itself fall only as fast as it can still brake.

Both are mirror-symmetric: the Worker graph keeps a move only together with its mirror image, and the grid search looks at a right-half target's neighbours in mirrored order, so neither team gets better routes.

## Tests

`tests/bot-decisions.test.ts` puts a bot in a set situation and checks the decision it makes, and that the levels are ordered. `tests/bot-nav.test.ts` checks the navigation tables are their own mirror image on every map, that the route table agrees with itself (every move leaves less of the way than the one before it), the walks round blocks, and that a flyer in a gap is sent to a cell it can see. `tests/bot-soak.test.ts` plays whole games on every map at every level with invariants checked on every step, checks a lone Worker fills its hive, a lone soldier becomes a Warrior, a lone rider rides home and a lone Queen claims gates, runs the level ladder (the stronger level wins at least 28 of 40) and requires hard bots to beat a Queen whose player holds nothing in at least 27 of 30 games, at least 21 of them by military. `tests/engine-lessons.test.ts` checks that passive bots do nothing and that a learner alone finishes every lesson's objective on every map.

## Known weaknesses

- Bots do not coordinate beyond the two Worker plans, the one-Worker snail stall and ride-back, the mustered Warrior, not doubling up on a target, and Warriors guarding a last-egg Queen. They never escort a rider or a berry carrier, and never guard a gate on purpose.
- Bots never kick a loose berry toward a hive on purpose. Kick-ins happen by accident.
- A Queen never uses a gate claim to cancel a Worker's offer on purpose; she only prefers gates that are in use.
- Hard bots still bank too steadily on maps 2 and 3 for the military share the targets ask for; see [balance.md](balance.md).
- No bot flaps during a Warrior's dash to bend it, and none uses a head bounce on purpose.
- Worker bots only make moves that are in the graph, so they do not improvise a jump from where they happen to stand.
- The levels were tuned on bot-against-bot games only; see [balance.md](balance.md) for how far apart they are.
