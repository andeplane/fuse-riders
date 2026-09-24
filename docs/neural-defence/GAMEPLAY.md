# Neural Defence: core gameplay proposal

Status: proposed rules for review; no implementation or balance evidence yet. The [Phase 0 plan](PHASE_0.md) defines the headless engine, playable solo sandbox and combat assay. The latest scope is **builder particles, one attack particle type and one test tower**. There are no defence particles or shielding in Phase 0. [ENGINE_PLAN.md](ENGINE_PLAN.md) describes the engine boundary; multiplayer browser play follows the foundation.

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

| System               | Earned from                              | Used for                                         | Why separate it                                                   |
| -------------------- | ---------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| **Biomass**          | Small brain trickle; Biomass deposits    | Neurons, towers and deliberate repair            | Expansion competes directly with fortification                    |
| **Insight**          | Small brain trickle; Insight deposits    | A short, capped research tree                    | Gives research routes value without another construction currency |
| **Attack particles** | Fixed equal pool assigned at match start | Attacks; reused after recovery | Position and timing matter even against a richer player |

Builder particles are a separate bounded reusable worker stock. They deliver construction capability through the network rather than act as another mined currency or contribute combat damage. Exact capacity and lifecycle values belong in Phase 0; they must not silently change the attack pool.

Deposits are impassable neutral hexes with six usable neighboring hexes. Each connected, owned neighboring tile earns one sixth of that deposit's maximum rate, independently of the other neighbors. Three tiles each means an even split; owning all six gives maximum extraction; an unowned side produces nothing. Several players can mine the same deposit. A disconnected neighbor produces nothing. Use integer accrual with retained remainders so fractional rates never disappear or favor a player ID.

For the first map, deposits do not deplete. Mining requires no stationed worker: connected adjacency earns income automatically. Builders serve construction only. No interest, kill bounty or attack-pool capacity upgrades. Brain trickles permit recovery after a lost deposit but should not support competitive passive turtling. Banks, research levels and the command queue are bounded. These are economy hypotheses to test, not guarantees against snowballing.

## Growing a network

- A neuron grows on a vacant traversable hex beside a brain-connected friendly node. Blocked terrain and deposits cannot be occupied. Growth takes Biomass, delivery of a builder particle and a visible construction delay; unfinished neurons are vulnerable and do not mine or conduct.
- Expansion starts as explicit construction, not automatic spread. Select a vacant neighboring tile to construct a neuron, or queue an explicit route of tiles. One active neuron-construction job per player keeps the cost and direction legible; the queue has a hard length limit.
- Queued destinations are intentions, not owned or reserved land. Check adjacency, connection, affordability and builder availability when each job starts; later route tiles may depend on earlier completed neurons. Insufficient funds or an unavailable builder waits without spending. Illegal or obsolete entries are skipped with a reason. Once ready, accept/pay once and dispatch the builder through friendly links to the adjacent staging node; work starts on arrival. Show queued, travelling and building separately. Defer automatic expansion; any future automation must use the same rules.
- Growth reserves its destination when its job starts. Simultaneous starts claiming the same neutral hex all fail without a net charge; later commands see a reserved construction site. No slot-order winner. Repeated contention is resolved by fighting at the frontier or taking another route, not a hidden priority rule.
- Enemy neurons must be destroyed before their hex becomes buildable; territory is not instantly captured. Destroyed nodes leave vacant terrain. Severed fragments retain their owner and hit points but cannot mine, grow, fire or repair until reconnected. This makes cutting a narrow neck useful without handing an entire network to the attacker.

Define maps by width in columns and height in rows; start with a hand-authored **12 × 12 offset rectangle containing 144 hexes**, including blockers and deposits. Convert this layout deterministically into the engine's canonical axial coordinates. Width and height remain configurable; 12 × 12 is an iteration hypothesis, not a balance commitment. Keep initial terrain sparse enough for alternate routes and legal tower rings. Equal map distances and resource access matter more than visual rectangle symmetry. Two-player tests occupy opposite corners, while three-player matches require separate fairness assessment rather than assuming an unused fourth corner is neutral.

## Solo sandbox and debug

Offer one human player with zero bots on the same map and engine, with no automatic victory, competitive time cap or recorded match result. It is the first way to inspect mining, construction and flow without pressure; it does not establish combat balance.

