# Decision making: HFSM, behaviour trees, utility, GOAP, steering, squads

## Choosing (rule of thumb)
- **FSM**: under ~8 states, mostly reactive (patrol, chase, attack). The cheapest to debug.
- **HFSM**: states nest, e.g. `Combat{TakeCover, Shoot, Reload}` inside `Alive{Combat, Idle}` inside the top level. Use it when an FSM's transitions start to look like a full graph.
- **Behaviour tree**: prioritised, interruptible behaviours and reusable subtrees. Good for bosses and designer-authored enemies.
- **Utility**: many competing "wants" that must blend smoothly (sims, companions, animals). It also works *inside* a BT as a utility selector.
- **GOAP**: emergent multi-step plans over a small fact set (F.E.A.R.-style soldiers, colony-sim jobs). It costs more to run and is harder to explain.
- A common shipped combination: **utility picks the goal, a BT or HFSM executes it, steering and the crowd move the body.**

## HFSM in ~25 lines
```ts
interface St<C> { enter?(c: C): void; tick(c: C, dt: number): string | void; exit?(c: C): void; child?: Machine<C> }
export class Machine<C> {
  current: string; time = 0;
  constructor(public states: Record<string, St<C>>, initial: string, public name = 'root') { this.current = initial; }
  start(c: C) { this.states[this.current].enter?.(c); this.states[this.current].child?.start(c); }
  tick(c: C, dt: number, trace?: string[]) {
    this.time += dt; const s = this.states[this.current];
    trace?.push(`${this.name}:${this.current}`);
    const next = s.tick(c, dt);                  // the parent gets first say (it can pre-empt children)
    if (next && next !== this.current) { s.child?.stop(c); s.exit?.(c); this.current = next; this.time = 0; this.start(c); return; }
    s.child?.tick(c, dt, trace);
  }
  stop(c: C) { const s = this.states[this.current]; s.child?.stop(c); s.exit?.(c); }
}
```
`trace` (e.g. `["root:alive", "alive:combat", "combat:reload"]`) goes straight into the debug label. Godot: `LimboHSM` + `LimboState` (event-based transitions, nestable, code-only setup). For a handful of complex actors such as bosses or game-flow, XState v5 (`xstate`, MIT) gives you statecharts and a visual inspector, but it's too heavy to run per-frame for thousands of NPCs.

## Behaviour trees
- **Semantics**: `selector` = the first child that doesn't fail (priority). `sequence` = every child must succeed. Leaves are conditions (bool) or actions (SUCCEEDED, FAILED or RUNNING).
- **Interrupts**: in mistreevous, put guards on composites (`sequence while(CanSeePlayer) { … }`, `action [Run] until(Safe)`). When the guard fails, the running branch is aborted and the next selector option runs. That's how "drop everything, a grenade!" works.
- **Blackboard**: keep shared perception and memory on the agent object. BT leaves read and write it, and never query the world directly, which keeps them testable.
- **Reuse**: in mistreevous, `root [Combat] { … }` + `branch [Combat]` for subtrees, and `BehaviourTree.register('Combat', def)` for global subtrees and functions shared across agents.
- **Determinism**: pass `random` (seeded) and `getDeltaTime` (sim time). Debug with `onNodeStateChange` and `getTreeNodeDetails()`.
- Others on the web: `behaviortree` (Calamari/BehaviorTree.js, MIT, ~340★, 3.0.0-beta since 2023), or hand-roll ~150 lines.
- **Godot**:
  - **LimboAI** (limbonaut, MIT, ~3.1k★): BT editor, visual debugger, blackboard plans and HSM. Ships as a GDExtension (Godot 4.6+) or as a C++ module. Custom task: `extends BTAction` + `func _tick(delta: float) -> Status: return SUCCESS`.
  - **Beehave** (bitbrain, MIT, ~3.3k★, Beehave 2.10+ for Godot 4.5+): BTs built from nodes in the scene tree, with a debug view and perf monitors. Custom leaf: `extends ActionLeaf` + `func tick(actor, blackboard) -> int: return SUCCESS`.
  - Check each addon's docs for the exact signature of its current version.
- **Unity**: the official **Behavior** package (`com.unity.behavior`) has a behaviour graph editor, a blackboard, a debugger and custom C# nodes. See the Unity 6 docs for node base classes.

## Utility AI details
- Normalise every input to 0..1 *before* the curve: `need`, `distance / maxRange`, `health / maxHealth`, `enemiesNear / 5`.
- Curves: linear, quadratic `x²` (urgent only at the end), inverse `1 − x`, and logistic `1 / (1 + e^(−k(x − m)))` (a threshold with soft edges). In lockstep sims, replace `Math.exp` with a 256-entry lookup table (see `game-physics` determinism notes).
- Score with multiplication plus the compensation factor (SKILL.md Recipe 5). Any 0 vetoes the action, which is how you express hard preconditions.
- Anti-dithering: current-action inertia of 10–25%, minimum commitment times, and cooldowns per action.
- Variety: pick a weighted random among the top-N within 10% of the best score, using the agent's seeded RNG.
- The debug panel shows each candidate's final score and its per-consideration bars. Without it, tuning is guesswork.

