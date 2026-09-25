# Neural Defence: core gameplay proposal

Status: Phase 0 rules have a local implementation under review, without completed browser or balance evidence. [PHASE_0.md](PHASE_0.md) records the current rule values and acceptance boundary. The slice has **one separate builder per player, one attack particle type and one constructible test tower type**. There are no defence particles or shielding. Multiplayer browser play follows the headless foundation.

## The central decision

**Grow a living network, then choose where its limited electrical strength should go.** Two to four brains start in separated corner regions of a hex-tiled arena. Neurons claim ground and connect automatically to adjacent friendly neurons. Territory opens income and attack routes, but does not create more electrical particles. A wide empire must spread the same force across longer supply routes and more exposed fronts.

This is a territory RTS with tower-defence pacing: structures fight automatically; players choose expansion, infrastructure, research and concentration. No heroes, unit selection groups, creep waves or last-hitting are needed to test this identity. Simulation time always advances. In competitive matches, destroying a brain eliminates that player; the last surviving brain wins. Simultaneous destruction of all remaining brains is a draw. A separate one-player sandbox has no AI, victory evaluation or career settlement, so the player can freely test concepts without immediately winning. Later local session statistics and graphs may include sandbox play, clearly labelled as such.

## What the inspirations establish

These are design precedents, not evidence that our proposed rules are balanced:

