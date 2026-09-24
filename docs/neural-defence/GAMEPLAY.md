# Neural Defence: core gameplay proposal

Status: proposed rules for review; no implementation or balance evidence yet. The [Phase 0 plan](PHASE_0.md) defines the first headless engine and playable solo sandbox, including a main menu and useful economy research. [ENGINE_PLAN.md](ENGINE_PLAN.md) describes the longer-term engine. Multiplayer and combat follow that foundation.

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

The core is discrete particle transport through neurons. A player has different particle types at the same time: initially assault A (stronger attack, weaker protection) and guard B (stronger protection, weaker attack). They share finite storage and link capacity. Every particle has an owner, type, immutable dispatched research profile and a location/transit state. Identical particles may be represented together for efficiency; their different capabilities are never averaged into a uniform field.

Selecting a node sets demand priorities by particle type. Priorities change intended allocation, not particle locations or power. Finite travel time, shared throughput, congestion, storage reservations and backpressure determine what arrives. A long thin branch is cheap territory but a poor supply line; a parallel route can improve resilience and bandwidth. Speed, throughput and storage are separate properties. Speed upgrades come later; actual travel latency is in the first simulator.

Local attacks commit actual particle types/profiles; remaining local particles can defend according to their absorption properties. A particle cannot attack and shield in the same tick. Damage and destruction resolve simultaneously, allowing mutual kills. [PHASE_0.md](PHASE_0.md) is the single source for prototype attack cadence, selection, reserves, type-specific coefficients, HP and damage accounting. This combat assay is part of the core foundation, not deferred until after an economy-only prototype.

Spent, orphaned and destroyed-node particles enter bounded recovery, with saved return-distance accounting, before returning to their owner's brain. This abstract recycle step preserves count; it does not make instantaneous frontline reinforcements. Changing the mix refits idle particles at the brain over time. Existing stored/travelling particles retain their type/profile until returned and redispatched under the specified rules. Eliminated players' pool moves to an inert accounting bucket; it is never awarded to the killer.

The intended tactical rhythm is **concentrate → telegraphed pulse → vulnerable recharge → redirect**. A visible charge buildup and network travel delay must leave time to reinforce, cut a supply branch or open another front. Health repair consumes Biomass and commits charge to recovery, has a capped rate, and is suppressed by any incoming raw attack damage that tick, even if shields absorb it; shields are not free instantaneous health regeneration.

## One tower and a small research choice

A **Pulse Tower** upgrades an owned neuron on a designated tower-site hex only when all six surrounding hexes contain connected friendly nodes. Sites are authored map objectives, so claiming an ordinary seven-tile patch does not permit a tower. Map edges and deposits cannot satisfy missing neighbors. This is a placement requirement: losing one surrounding tile does not delete or automatically switch off the completed tower. A tower loses function when disconnected from its brain.

It draws from the same pool as neurons, charges visibly and attacks the nearest hostile target at hex range two. That range is necessary: an intact six-tile ring otherwise puts enemies beyond adjacency. Blocked terrain occludes fire under a deterministic line-of-sight rule. A firing pulse resolves in its firing tick; the tracer is cosmetic, while network supply travel and cooldown buildup provide warning. High local burst and limited firing rate make it a strong anchor, not a free source of damage. Tower construction takes time and competes with repair/expansion for Biomass. Research takes time and Insight; its opportunity cost is the limited research slot, excluded alternative and expansion route to reach Insight deposits. Start with one tower type; measure whether ring completion is feasible at contested fronts.

Phase 0 includes a small type-specific choice: **Excitation** improves assault particle attack, or **Insulation** improves guard particle protection, alongside the independent Growth Efficiency economy upgrade. The exact profile/research timing is defined in the Phase 0 contract. Later Conduction may improve throughput; speed research changes travel latency separately. None creates particles or universally improves every role. Broader trees and tower specializations remain deferred.

## Strategies and available responses