## GOAP: compact planner (≤ 30 boolean facts as bits)
```ts
import { Heap } from './heap';                       // from navigation.md
type Facts = number;
export interface GoapAction { name: string; cost: number; preT: Facts; preF: Facts; addE: Facts; delE: Facts }
const ok = (s: Facts, a: GoapAction) => (s & a.preT) === a.preT && (s & a.preF) === 0;
const apply = (s: Facts, a: GoapAction) => (s | a.addE) & ~a.delE;
const popcount = (x: number) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
export function plan(start: Facts, goalT: Facts, goalF: Facts, actions: GoapAction[], maxNodes = 2000): GoapAction[] | null {
  const h = (s: Facts) => popcount((goalT & ~s) | (goalF & s));       // unmet goal facts
  const open = new Heap(), g = new Map<Facts, number>([[start, 0]]), from = new Map<Facts, [Facts, GoapAction]>();
  open.push(h(start), start);
  for (let n = 0; open.size && n < maxNodes; n++) {
    const s = open.pop();
    if ((s & goalT) === goalT && (s & goalF) === 0) {
      const out: GoapAction[] = []; for (let c = s; from.has(c); ) { const [p, a] = from.get(c)!; out.push(a); c = p; } return out.reverse();
    }
    for (const a of actions) {
      if (!ok(s, a)) continue;
      const t = apply(s, a), ng = g.get(s)! + a.cost;
      if (ng < (g.get(t) ?? Infinity)) { g.set(t, ng); from.set(t, [s, a]); open.push(ng + h(t), t); }
    }
  }
  return null;
}
// F = { HasKey: 1, DoorOpen: 2, AtChest: 4, HasLoot: 8, HasCrowbar: 16 }. With GetKey (4), GetCrowbar (1), UnlockDoor, ForceDoor (2), GoToChest and Loot,
// plan(0, F.HasLoot, 0, actions) → GetCrowbar, ForceDoor, GoToChest, Loot   (tested)
```
- Each action also has a runtime `run()` that can fail (the door is jammed). On failure, set the fact, then **replan**.
- Use *procedural* preconditions (`isReachable(target)`) only when executing a plan, not in the search, to keep planning cheap.
- Replan only when a relevant fact changes or a goal priority changes. Cache plans per (start, goal).
- Goal selection is usually utility: "which goal is most valuable now?" GOAP answers "how?".

## Steering and flocking

**Yuka** (if you want ready-made behaviours):
```ts
import * as YUKA from 'yuka';                         // 0.7.8, MIT. Own math types, so never mix them with three's
const em = new YUKA.EntityManager(), time = new YUKA.Time();
const v = new YUKA.Vehicle(); v.maxSpeed = 3; v.updateNeighborhood = true; v.neighborhoodRadius = 3;
mesh.matrixAutoUpdate = false;
v.setRenderComponent(mesh, (e, r) => r.matrix.copy(e.worldMatrix));
v.steering.add(new YUKA.WanderBehavior());
v.steering.add(new YUKA.SeparationBehavior()); v.steering.add(new YUKA.AlignmentBehavior()); v.steering.add(new YUKA.CohesionBehavior());
em.add(v);
// tick: em.update(time.update().getDelta());   (in a fixed sim, pass your DT instead)
```
Yuka also has `ArriveBehavior`, `PursuitBehavior`, `EvadeBehavior`, `FollowPathBehavior`, `ObstacleAvoidanceBehavior`, `OffsetPursuitBehavior` (formations), `InterposeBehavior`, `HideBehavior`, plus `StateMachine`, `Think`/`GoalEvaluator` (goal-driven agents), `FuzzyModule`, `Vision`, `MemorySystem`, `CellSpacePartitioning` and `Regulator` (throttle updates).

**Custom boids** for 1k–10k agents (struct-of-arrays plus a uniform spatial hash):
- Rebuild the hash each tick (cell = the perception radius). For each agent, scan the 9 (2D) or 27 (3D) neighbouring cells.
- `steer = wSep·Σ(away/d²) + wAli·(avgVel − vel) + wCoh·(centroid − pos) + wGoal·(flowDir·maxSpeed − vel)`. Clamp it to `maxForce`, integrate, clamp the speed.
- Render with `InstancedMesh` (or a WebGPU compute pass for 100k+, see `game-debug-tools` and the TSL compute examples).

## Squad and group tactics (what makes enemies feel smart)
- **Attack tokens** (the DOOM 2016 approach): a director hands out N "may attack the player" tokens. The others circle, flank or take cover. This stops twelve enemies attacking at once and is a big readability win.
- **Squad coordinator**: one blackboard per squad assigns roles (suppress, flank, advance) and picks cover points from a pre-baked set ranked by `exposure(player) − distance`.
- **Barks**: announce state changes ("Reloading!", "Flanking left!"). Players read them as intelligence. Use authored lines, not an LLM.
- **Telegraph and fairness**: show a wind-up for every attack, add a 0.2–0.4 s reaction delay before an NPC acts on a fresh sighting, and have aim error that decreases over time.