- [Particle Defence](https://andeplane.github.io/particle-defence/) supplies the appealing automatic-battle loop. Its live How to Play overview was inspected: particles traverse a maze, fight on contact, earn kill gold, and affect cell ownership as they move. Its [source README](https://github.com/andeplane/particle-defence#readme) documents research, towers and a headless runner using the browser game's engine. **Our departure:** persistent constructed territory and a conserved reusable pool replace roaming territory claims and endless spawning. Kill income is omitted to avoid directly rewarding victory with still more production.
- Blizzard's [Zerg scouting guide](https://news.blizzard.com/en-us/article/5838589/game-guide-zerg-scouting) describes creep as a source of map vision. The useful inspiration is that spreading living ground has strategic consequences; a detailed reproduction of StarCraft creep is unnecessary.
- Valve's historical [Dota 2 7.00 talent design](https://www.dota2.com/700/gameplay/) presents branching choices that adapt a build to a battle. We borrow the idea of visible specialization and opportunity cost, not that patch's numbers or an entire hero system.
- Riot's [counterplay design discussion](https://www.leagueoflegends.com/en-us/news/dev/quick-gameplay-thoughts-may-14/) distinguishes immediate responses from strategic preparation and argues for readable strengths and weaknesses. Every offensive advantage below therefore has a response available through ordinary commands, not only a special counter ability.
- Ernest Adams's [positive-feedback analysis](https://www.gamedeveloper.com/design/designer-s-notebook-positive-feedback) explains how advantages can compound and how feedback can also end stalemates. Our inference is to reward map control economically while keeping electrical capacity separate from income.

All rules below are original proposals, not conclusions established by these sources.

## Two currencies; one tactical pool

| System               | Earned from                              | Used for                       | Why separate it                                                   |
| -------------------- | ---------------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| **Biomass**          | Small brain trickle; Biomass deposits    | Neurons and the test tower     | Expansion competes directly with fortification                    |
| **Insight**          | Small brain trickle; Insight deposits    | A short, capped research tree  | Gives research routes value without another construction currency |
| **Attack particles** | Fixed equal pool assigned at match start | Attacks; reused after recovery | Position and timing matter even against a richer player           |

Each player has one separate reusable builder. It delivers construction capability through the network and never contributes combat damage or changes the 128-unit attack pool.

Deposits are impassable neutral hexes with six usable neighboring hexes. Each connected, owned neighboring tile earns one sixth of that deposit's maximum rate, independently of the other neighbors. Three tiles each means an even split; owning all six gives maximum extraction; an unowned side produces nothing. Several players can mine the same deposit. A disconnected neighbor produces nothing. Use integer accrual with retained remainders so fractional rates never disappear or favor a player ID.

For the first map, deposits do not deplete. Mining requires no stationed worker: connected adjacency earns income automatically. Builders serve construction only. No interest, kill bounty or attack-pool capacity upgrades. Brain trickles permit recovery after a lost deposit but should not support competitive passive turtling. Banks, research levels and the command queue are bounded. These are economy hypotheses to test, not guarantees against snowballing.

## Growing a network

- A neuron grows on a vacant traversable hex beside a brain-connected friendly node. Blocked terrain and deposits cannot be occupied. Growth takes Biomass, delivery of a builder particle and a visible construction delay; unfinished neurons are vulnerable and do not mine or conduct.
- Expansion starts as explicit construction, not automatic spread. Select a vacant neighboring tile to construct a neuron, or queue an explicit route of tiles. One active neuron-construction job per player keeps the cost and direction legible; the queue has a hard length limit.
- Queued destinations are intentions, not owned or reserved land. Check adjacency, connection, affordability and builder availability when each job starts; later route tiles may depend on earlier completed neurons. Insufficient funds or an unavailable builder waits without spending. Illegal or obsolete entries are skipped with a reason. Once ready, accept/pay once and dispatch the builder through friendly links to the adjacent staging node; work starts on arrival. Show queued, travelling and building separately. Defer automatic expansion; any future automation must use the same rules.
- Paid growth reserves its destination. The current engine resolves simultaneous eligible claims by a deterministic rotating spawn-slot order; the losing claim waits and does not pay. Fairness and order independence require explicit tests.
- Enemy neurons must be destroyed before their hex becomes buildable; territory is not instantly captured. Destroyed nodes leave vacant terrain. Severed fragments retain their owner and hit points but cannot mine, grow, fire or repair until reconnected. This makes cutting a narrow neck useful without handing an entire network to the attacker.

Define maps by width in columns and height in rows; start with a hand-authored **12 × 12 offset rectangle containing 144 hexes**, including blockers and deposits. Convert this layout deterministically into the engine's canonical axial coordinates. Width and height remain configurable; 12 × 12 is an iteration hypothesis, not a balance commitment. Keep initial terrain sparse enough for alternate routes and legal tower rings. Equal map distances and resource access matter more than visual rectangle symmetry. Two-player tests occupy opposite corners, while three-player matches require separate fairness assessment rather than assuming an unused fourth corner is neutral.

## Solo sandbox and debug

Offer one human player with zero bots on the same map and engine, with no automatic victory, competitive time cap or recorded match result. It is the first way to inspect mining, construction and flow without pressure; it does not establish combat balance.

In the offline sandbox, `?debug` shows tile outlines and offers separate instant construction and instant research options, both **off by default**. Costs, connectivity, placement and travel still apply. Zero-duration work completes after builder arrival; construction cannot chain an entire route within one tick. The selected settings enter snapshots and replays; a networked player's URL must never change shared rules unilaterally.

## Electrical combat: force is where the particles are

The core is discrete particle transport through neurons. Phase 0 has one separate builder and **one attack particle type** per player. The builder performs jobs; attack particles deliver damage. Each attack unit keeps owner, location/transit state, attack and speed in authoritative state. Research updates a unit on return to, or new departure from, the brain; it does not rewrite an in-flight unit. Workers never become combat supply.

Selecting a node sets attack-particle demand priority. Builders follow accepted jobs. Priorities change intended allocation, not particle locations or power. Attack particles face finite edge travel and throughput. The builder intentionally uses a separate bandwidth lane so attack traffic cannot starve construction; distance and cuts still delay both. Conduction research reduces new edge travel time; it does not increase throughput or storage.

Local attacks commit actual attack particles and their profiles against structural HP. There is no guard absorption, defence-particle pool or composition refit in Phase 0. Defence means positioning, counterfire, supply and preserving structure HP. Damage and destruction resolve simultaneously, allowing mutual kills. [PHASE_0.md](PHASE_0.md) is the source for cadence, targets, coefficients and HP accounting. Combat is part of the foundation rather than deferred after an economy-only prototype.

Spent, orphaned and destroyed-node attack particles enter bounded recovery before returning to their owner's brain. This preserves count without instant frontline reinforcement. Existing travelling particles retain their profile until return and redispatch. Builder return, cuts and cancellation follow a separate lifecycle. Eliminated players' attack particles are removed from active state; the killer receives none.

The intended tactical rhythm is **concentrate → telegraphed pulse → recovery window → redirect**. Visible buildup and supply delay should permit reinforcement, a cut or a second front. Health repair, shields and defence particles are deferred; do not rely on them to make the first combat assay work.

## One test tower and small research scope

Phase 0 includes **one constructible test tower type** and one placed lab fixture, without a tower roster or tower tree. A tower can be built on an open hex enclosed by six connected friendly nodes; `towerSite` metadata only suggests useful locations to map authors. The lab may initialize its one tower at a cell derived from the authored route. Losing part of the ring does not delete a completed tower, but disables its firing until support returns. Losing its own brain connection also disables firing.

It launches the **same finite attack particles** supplied through neurons, never a new ammunition currency or free damage source. Range two can reach beyond the ring. Current line of sight uses an open intermediate hex within two hops; a geometric occlusion rule remains under review. Supplied, starved and disconnected lab cases need focused tests. Those tests would establish its connection to transport, not accepted tower balance.

The three independent Phase 0 researches are **Growth** (later neuron work time), **Excitation** (later attack profile) and **Conduction** (later builder and attack edge travel). They share one active research slot but have no mutual exclusion. There is no Insulation or guard specialization. Research never creates particles or upgrades every property at once.

## Strategies and available responses

| Approach                  | Advantage                                      | Cost / ordinary counterplay                                                                                |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Wide economic growth      | More deposit edges and build options           | Same charge across more fronts; sever a thin branch or pressure before research pays back                  |
| Focused frontal pulse     | Wins a local charge contest                    | Telegraphs concentration and empties other fronts; defend during buildup and counterattack during recovery |
| Compact tower network     | Short routes and efficient defence             | Construction consumes expansion budget; contest outside deposits and attack from two directions            |
| Parallel resilient routes | Survives a single cut, supplies a front faster | Biomass spent on redundancy rather than towers; force the fight elsewhere                                  |

These broader strategies are future balance hypotheses, not promises established by the one-test-tower assay. Look first at finite attack supply, vulnerable cuts, construction commitments and alternative routes when assessing stalemates. Automated experiments may stop at a declared tick cap and record unresolved draws; an in-game endgame rule needs separate review. Four-player kingmaking and coordinated attacks remain human-playtest risks, not solved by a two-player matrix.

## First demo and balance questions

The Phase 0 loop is: queue a route → builder travels when the job is ready → construct → mine → research → route attack particles. The solo sandbox runs without automatic victory. Its companion assay adds an opposing network and one test tower: concentrate or redirect attacks, observe HP loss, cut/reconnect supply and test brain destruction. Normal/debug settings preserve particle travel. These scenarios establish mechanisms and counterplay hypotheses, not competitive balance.

Initial tuning hypotheses: meaningful first contact within 60–120 seconds, visible response time of at least a few seconds to major concentration changes, and ordinary matches around 8–12 minutes. Values are targets for experiments, not tested findings. Record first-contact time, income share, branch cuts, charge locations/recovery, decisions per minute, damage and repair, elimination time and capped draws. Change one parameter family at a time; retain seed, configuration, engine version, policy version and commands for replay.

Run economy, rush, defensive and adaptive priority policies against one another with swapped start positions and multiple maps/seeds. Report confidence intervals and draw rates; bot win rate measures those policies, not human balance. A useful first result is discovering that one strategy always wins or that no one can break a defence. Human playtesting must then test readability and whether switching priorities feels consequential.

## Scope boundary and visual direction

**First foundation:** follow [PHASE_0.md](PHASE_0.md) for menu, JSON maps, four-owner state, no-AI solo sandbox, economy, builder-delivered construction, research, one attack particle type and one test tower. A scripted opposing-network assay and multi-owner headless tests use the same rules. Delayed supply must affect actual construction and combat outcomes. No defence particle or composition system is required.

**Next:** broader 2–4 player scenarios, AI policies and tuning, more tower content only after the test type is assessed, deeper research and human multiplayer web testing using existing netcode. A future editor uses the same JSON schema and validator. [RTS_PLAYBOOK.md](RTS_PLAYBOOK.md) defines evidence needed before claiming balance.

**Deferred:** automatic expansion, fog of war, powerups, active abilities, hero-like units, multiple tower classes, procedural map generation, campaigns, ranked play and particle physics. Public information is the first mode, including the shared TV. Fog later needs an explicit trust model: hiding pixels cannot hide state already held by a peer.

The supplied visual sheets are inspiration, not binding rule instructions. Prefer illustrated brains, four team-specific neuron designs, distinct tower silhouettes and clear connections on lighter slate terrain. Repeatable ground variants, varied rocks, distinct deposits and a shared selection overlay should remain legible without bloom. Show local supply and priority independently. Sprite integration and visual inspection are still in progress; reference sheets do not add a third resource or other upgrades.