In this offline solo sandbox, `?debug` enables visibly labelled instant construction work and instant research. Costs, connectivity, placement and research prerequisites still apply; it does not grant free resources. Builder delivery and attack-particle travel still take time. Zero-duration construction completes after its builder arrives, becoming operational next tick. One command cannot recursively construct an entire route in a tick. Record these settings in snapshots and replays; a networked player's URL must never change shared rules unilaterally.

## Electrical combat: force is where the particles are

The core is discrete particle transport through neurons. Phase 0 has builder particles and **one attack particle type**. Builders perform jobs; attack particles deliver damage. The model preserves owner, role, immutable research profile and location/transit state so later types can be added deliberately. Identical particles may be grouped for efficiency, but workers never become combat supply and unlike properties are never averaged into a field.

Selecting a node sets attack-particle demand priority. Builders follow accepted job destinations rather than military demand. Priorities change intended allocation, not particle locations or power. Finite travel time, shared throughput with explicit worker arbitration, congestion, reservations and backpressure determine arrival. Long branches cost supply time; alternative routes can improve resilience. Speed, throughput and storage remain separate properties. Speed upgrades come later; real latency is in the first simulator.

Local attacks commit actual attack particles and their profiles against structural HP. There is no guard absorption, defence-particle pool or composition refit in Phase 0. Defence means positioning, counterfire, supply and preserving structure HP. Damage and destruction resolve simultaneously, allowing mutual kills. [PHASE_0.md](PHASE_0.md) is the source for cadence, targets, coefficients and HP accounting. Combat is part of the foundation rather than deferred after an economy-only prototype.

Spent, orphaned and destroyed-node attack particles enter bounded recovery before returning to their owner's brain. This preserves count without instant frontline reinforcement. Existing stored/travelling particles retain their profile until returned and redispatched under the specified rules. Builder return/cut/cancellation follows its own explicit lifecycle. Eliminated players' stock becomes inert accounting; the killer receives no particles.

The intended tactical rhythm is **concentrate → telegraphed pulse → recovery window → redirect**. Visible buildup and supply delay should permit reinforcement, a cut or a second front. Health repair, shields and defence particles are deferred; do not rely on them to make the first combat assay work.

## One test tower and small research scope

Phase 0 includes **one test tower**, not a tower roster or tower technology tree: one experimental type and one placed lab fixture. The intended build prerequisite is a designated site enclosed by six connected friendly nodes; it cannot be satisfied by missing edge cells or deposits. Losing part of the ring after completion does not delete it; losing its own brain connection disables it. Broader tower construction/content remains for later iteration.

It launches the **same finite attack particles** supplied through neurons, never a new ammunition currency or free damage source. Range two can reach beyond the enclosing ring; deterministic terrain occlusion, launch timing and impact accounting belong in the Phase 0 contract. The lab compares supplied, starved and disconnected states of this one test tower. Those tests establish its connection to the transport system, not an accepted tower balance or full tower economy.

Growth Efficiency tests construction research. A small attack-property research such as Excitation can test profile adoption under the Phase 0 contract; there is no Insulation or guard specialization in this slice. Later branching choices may include conduction or other particle roles only after their costs and counters can be tested. Research should not create particles or improve every property at once.

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

**Next:** broader 2–4 player scenarios, AI policies and tuning, tower construction/content decisions, deeper research and human multiplayer web testing using existing netcode. A future editor uses the same JSON schema and validator. [RTS_PLAYBOOK.md](RTS_PLAYBOOK.md) defines the tradeoffs and evidence needed before claiming balance.

**Deferred:** automatic expansion, fog of war, powerups, active abilities, hero-like units, multiple tower classes, procedural map generation, campaigns, ranked play and particle physics. Public information is the first mode, including the shared TV. Fog later needs an explicit trust model: hiding pixels cannot hide state already held by a peer.

The supplied visual sheets are inspiration, not binding implementation instructions. Prefer the newer reference's illustrated brains, distinct neuron/tower silhouettes and clear network connections, with a lighter terrain treatment following the user's feedback. Medium-value slate and muted blue-grey ground, visible rock faces and softly tinted ownership should make the board readable without bloom. Keep bright owner-colored links, distinct deposit shapes and visible flowing charge. Electrical intensity should show local available charge; an independent marker shows selected priority so a starved Focus node cannot look fully powered. Use geometry/icons as well as color. The reference's three-resource example and upgrade illustrations do not change the proposed economy or research scope. Detailed assets and image generation can wait until the core flow is worth watching.
