# Neural Defence: core gameplay proposal

Status: proposed rules for review; no implementation or balance evidence yet. The first deliverable is the headless engine described in [ENGINE_PLAN.md](ENGINE_PLAN.md). Presentation and online integration follow once its decisions produce interesting matches.

## The central decision

**Grow a living network, then choose where its limited electrical strength should go.** Two to four brains start in separated corner regions of a hex-tiled arena. Neurons claim ground and connect automatically to adjacent friendly neurons. Territory opens income and attack routes, but does not create more electrical particles. A wide empire must spread the same force across longer supply routes and more exposed fronts.

This is a territory RTS with tower-defence pacing: structures fight automatically; players choose expansion, infrastructure, research and concentration. No heroes, unit selection groups, creep waves or last-hitting are needed to test this identity. Simulation time always advances. In competitive matches, destroying a brain eliminates that player; the last surviving brain wins. Simultaneous destruction of all remaining brains is a draw. A separate one-player sandbox has no AI, victory evaluation or match statistics, so the player can freely test concepts without immediately winning.

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
| **Charge particles** | Fixed equal pool assigned at match start | Local shields and attacks; reused after recovery | Position and timing matter even against a richer player           |

Deposits are impassable neutral hexes with six usable neighboring hexes. Each connected, owned neighboring tile earns one sixth of that deposit's maximum rate, independently of the other neighbors. Three tiles each means an even split; owning all six gives maximum extraction; an unowned side produces nothing. Several players can mine the same deposit. A disconnected neighbor produces nothing. Use integer accrual with retained remainders so fractional rates never disappear or favor a player ID.

For the first map, deposits do not deplete; no worker units, interest, kill bounty or particle-capacity upgrades. Brain trickles permit recovery after a lost deposit but should not support competitive passive turtling. Banks, research levels and the command queue are bounded. These are economy hypotheses to test, not guarantees against snowballing.

## Growing a network

- A neuron grows on a vacant traversable hex beside a brain-connected friendly node. Blocked terrain and deposits cannot be occupied. Growth takes Biomass and a visible construction delay; unfinished neurons are vulnerable and do not mine or conduct.
- Expansion starts as explicit construction, not automatic spread. Select a vacant neighboring tile to construct a neuron, or queue an explicit route of tiles. One active neuron-construction job per player keeps the cost and direction legible; the queue has a hard length limit.
- Queued destinations are intentions, not owned or reserved land. Check adjacency, connection and affordability when each job starts; later route tiles may depend on earlier completed neurons. Insufficient funds waits without spending; illegal or obsolete entries are skipped with a reason. Display the planned route, next cost and progress, and allow cancellation. Defer automatic expansion until testing shows that choosing routes is tedious rather than strategic; any future automation must use these same construction rules.
- Growth reserves its destination when its job starts. Simultaneous starts claiming the same neutral hex all fail without a net charge; later commands see a reserved construction site. No slot-order winner. Repeated contention is resolved by fighting at the frontier or taking another route, not a hidden priority rule.
- Enemy neurons must be destroyed before their hex becomes buildable; territory is not instantly captured. Destroyed nodes leave vacant terrain. Severed fragments retain their owner and hit points but cannot mine, grow, fire or repair until reconnected. This makes cutting a narrow neck useful without handing an entire network to the attacker.

Define maps by width in columns and height in rows; start with a hand-authored **12 × 12 offset rectangle containing 144 hexes**, including blockers and deposits. Convert this layout deterministically into the engine's canonical axial coordinates. Width and height remain configurable; 12 × 12 is an iteration hypothesis, not a balance commitment. Keep initial terrain sparse enough for alternate routes and legal tower rings. Equal map distances and resource access matter more than visual rectangle symmetry. Two-player tests occupy opposite corners, while three-player matches require separate fairness assessment rather than assuming an unused fourth corner is neutral.

## Solo sandbox and debug

Offer one human player with zero bots on the same map and engine, with no automatic victory, competitive time cap or recorded match result. It is the first way to inspect mining, construction and flow without pressure; it does not establish combat balance.