| Approach                  | Advantage                                      | Cost / ordinary counterplay                                                                                |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Wide economic growth      | More deposit edges and build options           | Same charge across more fronts; sever a thin branch or pressure before research pays back                  |
| Focused frontal pulse     | Wins a local charge contest                    | Telegraphs concentration and empties other fronts; defend during buildup and counterattack during recovery |
| Compact tower network     | Short routes and efficient defence             | Construction consumes expansion budget; contest outside deposits and attack from two directions            |
| Parallel resilient routes | Survives a single cut, supplies a front faster | Biomass spent on redundancy rather than towers; force the fight elsewhere                                  |

Preventing endless turtles depends first on these costs: finite shared charge, vulnerable supply cuts, finite shield capacity, no repair under fire, and multiple routes around a defence. Map validation must reject single unavoidable chokepoints on the first competitive map. Test a 15-minute cap that records a draw rather than disguising a stalemate with a score winner. If draws remain common, investigate a siege mechanic or public late-game pressure as an explicit next design decision; do not silently add escalating damage. Four-player kingmaking and coordinated attacks remain real playtest risks, not solved by a two-player counter matrix.

## First demo and balance questions

The Phase 0 sandbox loop is: construct a network → mine both resources → allocate an assault/guard mixture → observe transport latency and congestion → research → mobilize the improved particles. It keeps running without an automatic victory. The companion combat assay uses the same engine: meet an opposing network → concentrate or defend → change the mixture and routes → sever/reconnect a branch → destroy a brain or draw. Run normal and instant job settings without removing particle travel time. Later tower fixtures compare supplied and starved towers. These scenarios establish mechanics and counterplay hypotheses, not a claim of competitive balance.

Initial tuning hypotheses: meaningful first contact within 60–120 seconds, visible response time of at least a few seconds to major concentration changes, and ordinary matches around 8–12 minutes. Values are targets for experiments, not tested findings. Record first-contact time, income share, branch cuts, charge locations/recovery, decisions per minute, damage and repair, elimination time and capped draws. Change one parameter family at a time; retain seed, configuration, engine version, policy version and commands for replay.

Run economy, rush, defensive and adaptive priority policies against one another with swapped start positions and multiple maps/seeds. Report confidence intervals and draw rates; bot win rate measures those policies, not human balance. A useful first result is discovering that one strategy always wins or that no one can break a defence. Human playtesting must then test readability and whether switching priorities feels consequential.

## Scope boundary and visual direction

**First foundation:** follow [PHASE_0.md](PHASE_0.md) for the menu, JSON maps, four-owner state model, one-player no-AI sandbox, economy/construction/research, heterogeneous particle transport and actual minimal attack/defence. A scripted opposing-network assay and headless multi-owner tests exercise the same rules. Instant construction/research settings remain a timing aid; they do not remove particle travel time. The foundation is not accepted until composition and delayed supply affect combat outcomes.

**Next:** broader 2–4 player competitive scenarios, AI policies and tuning, one tower type, deeper research and human multiplayer web playtesting using the existing room/netcode packages. A future map editor reads and writes the same JSON schema and calls the same validator. [RTS_PLAYBOOK.md](RTS_PLAYBOOK.md) defines the intended tradeoffs and evidence needed before claiming balance.

**Deferred:** automatic expansion, fog of war, powerups, active abilities, hero-like units, multiple tower classes, procedural map generation, campaigns, ranked play and particle physics. Public information is the first mode, including the shared TV. Fog later needs an explicit trust model: hiding pixels cannot hide state already held by a peer.

The supplied visual sheets are inspiration, not binding implementation instructions. Prefer the newer reference's illustrated brains, distinct neuron/tower silhouettes and clear network connections, with a lighter terrain treatment following the user's feedback. Medium-value slate and muted blue-grey ground, visible rock faces and softly tinted ownership should make the board readable without bloom. Keep bright owner-colored links, distinct deposit shapes and visible flowing charge. Electrical intensity should show local available charge; an independent marker shows selected priority so a starved Focus node cannot look fully powered. Use geometry/icons as well as color. The reference's three-resource example and upgrade illustrations do not change the proposed economy or research scope. Detailed assets and image generation can wait until the core flow is worth watching.
