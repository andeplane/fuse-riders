# Neural Defence: RTS design and balance playbook

Status: **proposal for review; no implementation or balance evidence**. This supports [GAMEPLAY.md](GAMEPLAY.md), [ENGINE_PLAN.md](ENGINE_PLAN.md) and [PHASE_0.md](PHASE_0.md). Latest Phase 0 scope: **builder particles, one attack particle type and one test tower**. No defence particles, shielding or composition refit yet. This slice proves mechanisms; the broader strategy programme below remains future evaluation rather than a claim of balance.

## What established design practice gives us

There is useful design literature, but no recipe that guarantees a balanced RTS. A symmetric ruleset can still have a dominant opening, unfair map or tedious winning strategy. Start with a small set of interactions, state what each should enable, then seek counterexamples through play.

- **Viable choices and fair starts are different goals.** David Sirlin's [GDC 2009 balancing handout](https://media.gdcvault.com/gdc09/slides/GDC09_sirlin_balancing.pdf) distinguishes options worth choosing during play from fairness between starting options. His argument for distinct strengths and counters motivates varying timing, reach and commitment rather than stacking damage bonuses. It does not establish the balance of our game.
- **A threat needs preparation and response.** Riot's [counterplay design discussion](https://www.leagueoflegends.com/en-us/news/dev/quick-gameplay-thoughts-may-14/) separates strategic preparation from tactical responses, and argues that weaknesses should preserve agency. A losing player should be able to identify a plausible different decision, not merely a missing upgrade.
- **Feedback creates both momentum and runaway leads.** Ernest Adams's [positive-feedback analysis](https://www.gamedeveloper.com/design/designer-s-notebook-positive-feedback) describes advantages feeding further advantages and their role in resolving competition. Our application is to measure economic compounding and recovery windows explicitly, rather than assuming a finite charge pool solves snowballing.
- **Mechanics must produce the intended experience.** The original [MDA paper](https://www.cs.northwestern.edu/~hunicke/MDA.pdf), by Hunicke, LeBlanc and Zubek, connects rules, emergent behavior and player experience through iteration. Our target experience is readable pressure, meaningful redirection and a satisfying growing network; bot win rates alone cannot validate it.

Everything below is our proposed application of those principles, not a result demonstrated by the sources.

## A small set of decisions with real tradeoffs

Keep one symmetric faction: brain, neuron, two currencies, a finite attack pool and separately bounded reusable builders. Phase 0 supplies queued construction with physical builder delivery, mining, research, attack transport/combat and one test tower in the lab. It does not introduce a tower roster or tower upgrade system.

Attack particles fight; builders deliver construction capability. Their separate stock accounting prevents a worker from silently counting as military strength. Both have physical transport, owner and lifecycle identity. The first strategy questions concern position, supply and timing, rather than military composition. More combat types can follow only if they create a useful decision that this smaller roster cannot express.

Growth Efficiency tests construction research; a small attack-property upgrade tests whether research changes actual supplied particles. No guard/Insulation branch is required. Later conduction or additional military roles need explicit costs and responses. Speed changes travel time independently of throughput. This first catalogue tests the research foundation, not a finished branching strategy tree or rock-paper-scissors system.

Every proposed structure or research must name:

1. The situation where it is useful, and the observable information that helps the player choose it.
2. Its currency, time, construction/research-slot and charge commitments.
3. The vulnerability it leaves, an ordinary response available without a special counter, and the time needed for that response.
4. A measurable failure condition that would cause us to revise or remove it.

Biomass makes expansion compete with construction and repair. Insight makes research routes valuable, but research also consumes time and the exclusive research slot. More territory must not multiply particle supply automatically. Shorter supply routes and local reserves provide some defender advantage; they must not make attacking futile.

## Flow is gameplay, not decoration

Use bounded deterministic particle transport, integer quantities, finite shared throughput, explicit transit and recovery. Visual particles depict that state. Priorities request redistribution; they cannot teleport stock or alter a packet already in flight. Distant fronts cost time, and committing there weakens another location. Aggregated batches must preserve owner, role, research profile and timing; builders remain distinct from attack supply.

Keep these tuning dimensions separate: attack pool size, builder count, node capacity, link throughput, travel ticks, pulse size/cooldown, attack yield and recovery. A speed upgrade should not silently increase packet quantity or damage. Their combinations can still compound, so test combinations rather than only each scalar. Shield efficiency is not a Phase 0 parameter.

Give authoritative particle profiles stable typed IDs and explicit gameplay properties; use a small versioned profile catalog rather than arbitrary runtime modifier scripts. Research changes must have specified activation boundaries: resolve travel timing at departure and preserve it in the checkpoint; define combat-property sampling in the Phase 0 assay. Do not reinterpret particles according to whichever technology the renderer currently sees. Preserve owner, type, amount and any required profile/version in every authoritative compartment.

Readable charge buildup, transit and recovery are commitments the opponent can exploit. Test whether a visible threat leaves enough time to issue a command, move charge and survive. Simulation signal delay is a balance knob; network delivery latency is an engineering constraint and must never become a player's purchasable stat. Rendered particle count is a visual budget, independent of conserved engine quantities.

## Roster and the decisions it creates

This is a territorial RTS with tower-defence elements, rather than a wave-survival game in Phase 0. There are no neutral creep waves, heroes or equipment inventories yet. Particles are the fighting units; neurons are their supply network and firing positions. Every player initially has the same available options. Player identity, spawn and colour are distinct; the design must work for four independent owners without a privileged local-player simulation.

| Element            | Gameplay purpose and limitation                                                       | Availability                                            |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Brain | Root of connectivity, income and particle stock; destruction eliminates its owner | Phase 0; HP from rules |
| Neuron             | Owned territory, mining neighbour, relay and adjacent firing position                 | Phase 0; 60 HP, 32 deployed particles                   |
| Construction site  | Paid, exclusive, damageable work in progress; cannot mine, relay or fight             | Phase 0; initially 20 HP, damage persists on completion |
| Attack particle | Only military particle type; attacks structural HP, never absorbs damage | Phase 0 |
| Builder particle | Travels to ready queued jobs and builds from a connected frontier anchor | Phase 0; separate reusable worker stock |
| One test tower | Enclosed-site ranged launcher of the same finite attack particles | Phase 0 lab fixture; one experimental type, no tower roster |
| Biomass deposit    | Neutral construction-income objective shared by connected adjacent owners             | Phase 0; cannot be occupied                             |
| Insight deposit    | Neutral research-income objective with the same adjacency model                       | Phase 0; cannot be occupied                             |
| Blocked terrain    | Prevents occupation and shapes routes, chokepoints and contact                        | Phase 0                                                 |
| Tower site | Designated enclosed location for the one test tower | Phase 0 map/fixture metadata |

Defending means keeping useful firing positions supplied, preserving HP and denying threatening routes. There is no shield or guard absorption. Additional particle types later need a distinct delivery/response interaction, not merely a larger damage number. Their possible future existence must not expand this first slice.

## Core loops and pacing

The central choice is **where to grow versus where to commit strength**. Growth buys reach and mining access, while a finite particle pool makes each additional front a liability as well as an opportunity. Research strengthens a particular plan but consumes time and Insight that cannot buy another upgrade at the same moment.

| Timescale       | Player decision                                                    | Desired consequence                                                         |
| --------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Seconds | Reinforce a junction, change attack priority, respond to a cut | Orders have readable arrival delays and visible opportunity costs |
| Tens of seconds | Queue a route, deliver builders, finish research | A commitment creates an opportunity and exposes a different weakness |
| Whole match     | Choose which income to contest and adapt to surviving opponents    | Plans remain revisable; an early purchase does not predetermine every fight |

Early play should establish a readable route and reveal the first commitment. Midgame should create reasons to choose between income, research and competing fronts. Endgame should turn sustained advantage into a credible brain threat without a long helpless cleanup. These are design goals, not invented target match durations: measure first mining, first contact, upgrades, cuts and eliminations before fixing pacing targets.

## Economy: sources, sinks and payback

Biomass buys space; Insight buys research. Attack particles are reusable military capacity, not a third mined resource. Builder stock is reusable work capacity. Initial balances, attack/worker counts and rates are owned by Phase 0; the economy examples below use the starting 60 Biomass, zero Insight and brain income of 1 Biomass/0.5 Insight per second. Deposits encourage expansion without making recovery require permanently retaining a mine.

| Decision                 | Current starting proposal                               | Strategic commitment                                                  |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Construct neuron | 20 Biomass, 6 seconds of work after builder arrival, one active job | Money, worker availability and delivery/work time are scarce |
| Mine Biomass             | 6/second across six sides; 1/second per eligible side   | Additional income requires reachable connected territory              |
| Mine Insight             | 3/second across six sides; 0.5/second per eligible side | Research routes compete with economic and tactical routes             |
| Growth Efficiency        | 10 Insight, 20 seconds; later neurons take 4 seconds    | Occupies the research slot instead of an early combat specialization  |
| Attack-property research | Small attack upgrade; exact definition in Phase 0 | Competes with economy research for the research slot |
| Builder dispatch | Occurs when a queued job is legal, affordable and a worker is available | Distant construction requires real delivery and return time |

A three-neuron route costs the starting 60 Biomass and 18 seconds of serial work, **plus builder travel/availability delays**. Income accrues during that time; this is an illustrative commitment, not an exact opening. If only the last tile adds one Biomass side, incremental income of 1/second takes approximately 60 seconds to repay the route's 60 Biomass after mining starts. Other sides and tactical value alter this. Test whether routes pay back before first contact; do not assume expansion is worthwhile.

Baseline Insight funds the first 10 Insight after 20 seconds, followed by 20 seconds of research. Growth Efficiency saves 2 seconds of work on each subsequent neuron, without removing delivery; five later neurons save 10 work seconds. That is a production-time saving, not a currency return or proof of a superior opening. An attack upgrade reaching a threatened junction may matter more.

Deposits remain neutral and inexhaustible. Two players with three connected sides each split the output; unoccupied or disconnected sides produce nothing. Queues and sites produce no income. Baseline income avoids a circular unlock where research is needed to reach the resource needed to buy that research. It does not guarantee survival under pressure.

After the small Phase 0 research catalogue is exhausted, Insight can accumulate without another sink. Record this prototype limitation. Do not add arbitrary repeatable upgrades solely to consume the surplus, or assume a finite particle pool by itself prevents economic snowballing.

## Construction, research and builder particles

Construction and research are the two paid job families. **Routing, builder delivery/return, mining and combat** continuously support or use them. Give each lifecycle explicit typed state rather than one generic job record with unrelated optional fields. Military composition refit is not needed for one attack type.

Construction begins with manual route queuing. A destination remains an unpaid intention until legal, affordable and a builder is ready. Acceptance reserves the site, pays once and dispatches the worker through friendly links to a connected node adjacent to the target. The work timer begins on arrival. One active construction job keeps this first version legible; research may run concurrently. Disconnection pauses work, and started work has no refund under the initial contract.

Builder delivery is now part of the requested core, rather than an optional later concept. It makes expansion sensitive to the same distance and congestion as combat. The implementation must expose queued, travelling, building and returning separately and checkpoint every consequential transition.

| Builder decision | Required rule or evidence |
| --- | --- |
| Destination | A connected adjacent staging neuron; never require the unbuilt target to relay its own builder |
| Transport | Physical links with explicit latency and shared-capacity arbitration; no worker starvation |
| Accounting | Separate bounded worker stock, never counted as attack damage or ammunition |
| Cancellation/cut | Explicit return or delayed recovery policy; no instantaneous replacement or cloning |
| Activation | Completed neuron becomes operational at the defined next-tick boundary |

Keep the initial builder count and the one-job slot as independent explicit rules. More workers must not silently enable parallel construction. A common worker/combat pool would change the economy and is outside this scoped separate-stock foundation.

The lifecycle is paid site reserved → builder dispatched → adjacent anchor reached → work → return. Test target destruction and anchor cuts during every stage, alongside opposite-direction military traffic. A worker exists in exactly one compartment at a time. Site vulnerability, job failure and worker recovery must follow the Phase 0 contract rather than emerge from animation completion.

Debug removes construction work duration, not delivery time. The site completes after its worker arrives and becomes operational at the normal boundary. Show that distinction clearly, so a travelling builder is not mistaken for a broken instant-build control. Research can complete instantly without changing attack transport or worker stock.

## Research choices and adoption windows

The initial catalogue tests Growth Efficiency and a small attack-property improvement. Research order matters through the shared research slot. There is no guard upgrade, branching military specialization or tower upgrade catalogue in Phase 0. Later branches should follow evidence of missing decisions rather than a desired tree size.

| Choice                    | Useful situation                                                    | Cost and available response                                                  |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Growth Efficiency         | Many affordable future neurons; earlier route completion matters    | Delays combat specialization; pressure unfinished or undersupplied expansion |
| Attack-property upgrade | A supplied front can exploit more damage per spent particle | Delays economy research; pressure before upgraded particles arrive or open another front |
| Faster conduction, later  | Long routes need earlier reinforcement                              | Does not remove capacity bottlenecks or increase the particle pool           |
| Greater throughput, later | Shared edges constrain sustained supply                             | Does not reduce first-particle latency or create stock                       |

Do not assume both later technologies are necessary. Display the actual property changed, cost, duration, activation tick and effect on existing particles. A vague efficiency multiplier hides too many interactions. Immutable profiles mean old particles can remain unupgraded at a front while newly dispatched ones carry the benefit; the player should see that adoption wave without inspecting individual particles.

## Combat examples and control constraints

The assay runs at 20 Hz with explicit per-edge travel and capacity. Congestion and the no-same-tick-forwarding rule add delay. Attack priority requests relative demand, not a guaranteed percentage or instant buff. Builder traffic follows jobs, sharing links through deterministic arbitration. Test saturated attack demand alongside an accepted build so neither rule accidentally deletes or starves the other.

Connected completed nodes commit available attack particles against hostile structures on the defined cadence. Firing decisions are frozen before simultaneous HP damage, so iteration order cannot grant a first strike. Unspent particles do not shield a node. Reinforcement helps by enabling counterfire and pressure, not by cancelling incoming damage.

For an illustrative arithmetic check, four particles with attack 2 cause eight structural damage, while four with attack 3 cause twelve. These are example profile values subject to Phase 0, not a new tuning authority. Include the target's simultaneous attack, other attackers and reservations in full scenarios. No guard, absorption or armour arithmetic belongs in this first resolver.

The lab's **one test tower** launches those same attack particles at range, supplied through the same network. Compare supplied, empty and disconnected cases; no free shots, extra pool or independent ammunition resource. Its intended site has a six-neighbour friendly ring, and its range/occlusion must make an exterior target reachable. One experimental fixture establishes that mechanism; a fortified-tower strategy remains a later balance question.

Spent particles return through delayed recovery at the brain and must redeploy. Recovery must not make deliberate disconnection or sacrifice faster than a normal return route without an intended cost. New neurons start empty with zero priority, so economic growth does not silently drain an established front. Sending the brain's reserve outward must visibly expose it.

## Strategy hypotheses to test

These are behavioral policies, not selectable classes or a guaranteed counter cycle. Players should change plans as the map and opponents change.

| Strategy              | Strength and commitment                                                                           | Vulnerability and available response                                                                                                          | Observable design failure                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Wide economy          | More mining edges fund construction and later research; invests Biomass into long branches        | Limited charge covers more fronts; an opponent concentrates against a supply neck or contests the next deposit before payback                 | Expansion wins even when its exposed branch is identified and pressured, or losing one branch makes recovery impossible           |
| Concentrated pressure | Short route and focused charge can break an underfunded frontier early; delays extra income       | Other fronts and the recharge interval are weak; defend with a local reserve, reconnect around cuts, or pressure a different accessible front | Focus has no meaningful commitment, instant redirection negates responses, or early pressure always fails against passive defence |
| Fortified anchor      | Tower and local reserve protect a valuable junction; commits a ring, Biomass and charge           | Static investment cannot cover everything; bypass its range, contest unprotected deposits or cut its supply where the map permits             | Mandatory choke plus tower creates an unbreakable wall, or ring construction is never achievable in contested play                |
| Research investment   | Insight access buys a later logistical or defensive advantage; postpones immediate board strength | Construction and research time expose an early window; contest Insight edges or pressure before completion                                    | First upgrade decides every fight regardless of position, or its payback never arrives before typical elimination                 |

For each row, record both a successful example and a replay where the named response changes the outcome. A paper counter is insufficient when its cost, travel time or placement makes it unavailable in real matches. Counters should create opportunities, not guarantee victory despite poor execution.

### Concrete openings and responses

These are future adaptable policy experiments, not Phase 0 acceptance requirements or a guaranteed counter cycle. Examples assume legal routes; builder delivery, opponents and geometry can invalidate them. Phase 0 tests the mechanisms with a scripted assay. The fortified-anchor strategy needs later content decisions beyond one test tower.

1. **Economic branching:** spend up to the starting 60 Biomass on a short mining route, then buy more sides while retaining a supplied junction. The opponent pressures its neck before payback. Respond with a shorter route, earlier attack supply for counterfire or redundancy. Fail if exposed expansion wins regardless of timely pressure, or one cut makes recovery impossible.
2. **Concentrated pressure:** build a short contact route and supply its final neuron, postponing a second economic branch. An attack upgrade matters only when improved particles reach it. Respond with counterfire from a short supplied route or pressure elsewhere during recovery. Fail if the same rush wins regardless of prepared responses.
3. **Junction defence into counterattack:** protect a fork with supplied firing positions while builders establish another route. Redirect during the enemy recovery window. The response is bypassing or contesting outside income. The first test must work without shields, repair or invented hold-fire controls.
4. **Research timing attack:** seek Insight and schedule an attack upgrade so new-profile particles reach a contested edge together. The plan needs research, stock and dispatch, not merely a clicked upgrade. Opponents can contest Insight or attack before the benefit arrives; the researcher can retreat to a shorter supply line. Fail if research determines every fight regardless of position or never pays off before elimination.
5. **Redundant routes and flank:** spend construction time on a second connection around a bottleneck, then approach an undersupplied branch. The cost buys resilience and route geometry rather than immediate income. Opponents can contest the endpoint before completion or maintain split reserves. Fail if recovery bypasses the value of redundancy, or unstable equal-cost routing prevents any reliable flank supply.
6. **Fortified anchor, later:** secure a tower ring and feed a Pulse Tower from a local reserve. Opponents bypass its range, take exposed deposits or cut upstream supply. Fail if an unavoidable tower lane creates permanent stalemate, or if the ring is never achievable under realistic pressure. Do not set a tower price before the basic particle interaction has evidence.

For each policy retain a successful replay and another where its advertised response changes the outcome. A counter must be affordable, visible and timely for a player in that situation. A theoretical action that arrives after the brain dies is not a counter.

## Maps, information and four-player play

- Validate geometry separately from balance. Compare per-spawn path cost to each resource, defensible mining edges, alternate routes, supply distances, tower access and distance to first hostile contact. Hex offset rectangles are not automatically rotationally fair.
- Use matched seat rotations for two, three and four players. An unused fourth corner may give one player uncontested economy in a three-player game; test that setup separately or withhold it as a competitive map.
- Begin combat testing with full information, matching shared-TV play. Fog later changes scouting, warning time and surprise strength; it needs its own balance evidence. Client-side fog on trusted peer state is presentation, not protection from a modified client.
- Four-player free-for-all introduces third-party attacks, temporary cooperation and kingmaking. Pairwise matchup fairness cannot establish FFA fairness. Measure victim selection, simultaneous attackers, lead changes, first-eliminated timing and whether avoiding all fights dominates; review social enjoyment with humans.
- Do not silently introduce anti-leader bonuses or elimination loot. First adjust map access, charge commitments and timing. A comeback should come from an available decision, while a decisive advantage should still end a match without a long helpless cleanup.
- Three priorities and explicit route queues should express intent without constant clicking. Measure command burden and whether rapid priority toggling outperforms considered play. Automation must obey the same action budgets and rules as humans.

## Readability, graphs and failure modes

Use lighter slate terrain, strong silhouettes and ownership cues beyond colour. Builder and attack particles must remain distinguishable across all four palettes. Upgraded attack profiles need a secondary cue; players should not have to count tiny sprites to estimate supply. Rendered particle count is a visual budget, not authoritative quantity.

A node inspector should answer: is it connected, what is stored, what is incoming and when, what is congested, and why is work paused? Show submitted intent separately from applied state. A route preview is not territory; incoming attack stock cannot fire yet. Priorities should remain durable choices, not a rapid-toggling contest.

Two useful human vignettes are a queued frontier job whose builder is two hops away, and a supplied junction about to lose its upstream connection. Ask players to predict when construction starts, then explain lost income and choose a reconnection. If the explanation remains opaque despite correct rules, improve the display or simplify the rule before adding content.

Later graphs should connect decisions with consequences: income by source against spending; connected/disconnected territory; attack/worker stock and lifecycle; delivery delay and congestion; damage; research completion versus first useful upgraded arrival; cuts and elimination. Stock, interval flow and exact-tick events differ. Balance changes cannot recover simultaneous income/spending. Phase 0 reserves stable IDs and typed outcomes; graph history/UI remain deferred.

| Failure to seek               | Probe and useful evidence                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Non-ending positional stalemate | Symmetric fronts, alternative routes and research; retain unresolved replays |
| Economic runaway              | Give a small income lead, then let an informed opponent target expansion; inspect actual recovery options    |
| Free cut/recovery teleport    | Compare normal return against disconnection, destruction and cancellation                                    |
| Priority/worker cancellation thrashing | Adversarial reversals, job cancellations and shared-edge congestion |
| Construction denial spam      | Competing claims, queue cancellation order, paid-site losses and action limits                               |
| Mandatory or useless research | Change order and pressure windows on matched maps; inspect when upgrades first matter                        |
| Routing starvation/deadlock   | Cycles, full targets, opposed traffic, cuts and reservation release; require progress where legally possible |
| Excessive attention cost      | Matched bounded-command policies, then phone/shared-TV human tests; count reversals without benefit          |

Do not hide stalemates with an unplanned sudden-death rule or economic flaws with automatic catch-up bonuses. Identify why the intended response was unavailable. If an endgame rule becomes necessary, propose it explicitly with its own visible incentives and tests.

## Evidence loop and acceptance

Phase 0 acceptance proves four-player isolation, simultaneous resolution, economy/jobs/research, bounded work and checkpoint replay; separate attack/worker conservation; delivery latency, bottlenecks, cuts and profile boundaries. It includes builder-driven jobs and one test tower using actual attack supply. The assay must distinguish supplied from starved positions and show that changed priorities cannot instantly reinforce. It does not certify balance or require multiple military types.

For subsequent strategy evaluation of the combat foundation:

1. Create reproducible fixtures for one corridor, a fork, a redundant route, a contested deposit and a tower junction. Check that each intended response is actually legal and timely.
2. Run the strategy families above, where their required features exist, plus variants and an adaptive policy through the same public observations/actions as players. Parameter sweeps expose brittle numbers; bots receive no privileged state or shorter command delays. Use declared fixed decision budgets. The tournament harness and tower policy are later work, not hidden Phase 0 requirements.
3. Pair every candidate ruleset with the baseline on the same map/seed/policy combinations and rotate seats. Separate two-player matchup matrices from three/four-player placement results. Include held-out maps and policy variants so tuning does not merely exploit the test bots.
4. Save rules/map hashes, source revision, policy versions, seeds, commands and replays. Report sample counts, uncertainty and draw/timeout rates; do not hide losses behind pooled averages. Equal win rates are not required for every strategy matchup, and are not proof of depth.
5. Inspect income/spending, connected territory, research completions, attack allocation/transit/recovery, builder travel/work/return time, queue delays, damage, cuts and eliminations. Attribute confirmed events by stable player ID and tick; rollback replaces history, never double-counts it. These support later graphs without making telemetry authoritative state.
6. Human tests decide whether threats are readable, responses understandable, decisions interesting and winning enjoyable. Ask players to explain a loss and replay a different response; collect novice and experienced feedback, including shared-TV controls. Recheck after meaningful rules changes.

Reject or revise a design when one policy reliably dominates varied opponents and maps without an accessible response; when draws or unavoidable rushes dominate; when one spawn wins systematically; or when success depends on exhausting micromanagement. Predeclare numeric alert thresholds and workloads for each experiment, then review the replays behind alerts. Set match-duration and response-time targets after an observed prototype, not as invented balance evidence.

Scalability means we can add an interesting mechanic without breaking identity, determinism or testability, and can measure its consequences cheaply. It does not mean building a huge tech tree or claiming professional-RTS balance before people have played.