In this offline solo sandbox, `?debug` enables visibly labelled instant construction and instant research. Costs, connectivity, placement and research prerequisites still apply; it does not silently grant free resources. Instant means completion in the engine's construction/research phase, becoming operational on the next tick. One command cannot recursively construct an entire route in a single tick. Record these settings in snapshots and replays, and offer the same configuration to headless tests. A networked player's URL must never change shared rules unilaterally.

## Electrical combat: force is where the particles are

The first model is discrete network flow, not a physical electromagnetic-field solver. Every active player's fixed total is accounted for across node stores, in-transit packets and the recovery reserve. A particle never damages two targets, teleports to a priority flag, or exists in two compartments.

Selecting a node sets its demand priority: Low, Normal or Focus. Priorities determine demand for available charge; they do not create charge or increase damage per particle. A local shield reserve and charge capacity prevent every focus change from emptying the entire network. Routing moves integer packets over friendly links with limited throughput and travel time, following the exact deterministic contract in the engine plan. A long thin branch is cheap territory but a poor supply line; adding a parallel route improves resilience and throughput.

When a neuron's cooldown permits, its pulse budget is `min(pulseCap, max(0, localCharge - shieldReserve))`. It divides that integer budget among adjacent hostile nodes or construction sites, with rotating remainder allocation; each committed particle causes a configured amount of damage and enters recovery. For each target, sum incoming damage, subtract its fixed structural resistance once, absorb the remainder one-for-one with uncommitted shield charge (also sent to recovery), then subtract any remaining damage from hit points. Attack charge cannot also shield. Damage and destruction resolve simultaneously from the same tick state; see the engine plan for ordering and tie rules.

Discharged, orphaned and destroyed-node charge enters a bounded recovery delay, then returns to the owning brain's reserve for routing again. This is explicitly an abstract recharge mechanic, not a claim that particles physically return along a broken wire. Supply-path delay plus recovery limits sustained pressure. Eliminated players' remaining pool moves to an inert accounting bucket; it is never awarded to the killer.

The intended tactical rhythm is **concentrate → telegraphed pulse → vulnerable recharge → redirect**. A visible charge buildup and network travel delay must leave time to reinforce, cut a supply branch or open another front. Health repair consumes Biomass and commits charge to recovery, has a capped rate, and is suppressed by any incoming raw attack damage that tick, even if shields absorb it; shields are not free instantaneous health regeneration.

## One tower and a small research choice

A **Pulse Tower** upgrades an owned neuron on a designated tower-site hex only when all six surrounding hexes contain connected friendly nodes. Sites are authored map objectives, so claiming an ordinary seven-tile patch does not permit a tower. Map edges and deposits cannot satisfy missing neighbors. This is a placement requirement: losing one surrounding tile does not delete or automatically switch off the completed tower. A tower loses function when disconnected from its brain.

It draws from the same pool as neurons, charges visibly and attacks the nearest hostile target at hex range two. That range is necessary: an intact six-tile ring otherwise puts enemies beyond adjacency. Blocked terrain occludes fire under a deterministic line-of-sight rule. A firing pulse resolves in its firing tick; the tracer is cosmetic, while network supply travel and cooldown buildup provide warning. High local burst and limited firing rate make it a strong anchor, not a free source of damage. Tower construction takes time and competes with repair/expansion for Biomass. Research takes time and Insight; its opportunity cost is the limited research slot, excluded alternative and expansion route to reach Insight deposits. Start with one tower type; measure whether ring completion is feasible at contested fronts.

After the unupgraded combat loop works, introduce one research choice with a single tier initially: **Conduction** (greater link throughput) or **Insulation** (greater per-node, per-tick shield absorption cap, without creating particles). One choice per match creates a legible tradeoff: faster concentration versus absorbing a larger burst when locally supplied. Neither should multiply all economy, health and damage values together. Broader trees and tower specializations are deferred.

## Strategies and available responses

