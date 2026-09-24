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

## Four strategy hypotheses to test

These are behavioral policies, not selectable classes or a guaranteed counter cycle. Players should change plans as the map and opponents change.

| Strategy              | Strength and commitment                                                                           | Vulnerability and available response                                                                                                          | Observable design failure                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Wide economy          | More mining edges fund construction and later research; invests Biomass into long branches        | Limited charge covers more fronts; an opponent concentrates against a supply neck or contests the next deposit before payback                 | Expansion wins even when its exposed branch is identified and pressured, or losing one branch makes recovery impossible           |
| Concentrated pressure | Short route and focused charge can break an underfunded frontier early; delays extra income       | Other fronts and the recharge interval are weak; defend with a local reserve, reconnect around cuts, or pressure a different accessible front | Focus has no meaningful commitment, instant redirection negates responses, or early pressure always fails against passive defence |
| Fortified anchor      | Tower and local reserve protect a valuable junction; commits a ring, Biomass and charge           | Static investment cannot cover everything; bypass its range, contest unprotected deposits or cut its supply where the map permits             | Mandatory choke plus tower creates an unbreakable wall, or ring construction is never achievable in contested play                |
| Research investment   | Insight access buys a later logistical or defensive advantage; postpones immediate board strength | Construction and research time expose an early window; contest Insight edges or pressure before completion                                    | First upgrade decides every fight regardless of position, or its payback never arrives before typical elimination                 |

For each row, record both a successful example and a replay where the named response changes the outcome. A paper counter is insufficient when its cost, travel time or placement makes it unavailable in real matches. Counters should create opportunities, not guarantee victory despite poor execution.

## Maps, information and four-player play

- Validate geometry separately from balance. Compare per-spawn path cost to each resource, defensible mining edges, alternate routes, supply distances, tower access and distance to first hostile contact. Hex offset rectangles are not automatically rotationally fair.
- Use matched seat rotations for two, three and four players. An unused fourth corner may give one player uncontested economy in a three-player game; test that setup separately or withhold it as a competitive map.
- Begin combat testing with full information, matching shared-TV play. Fog later changes scouting, warning time and surprise strength; it needs its own balance evidence. Client-side fog on trusted peer state is presentation, not protection from a modified client.
- Four-player free-for-all introduces third-party attacks, temporary cooperation and kingmaking. Pairwise matchup fairness cannot establish FFA fairness. Measure victim selection, simultaneous attackers, lead changes, first-eliminated timing and whether avoiding all fights dominates; review social enjoyment with humans.
- Do not silently introduce anti-leader bonuses or elimination loot. First adjust map access, charge commitments and timing. A comeback should come from an available decision, while a decisive advantage should still end a match without a long helpless cleanup.
- Three priorities and explicit route queues should express intent without constant clicking. Measure command burden and whether rapid priority toggling outperforms considered play. Automation must obey the same action budgets and rules as humans.

## Evidence loop and acceptance

Phase 0 acceptance proves four-player data isolation, fair simultaneous resolution, reproducible economy/jobs/research, bounded work and checkpoint replay, plus conservation by particle type, travel latency, bottlenecks, cuts, upgrade boundaries and simultaneous mixed-type combat. It cannot certify combat balance. The assay must distinguish otherwise identical attacks with different supplied compositions and relevant research, and demonstrate that changing priorities cannot create an instant counter.

For subsequent strategy evaluation of the combat foundation:

1. Create reproducible fixtures for one corridor, a fork, a redundant route, a contested deposit and a tower junction. Check that each intended response is actually legal and timely.
2. Run the four policy families plus variants and an adaptive policy through the same public observations/actions as players. Parameter sweeps expose brittle numbers; bots receive no privileged state or shorter command delays. Use declared fixed decision budgets.
3. Pair every candidate ruleset with the baseline on the same map/seed/policy combinations and rotate seats. Separate two-player matchup matrices from three/four-player placement results. Include held-out maps and policy variants so tuning does not merely exploit the test bots.
4. Save rules/map hashes, source revision, policy versions, seeds, commands and replays. Report sample counts, uncertainty and draw/timeout rates; do not hide losses behind pooled averages. Equal win rates are not required for every strategy matchup, and are not proof of depth.
5. Inspect income/spending, connected territory, research completions, charge allocation/transit/utilization, queue delays, damage/shielding, cut duration, lead changes and elimination time. Attribute confirmed events by stable player ID and tick; rollback replaces history, never double-counts it. These support later endgame graphs without making telemetry authoritative gameplay state.
6. Human tests decide whether threats are readable, responses understandable, decisions interesting and winning enjoyable. Ask players to explain a loss and replay a different response; collect novice and experienced feedback, including shared-TV controls. Recheck after meaningful rules changes.

Reject or revise a design when one policy reliably dominates varied opponents and maps without an accessible response; when draws or unavoidable rushes dominate; when one spawn wins systematically; or when success depends on exhausting micromanagement. Predeclare numeric alert thresholds and workloads for each experiment, then review the replays behind alerts. Set match-duration and response-time targets after an observed prototype, not as invented balance evidence.

Scalability means we can add an interesting mechanic without breaking identity, determinism or testability, and can measure its consequences cheaply. It does not mean building a huge tech tree or claiming professional-RTS balance before people have played.
