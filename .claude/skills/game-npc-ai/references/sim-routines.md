# Daily routines for sim games (SimTower / Project Highrise / The Sims-style)

Thousands of tenants have to look busy, while costing almost nothing to run and staying deterministic so saves and replays work.

## Layered architecture
```
Schedule (archetype, minute of day)        → "it's 12:10, lunch block" (what, roughly when)
  └─ Utility over smart objects            → "the noodle bar on floor 14: closest, open, short queue" (where)
       └─ FSM / small BT executes          → walk → queue → use (duration) → leave (how)
            └─ Movement: floor graph + elevators (towers), or navmesh / crowd (open worlds)
Needs (hunger, energy, social, fun, hygiene, stress) decay over time and bias every layer.
```
- **Archetypes** hold the data: an office worker, a hotel guest, a condo resident, a janitor, a shop clerk. Each individual has an archetype id, a seed, a few personality floats and its needs.
- Most behaviour is **data, not code**: schedules, need decay rates, and what smart objects advertise.

## Schedules (minute of day, seeded jitter)
```ts
interface ScheduleBlock { from: number; to: number; activity: 'sleep' | 'commute' | 'work' | 'eat' | 'leisure'; place: string; flex: number }
export const OFFICE_WORKER: ScheduleBlock[] = [
  { from: 0,          to: 6 * 60 + 30, activity: 'sleep',   place: 'home',       flex: 0 },
  { from: 7 * 60 + 30, to: 9 * 60,    activity: 'commute', place: 'lobby',      flex: 20 },
  { from: 9 * 60,     to: 12 * 60,    activity: 'work',    place: 'office',     flex: 15 },
  { from: 12 * 60,    to: 13 * 60,    activity: 'eat',     place: 'restaurant', flex: 30 },
  { from: 13 * 60,    to: 17 * 60,    activity: 'work',    place: 'office',     flex: 15 },
];
// Roll jitter once per agent per day, so an agent is consistent within the day but crowds spread out
export const rollJitter = (s: ScheduleBlock[], rng: () => number) => s.map((b) => Math.round((rng() * 2 - 1) * b.flex));
export function blockAt(s: ScheduleBlock[], minute: number, jitter: number[]) {
  for (let i = 0; i < s.length; i++) { const b = s[i]; if (minute >= b.from + jitter[i] && minute < b.to + jitter[i]) return b; }
  return null;                       // unscheduled time → needs-driven utility picks a free-time activity
}
```
- **Jitter and flex are essential.** Without them, 400 office workers hit the lobby elevators at exactly 08:59, which is actually what SimTower is *about*. Tune flex per archetype to control rush-hour pressure.
- Use day-of-week variants (`weekday`, `weekend`) and events (a fire drill or a holiday) to override blocks.
- **Hard vs soft blocks**: work is hard (the agent is late, stress goes up, and they might quit), while leisure is soft (needs can override it).

