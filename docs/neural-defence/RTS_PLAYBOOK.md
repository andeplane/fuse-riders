# Neural Defence: RTS design and balance playbook

Status: **proposal for review; no implementation or balance evidence**. This supports [GAMEPLAY.md](GAMEPLAY.md), [ENGINE_PLAN.md](ENGINE_PLAN.md) and [PHASE_0.md](PHASE_0.md). Phase 0 proves the economy and particle transport/combat foundations; it does not establish a balanced competitive game.

## What established design practice gives us

There is useful design literature, but no recipe that guarantees a balanced RTS. A symmetric ruleset can still have a dominant opening, unfair map or tedious winning strategy. Start with a small set of interactions, state what each should enable, then seek counterexamples through play.

- **Viable choices and fair starts are different goals.** David Sirlin's [GDC 2009 balancing handout](https://media.gdcvault.com/gdc09/slides/GDC09_sirlin_balancing.pdf) distinguishes options worth choosing during play from fairness between starting options. His argument for distinct strengths and counters motivates varying timing, reach and commitment rather than stacking damage bonuses. It does not establish the balance of our game.
- **A threat needs preparation and response.** Riot's [counterplay design discussion](https://www.leagueoflegends.com/en-us/news/dev/quick-gameplay-thoughts-may-14/) separates strategic preparation from tactical responses, and argues that weaknesses should preserve agency. A losing player should be able to identify a plausible different decision, not merely a missing upgrade.
- **Feedback creates both momentum and runaway leads.** Ernest Adams's [positive-feedback analysis](https://www.gamedeveloper.com/design/designer-s-notebook-positive-feedback) describes advantages feeding further advantages and their role in resolving competition. Our application is to measure economic compounding and recovery windows explicitly, rather than assuming a finite charge pool solves snowballing.
- **Mechanics must produce the intended experience.** The original [MDA paper](https://www.cs.northwestern.edu/~hunicke/MDA.pdf), by Hunicke, LeBlanc and Zubek, connects rules, emergent behavior and player experience through iteration. Our target experience is readable pressure, meaningful redirection and a satisfying growing network; bot win rates alone cannot validate it.

Everything below is our proposed application of those principles, not a result demonstrated by the sources.

## A small set of decisions with real tradeoffs

Keep one symmetric faction initially: brain, basic neuron, two currencies and one finite particle pool with two simultaneous types. Phase 0 supplies manual construction, mining, research, real particle transport and a minimal combat assay. The Pulse Tower follows after the base interaction works; it is the only initial tower candidate.

Candidate particle roles are assault (stronger attack, weaker protection) and guard (stronger protection, weaker attack), both available to every player and able to coexist in the same network. Both use the same finite pool, node space and link capacity. Composition changes require a visible commitment at the brain and transit to the front; they cannot instantly turn a threatened node into its perfect counter. Exact type names, coefficients and conversion rules belong to the flow contract, not this strategy document.

The Phase 0 choice is Excitation (assault attack) or Insulation (guard absorption); Conduction may later improve link throughput. Particle speed changes link travel time independently of throughput. Type-specific research must affect the actual attack/defence resolver. More types, tiers and powers need a demonstrated strategic purpose before entering the roster. A mixed composition should have a plausible use; neither pure assault, pure guard nor a fixed mixture should be assumed optimal everywhere. This is not a hard rock-paper-scissors system.

Every proposed structure or research must name:

1. The situation where it is useful, and the observable information that helps the player choose it.
2. Its currency, time, construction/research-slot and charge commitments.
3. The vulnerability it leaves, an ordinary response available without a special counter, and the time needed for that response.
4. A measurable failure condition that would cause us to revise or remove it.

Biomass makes expansion compete with construction and repair. Insight makes research routes valuable, but research also consumes time and the exclusive research slot. More territory must not multiply particle supply automatically. Shorter supply routes and local reserves provide some defender advantage; they must not make attacking futile.

## Flow is gameplay, not decoration

Use bounded deterministic particle transport, with integer quantities by type, finite shared link throughput, explicit transit time and recovery. Visual particles depict that state. A priority command requests redistribution; it cannot teleport particles or alter a packet already in flight. Supplying a distant front costs time, while committing particles there weakens another location. Aggregated transport batches may implement the simulation, but must preserve composition and type-dependent outcomes.

Keep these tuning dimensions separate: pool size, node capacity, link throughput, travel ticks, pulse size, pulse cooldown, attack yield, shield efficiency and recovery ticks. A speed upgrade should not silently increase packet quantity, damage and shielding too. Their effective combinations can still compound, so test combinations rather than only each scalar in isolation.

Give authoritative particle profiles stable typed IDs and explicit gameplay properties; use a small versioned profile catalog rather than arbitrary runtime modifier scripts. Research changes must have specified activation boundaries: resolve travel timing at departure and preserve it in the checkpoint; define combat-property sampling in the Phase 0 assay. Do not reinterpret particles according to whichever technology the renderer currently sees. Preserve owner, type, amount and any required profile/version in every authoritative compartment.

Readable charge buildup, transit and recovery are commitments the opponent can exploit. Test whether a visible threat leaves enough time to issue a command, move charge and survive. Simulation signal delay is a balance knob; network delivery latency is an engineering constraint and must never become a player's purchasable stat. Rendered particle count is a visual budget, independent of conserved engine quantities.

## Roster and the decisions it creates

This is a territorial RTS with tower-defence elements, rather than a wave-survival game in Phase 0. There are no neutral creep waves, heroes or equipment inventories yet. Particles are the fighting units; neurons are their supply network and firing positions. Every player initially has the same available options. Player identity, spawn and colour are distinct; the design must work for four independent owners without a privileged local-player simulation.

| Element            | Gameplay purpose and limitation                                                       | Availability                                            |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Brain              | Root of connectivity, income, reservoir and refit; destroying it eliminates its owner | Phase 0; 240 HP                                         |
| Neuron             | Owned territory, mining neighbour, relay and adjacent firing position                 | Phase 0; 60 HP, 32 deployed particles                   |
| Construction site  | Paid, exclusive, damageable work in progress; cannot mine, relay or fight             | Phase 0; initially 20 HP, damage persists on completion |
| Assault particle A | Stronger attack, weaker absorption; still able to defend                              | Phase 0; base attack 2 / absorption 1                   |
| Guard particle B   | Stronger absorption, weaker attack; still able to attack                              | Phase 0; base attack 1 / absorption 2                   |
| Builder particle C | Physical delivery of construction capability to the frontier                          | Proposed below; not an accepted Phase 0 rule            |
| Pulse Tower        | Later range-two firing position using the same particle pool; requires a secured ring | Deferred; one initial tower candidate                   |
| Biomass deposit    | Neutral construction-income objective shared by connected adjacent owners             | Phase 0; cannot be occupied                             |
| Insight deposit    | Neutral research-income objective with the same adjacency model                       | Phase 0; cannot be occupied                             |
| Blocked terrain    | Prevents occupation and shapes routes, chokepoints and contact                        | Phase 0                                                 |
| Tower site         | A reserved map affordance for later construction rules                                | Phase 0 metadata only; no functional tower              |

Assault and guard are a simultaneous mixture, not exclusive factions or a choice between owning A and owning B. Neither has an anti-type damage bonus. Calling one a hard counter to the other would therefore be misleading: stock, position, timing and competing obligations decide whether a mixture works. Additional particle types need a distinct delivery/response interaction, not merely a larger damage number.

## Core loops and pacing

The central choice is **where to grow versus where to commit strength**. Growth buys reach and mining access, while a finite particle pool makes each additional front a liability as well as an opportunity. Research strengthens a particular plan but consumes time and Insight that cannot buy another upgrade at the same moment.

| Timescale       | Player decision                                                    | Desired consequence                                                         |
| --------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Seconds         | Reinforce a junction, change per-type priorities, respond to a cut | Orders have readable arrival delays and visible opportunity costs           |
| Tens of seconds | Build a route, change mixture, finish research                     | A commitment creates a useful window and exposes a different weakness       |
| Whole match     | Choose which income to contest and adapt to surviving opponents    | Plans remain revisable; an early purchase does not predetermine every fight |

Early play should establish a readable route and reveal the first commitment. Midgame should create reasons to choose between income, research and competing fronts. Endgame should turn sustained advantage into a credible brain threat without a long helpless cleanup. These are design goals, not invented target match durations: measure first mining, first contact, upgrades, cuts and eliminations before fixing pacing targets.

## Economy: sources, sinks and payback

Biomass buys space: neurons now, towers and repair later. Insight buys research. Particles are reusable military capacity, not a third mined resource. The current proposal starts each player at 60 Biomass, zero Insight and 128 particles split 64/64. Brain income is 1 Biomass and 0.5 Insight per second. Deposits provide stronger reasons to expand without making basic recovery depend on permanently retaining a mine.

| Decision                 | Current starting proposal                               | Strategic commitment                                                  |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Construct neuron         | 20 Biomass, 6 seconds, one active construction job      | Both money and production time are scarce                             |
| Mine Biomass             | 6/second across six sides; 1/second per eligible side   | Additional income requires reachable connected territory              |
| Mine Insight             | 3/second across six sides; 0.5/second per eligible side | Research routes compete with economic and tactical routes             |
| Growth Efficiency        | 10 Insight, 20 seconds; later neurons take 4 seconds    | Occupies the research slot instead of an early combat specialization  |
| Excitation or Insulation | 10 Insight, 20 seconds; mutually exclusive              | Stronger assault attack or guard absorption, not both                 |
| Refit mixture            | Up to eight idle brain particles per 1-second job       | Temporarily removes useful strength; requires return and redeployment |

A three-neuron route costs the starting 60 Biomass and at least 18 seconds of serial construction under ordinary conditions. Income accrues during that work; this is an illustrative commitment, not an exact tick-by-tick opening. If only the last tile adds one new Biomass mining side, its incremental 1/second income takes approximately 60 seconds to repay that route's 60 Biomass. Additional mining sides and tactical value alter the calculation. We must test whether routes pay back before first contact, rather than assume expansion is worthwhile.

Baseline Insight funds the first 10 Insight after 20 seconds, followed by 20 seconds of research. Growth Efficiency saves 2 seconds on each subsequent neuron; five later neurons save 10 construction seconds. That is a production-time saving, not a currency return or proof of a superior opening. An assault upgrade arriving during a threatened-junction fight may matter more.

Deposits remain neutral and inexhaustible. Two players with three connected sides each split the output; unoccupied or disconnected sides produce nothing. Queues and sites produce no income. Baseline income avoids a circular unlock where research is needed to reach the resource needed to buy that research. It does not guarantee survival under pressure.

After the small Phase 0 research catalogue is exhausted, Insight can accumulate without another sink. Record this prototype limitation. Do not add arbitrary repeatable upgrades solely to consume the surplus, or assume a finite particle pool by itself prevents economic snowballing.

## Construction, research and builder particles

Construction and research are the two main paid development activities, but not the whole gameplay. **Refit** is a third timed job family; **routing and combat** continuously use their results. Give each an explicit typed state machine instead of one generic job record with unrelated optional fields.

The current construction contract is manual route queuing with one active paid site, adjacent to the connected network. A disconnected job pauses. A started job never refunds its cost; queue previews reserve neither money nor territory. Construction and research run concurrently using different currencies and slots. These remain the Phase 0 rules until a builder change is approved.

The proposed builder makes expansion obey the same physical logic as combat: useful things travel through the network. It can make distant growth sensitive to latency and congestion. That benefit comes with additional path, cancellation, ownership, destruction and recovery rules.

| Option                               | Benefit                                                                       | Tradeoff                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Current connected-site timer         | Smallest system for proving economy and combat                                | Construction is less physically tied to particle logistics                 |
| Separate bounded builder stock       | Clear worker role and travel commitment; keeps combat composition independent | Adds scarce capacity and shared-link arbitration to explain                |
| Refit combat particles into builders | Expansion directly sacrifices part of fighting strength                       | Changes the pool/mix contracts; may collapse into one optimal worker count |

**Recommendation for review:** experiment with two reusable builders in a separate bounded worker stock while retaining one active construction site. One serves the current job; another allows reserve or later scheduling experiments, not a second construction slot. Both use physical routes and explicitly defined link capacity, but have no attack or absorption. Two is a hypothesis; one may be sufficient.

If accepted, the lifecycle should be paid site reserved → builder dispatched → arrival at a connected adjacent staging neuron → work → return. The worker cannot require a finished neuron at the destination to reach the frontier. Decide whether the site can be attacked before arrival, how link arbitration prevents construction starvation, and what happens on cancellation or disconnection. A builder must exist in exactly one compartment at a time; no free cancellation teleport or duplication.

Builder destruction/recovery remains unresolved and must not be silently inherited from assault/guard recovery. Debug also needs a decision: the recommendation is instant work after builder arrival, with real travel retained and labelled. That changes the current no-builder instant-construction behavior and requires an explicit plan update. Until then, builder C is a proposal, not an implemented roster entry or an amendment to the 128-particle conservation invariant.

## Research choices and adoption windows

The small initial catalogue is Growth Efficiency plus one of Excitation/Insulation. Both particle types remain available under either specialization. Research order matters because the single slot prevents simultaneous economic and combat upgrades. Expanding a tech tree should follow evidence of missing decisions, not a desired catalogue size.

| Choice                    | Useful situation                                                    | Cost and available response                                                  |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Growth Efficiency         | Many affordable future neurons; earlier route completion matters    | Delays combat specialization; pressure unfinished or undersupplied expansion |
| Excitation                | A supplied assault front can exploit more attack per spent particle | Forego Insulation; defend locally or stretch assault across multiple fronts  |
| Insulation                | Hold a valuable junction with guard stock                           | Forego Excitation; bypass or contest income outside the defended point       |
| Faster conduction, later  | Long routes need earlier reinforcement                              | Does not remove capacity bottlenecks or increase the particle pool           |
| Greater throughput, later | Shared edges constrain sustained supply                             | Does not reduce first-particle latency or create stock                       |

Do not assume both later technologies are necessary. Display the actual property changed, cost, duration, activation tick and effect on existing particles. A vague efficiency multiplier hides too many interactions. Immutable profiles mean old particles can remain unupgraded at a front while newly dispatched ones carry the benefit; the player should see that adoption wave without inspecting individual particles.

## Combat examples and control constraints

The current assay runs at 20 Hz, with four ticks per edge and eight launches per physical edge per tick shared across directions and types. Congestion and the no-same-tick-forwarding rule add delay. A priority requests relative demand, not a guaranteed percentage or instant buff. At most eight destinations have positive per-type priorities; shared storage means stronger demand for one type may leave less room for another.

On each one-second combat cadence, a connected completed node can spend up to four local particles attacking an adjacent hostile target. Remaining stock defends. Firing decisions are frozen before simultaneous damage, so iteration order cannot grant a first strike. Under this automatic rule, guards may also be spent on attack; “send guards here” is not a hold-fire order. That limitation needs an actual defensive scenario, not an assumption that all guard stock remains available to shield.

As an isolated arithmetic example, four base assault particles produce eight raw damage, absorbed by four available base guards. Four researched assault particles produce twelve, requiring six base guards for complete absorption. This excludes the defender's outgoing fire, other attackers and reservations; full scenarios must include them. It proves that properties can matter, not that either composition wins a match.

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

These are adaptable policies, not classes or a guaranteed counter cycle. Examples assume legal uncontested routes under the current values; opponents, connectivity and map geometry can invalidate them. The tower plan is later content.

1. **Economic branching:** spend up to the starting 60 Biomass on a short mining route, then buy more mining sides while keeping a junction reserve. The informed opponent pressures the narrow neck before the route repays itself. The builder can respond with a shorter route, earlier guards or a redundant connection. Fail the design if exposed expansion wins regardless of timely pressure, or if one cut makes every recovery impossible.
2. **Concentrated pressure:** take the short contact route and allocate assault to its last completed neuron, postponing a second economic branch. Excitation is useful only if newly upgraded supply reaches a live front. The response is a supplied guard junction or pressure elsewhere during the attacker's recovery. Fail if every map rewards the identical rush despite prepared defence, or if passive defence makes every early attack pointless.
3. **Junction defence into counterattack:** protect a valuable fork, perhaps with Insulation, while constructing an alternative route behind it. Redirect during the enemy's recovery window instead of feeding the same exchange forever. The response is to bypass the fork or contest outside income. Test whether automatic outgoing guard expenditure undermines the intended reserve; do not invent an unsupported hold-fire command to make the strategy work on paper.
4. **Research timing attack:** seek Insight and schedule Excitation so new-profile assault reaches a contested edge together. The plan needs research, available stock and dispatch, not merely a clicked upgrade. Opponents can contest Insight access or attack before its benefit reaches the front; the researcher can retreat to a shorter supply line. Fail if research determines every fight regardless of position or never pays off before elimination.
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

Use lighter slate terrain, strong silhouettes and ownership cues beyond colour. Assault and guard must remain distinguishable across all four owner palettes. Upgraded profiles need a secondary indication; players should never have to count tiny sprites to estimate local protection. Rendered particle count is a presentation budget, not an alternate authoritative quantity.

A node inspector should answer: is it connected, what is stored, what is incoming and when, what is congested, and why is work paused? Show submitted intent separately from applied state. A route preview is not territory; incoming stock is not a shield yet. Priorities should remain durable choices, not a rapid-toggling optimization contest.

Two useful human vignettes are a defended junction with guards still two hops away, and a profitable branch severed upstream. Ask players to predict arrival before the next firing tick, then explain lost income and choose a reconnection. If rules are correct but the explanation remains opaque, improve the display or simplify the rule before adding content.

Later graphs should connect decisions with consequences: income by source against spending; connected/disconnected territory; particle stocks by type and compartment; delivery delay and congestion; damage and absorption; research completion versus first useful upgraded arrival; cuts and elimination. Stock, interval flow and exact-tick events are different records. Balance changes alone cannot recover simultaneous income and spending. Phase 0 reserves stable IDs and typed outcomes; history and graph UI remain deferred.

| Failure to seek               | Probe and useful evidence                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Permanent mutual shielding    | Symmetric fronts, alternative paths and unequal research; retain draw/timeout replays                        |
| Economic runaway              | Give a small income lead, then let an informed opponent target expansion; inspect actual recovery options    |
| Free cut/recovery teleport    | Compare normal return against disconnection, destruction and cancellation                                    |
| Priority/refit thrashing      | Adversarial reversals, unchanged settled networks and shared-edge congestion                                 |
| Construction denial spam      | Competing claims, queue cancellation order, paid-site losses and action limits                               |
| Mandatory or useless research | Change order and pressure windows on matched maps; inspect when upgrades first matter                        |
| Routing starvation/deadlock   | Cycles, full targets, opposed traffic, cuts and reservation release; require progress where legally possible |
| Excessive attention cost      | Matched bounded-command policies, then phone/shared-TV human tests; count reversals without benefit          |

Do not hide stalemates with an unplanned sudden-death rule or economic flaws with automatic catch-up bonuses. Identify why the intended response was unavailable. If an endgame rule becomes necessary, propose it explicitly with its own visible incentives and tests.

## Evidence loop and acceptance

Phase 0 acceptance proves four-player data isolation, fair simultaneous resolution, reproducible economy/jobs/research, bounded work and checkpoint replay, plus conservation by particle type, travel latency, bottlenecks, cuts, upgrade boundaries and simultaneous mixed-type combat. It cannot certify combat balance. The assay must distinguish otherwise identical attacks with different supplied compositions and relevant research, and demonstrate that changing priorities cannot create an instant counter.

For subsequent strategy evaluation of the combat foundation:

1. Create reproducible fixtures for one corridor, a fork, a redundant route, a contested deposit and a tower junction. Check that each intended response is actually legal and timely.
2. Run the strategy families above, where their required features exist, plus variants and an adaptive policy through the same public observations/actions as players. Parameter sweeps expose brittle numbers; bots receive no privileged state or shorter command delays. Use declared fixed decision budgets. The tournament harness and tower policy are later work, not hidden Phase 0 requirements.
3. Pair every candidate ruleset with the baseline on the same map/seed/policy combinations and rotate seats. Separate two-player matchup matrices from three/four-player placement results. Include held-out maps and policy variants so tuning does not merely exploit the test bots.
4. Save rules/map hashes, source revision, policy versions, seeds, commands and replays. Report sample counts, uncertainty and draw/timeout rates; do not hide losses behind pooled averages. Equal win rates are not required for every strategy matchup, and are not proof of depth.
5. Inspect income/spending, connected territory, research completions, charge allocation/transit/utilization, queue delays, damage/shielding, cut duration, lead changes and elimination time. Attribute confirmed events by stable player ID and tick; rollback replaces history, never double-counts it. These support later endgame graphs without making telemetry authoritative gameplay state.
6. Human tests decide whether threats are readable, responses understandable, decisions interesting and winning enjoyable. Ask players to explain a loss and replay a different response; collect novice and experienced feedback, including shared-TV controls. Recheck after meaningful rules changes.

Reject or revise a design when one policy reliably dominates varied opponents and maps without an accessible response; when draws or unavoidable rushes dominate; when one spawn wins systematically; or when success depends on exhausting micromanagement. Predeclare numeric alert thresholds and workloads for each experiment, then review the replays behind alerts. Set match-duration and response-time targets after an observed prototype, not as invented balance evidence.

Scalability means we can add an interesting mechanic without breaking identity, determinism or testability, and can measure its consequences cheaply. It does not mean building a huge tech tree or claiming professional-RTS balance before people have played.