| Approach                  | Advantage                                      | Cost / ordinary counterplay                                                                                |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Wide economic growth      | More deposit edges and build options           | Same charge across more fronts; sever a thin branch or pressure before research pays back                  |
| Focused frontal pulse     | Wins a local charge contest                    | Telegraphs concentration and empties other fronts; defend during buildup and counterattack during recovery |
| Compact tower network     | Short routes and efficient defence             | Construction consumes expansion budget; contest outside deposits and attack from two directions            |
| Parallel resilient routes | Survives a single cut, supplies a front faster | Biomass spent on redundancy rather than towers; force the fight elsewhere                                  |

Preventing endless turtles depends first on these costs: finite shared charge, vulnerable supply cuts, finite shield capacity, no repair under fire, and multiple routes around a defence. Map validation must reject single unavoidable chokepoints on the first competitive map. Test a 15-minute cap that records a draw rather than disguising a stalemate with a score winner. If draws remain common, investigate a siege mechanic or public late-game pressure as an explicit next design decision; do not silently add escalating damage. Four-player kingmaking and coordinated attacks remain real playtest risks, not solved by a two-player counter matrix.

## First demo and balance questions

The first headless scenario has one brain and no bots: queue a route → construct neurons → reach both deposit types → mine → redirect charge, while confirming the sandbox continues without a victory. Run it with normal and instant job durations. Then exercise the competitive loop: two equal brains → queue growth to opposite sides of one shared deposit → both receive partial income → extend into contact → focus charge and exchange pulses → create an alternate connection → sever and reconnect a branch → destroy a brain. A further fixture builds a legal tower ring and compares an adequately supplied tower against a starved one. Research follows only after this base loop is measurable.

Initial tuning hypotheses: meaningful first contact within 60–120 seconds, visible response time of at least a few seconds to major concentration changes, and ordinary matches around 8–12 minutes. Values are targets for experiments, not tested findings. Record first-contact time, income share, branch cuts, charge locations/recovery, decisions per minute, damage and repair, elimination time and capped draws. Change one parameter family at a time; retain seed, configuration, engine version, policy version and commands for replay.

Run economy, rush, defensive and adaptive priority policies against one another with swapped start positions and multiple maps/seeds. Report confidence intervals and draw rates; bot win rate measures those policies, not human balance. A useful first result is discovering that one strategy always wins or that no one can break a defence. Human playtesting must then test readability and whether switching priorities feels consequential.

## Scope boundary and visual direction

**First foundation:** one versioned JSON map with configurable dimensions starting at 12 × 12, a shared map validator, one-player no-AI sandbox, resource sharing, manually queued neuron construction and connectedness. Instant-duration sandbox settings are part of the engine contract from the start. Keep this milestone small enough to inspect construction and mining before combat exists.

**Next:** conserved charge flow, 2–4 player competitive scenarios, simultaneous combat, defeat/draw, snapshot/replay and headless policies. Add the single tower and research fork before multiplayer web playtesting using the existing room/netcode packages. A future map editor reads and writes the same JSON schema and calls the same validator.

**Deferred:** automatic expansion, fog of war, powerups, active abilities, hero-like units, multiple tower classes, procedural map generation, campaigns, ranked play and particle physics. Public information is the first mode, including the shared TV. Fog later needs an explicit trust model: hiding pixels cannot hide state already held by a peer.

The supplied visual sheets are inspiration, not binding implementation instructions. Prefer the newer reference's illustrated brains, distinct neuron/tower silhouettes and clear network connections, with a lighter terrain treatment following the user's feedback. Medium-value slate and muted blue-grey ground, visible rock faces and softly tinted ownership should make the board readable without bloom. Keep bright owner-colored links, distinct deposit shapes and visible flowing charge. Electrical intensity should show local available charge; an independent marker shows selected priority so a starved Focus node cannot look fully powered. Use geometry/icons as well as color. The reference's three-resource example and upgrade illustrations do not change the proposed economy or research scope. Detailed assets and image generation can wait until the core flow is worth watching.