## Smart objects (where the "AI" really lives)
Objects advertise what they satisfy, and agents pick by score. Adding a new object type then needs no NPC code.
```ts
type Need = 'hunger' | 'energy' | 'social' | 'fun' | 'hygiene' | 'stress';
interface SmartObject {
  id: number; kind: string; floor: number; x: number;
  advert: Partial<Record<Need, number>>;      // need delta per use (stress negative = relief)
  duration: number; capacity: number; open: [number, number];   // minutes
  users: number[]; queue: number[];
}
function scoreObject(a: Agent, o: SmartObject, minute: number): number {
  if (minute < o.open[0] || minute >= o.open[1]) return 0;
  let gain = 0;
  for (const k in o.advert) gain += Math.abs(o.advert[k as Need]!) * urgency(a.needs[k as Need]);   // urgency: 0..1 curve, e.g. x²
  const wait = Math.max(0, o.queue.length - (o.capacity - o.users.length)) * o.duration / o.capacity;
  const travel = travelMinutes(a, o);          // from the floor graph, cached per (floor, floor)
  return gain / (1 + (travel + wait) / 30);    // 30 = "minutes an agent will trade for full value". Tune it
}
```
- **Reservation**: when an agent picks an object, it joins the queue (or reserves a slot) *immediately*. Otherwise twenty agents choose the same free seat.
- On arrival: if it's full, wait in the queue (with patience) or re-pick. When done, apply the `advert` deltas, free the slot, and pop the queue.
- Use top-N weighted random (the agent's seeded RNG) among good options so that one restaurant doesn't get everyone.

## Towers: floor graph and elevators instead of a navmesh
- **Movement model**: a 1D walk along each floor (x position), with vertical moves only via **stairs** (1–2 floors, slow, stress cost), **escalators** (the lobby and mezzanine) and **elevator shafts**. Express routes stop only at sky lobbies, which is the core SimTower puzzle.
- **Route graph**: nodes are (floor, transfer point). Edges are walking (cost = |dx| / speed), stairs, and elevator rides (estimated as wait + floors × floorTime). Run Dijkstra per (origin floor, destination floor) and **cache** the result. Invalidate it only when the building changes.
- **Elevators are shared resources** with queues. LOOK scheduling: keep going while there are requests ahead, otherwise reverse. Here is a tested single-car decision function:
```ts
interface Car { floor: number; dir: 1 | -1 | 0; stops: Set<number>; load: number; cap: number }
interface Hall { up: Set<number>; down: Set<number> }
const ahead = (c: Car, h: Hall, dir: number, n: number) => { for (let f = c.floor + dir; f >= 0 && f < n; f += dir) if (c.stops.has(f) || h.up.has(f) || h.down.has(f)) return true; return false; };
const chooseDir = (c: Car, h: Hall, n: number): 1 | -1 | 0 => c.dir !== 0 && ahead(c, h, c.dir, n) ? c.dir : ahead(c, h, 1, n) ? 1 : ahead(c, h, -1, n) ? -1 : 0;
function shouldStop(c: Car, h: Hall, n: number) {
  if (c.stops.has(c.floor)) return true;
  if (c.load >= c.cap) return false;                                   // full: drop-offs only
  if ((c.dir >= 0 && h.up.has(c.floor)) || (c.dir <= 0 && h.down.has(c.floor))) return true;
  return !ahead(c, h, c.dir || 1, n) && (h.up.has(c.floor) || h.down.has(c.floor));   // end of run
}
// called on arrival at each floor
export function elevatorStep(c: Car, h: Hall, n: number): 'stop' | 'move' | 'idle' {
  if (shouldStop(c, h, n)) { c.stops.delete(c.floor); ((chooseDir(c, h, n) || c.dir) >= 0 ? h.up : h.down).delete(c.floor); c.dir = chooseDir(c, h, n); return 'stop'; }
  c.dir = chooseDir(c, h, n); if (!c.dir) return 'idle'; c.floor += c.dir; return 'move';
}
// From floor 0 with car stop 5, up-call at 3 and down-calls at 7 and 2 → stops 3, 5, 7, 2 (tested)
```
  - Boarding happens at a stop: passengers whose direction matches `car.dir` board up to `cap`. The rest re-press the call.
  - For several cars in a bank, assign each hall call to the car with the lowest estimated time to arrive (ETA, including its committed stops), and re-assign when a car fills.
- **Patience → stress**: waiting longer than `patience` (a personality value, ~2–5 game minutes) adds stress per minute. Tenants with high stress complain, show a red tint (SimTower), and eventually move out. This is the main feedback loop, so show it on screen.

## Time, events and sim LOD
- **Game time** is in minutes. 1 game minute = 1 sim tick, and time compression (×1, ×4, ×16, ×60) runs more ticks per frame or skips them with events.
- **Event-driven decisions**: most agents don't need a decision every tick. Each one stores `nextAt` (the end of its current activity, its arrival time, or its next schedule block), and a priority queue pops only the agents that are due. Tested: 300 agents over 7 days come to ~82k decisions in total, and repeated runs give the same hash.
```ts
const q = new Heap();                                       // Heap from navigation.md: push(priority, value), pop() → value
for (const a of agents) q.push(a.nextAt, a.id);
function advanceTo(minute: number) {                        // call with the new game time
  while (q.size && q.k[0] <= minute) {                      // k[0] is the smallest key (the next due time)
    const a = agents[q.pop()]; decide(a, a.nextAt); q.push(a.nextAt, a.id);   // decide() must set nextAt > now
  }
}
```
- **Sim LOD**:

| Level | Who | Update |
|---|---|---|
| L0 | On screen, near the camera | Every tick: steering, animation, crowd avoidance |
| L1 | In the building, off screen | Event-driven. Move along route segments with timers (teleport between transfer points), still occupying elevators and objects |
| L2 | Far, or in "offices on floor 40" | Statistical: occupancy from the schedule histogram. Spawn real L1 agents only when the player looks or an event needs them |

- Promotion and demotion must keep the *same* state (position along route, needs), so nobody visibly teleports when the camera pans.
- Needs decay analytically: `need = need0 − rate × (now − t0)`. Evaluate it lazily on decision, rather than ticking every agent every minute.

## Save, load and replay
- The whole sim state is plain data: agents (needs, plan, `nextAt`, route progress), objects (queues, users), cars, the clock and **the RNG state per stream**. That gives `JSON.stringify` save files, with no closures or class instances holding hidden state.
- Make RNG streams separate per agent (`mulberry32(worldSeed ^ agentId)`) or per subsystem, so adding a building doesn't reshuffle every tenant's day.
- Run the sim in a worker for big towers (see `game-physics/references/worker-and-determinism.md`). The renderer only reads positions.

## Verification
1. **Headless 7-day run** (Node/Vitest, no rendering) for several seeds (8–256). Assert these invariants:
   - no agent is in two places;
   - the number of users never exceeds an object's capacity;
   - no queue keeps growing forever;
   - every agent sleeps at some point each day;
   - no NaN needs;
   - elevator load never exceeds capacity.
2. **Histograms**: activity per hour (are people actually at lunch at 12–13?), p50/p95 elevator wait per bank, and stress distribution. Print them as text, or chart them in the debug panel. Rush-hour peaks should appear, not a flat line.
3. **Save/load equality**: run A for 3 days straight, and run B for 1.5 days, then save, load and finish. `hash(A) === hash(B)`.
4. **Perf budget**: decisions per game-minute at ×60 speed with 5k agents should stay under ~2 ms per frame. Log the queue length and decision time to the overlay (`game-debug-tools`).
5. **Debug view**: click a tenant to show their schedule bar, current block, needs bars, chosen object with its score breakdown, and route. Colour floors by average stress.
