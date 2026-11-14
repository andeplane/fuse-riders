/**
 * Finds a ride that finishes each Elasto Fuse level and records it in `games/elasto-fuse/src/app/rides-data.ts`:
 *
 *   pnpm exec tsx scripts/elasto-fuse-solve.ts            # every level
 *   pnpm exec tsx scripts/elasto-fuse-solve.ts 3 5        # levels 3 and 5 (from 0)
 *   pnpm exec tsx scripts/elasto-fuse-solve.ts --beam 800 # a wider search for a stubborn level
 *
 * It is a beam search over held controls, a decision every 0.15 s, steering for each apple in the level's order (and
 * any waypoints listed below) and then the flower. The rides are evidence that a level can be finished and a golden
 * for the physics: `tests/rides.test.ts` replays them and expects the same finishing step. They are not good rides.
 * Rerun it after a change to the physics or a level (and bump `RULES`).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BRAKE,
  GAS,
  LEVELS,
  RULES,
  TURN,
  VOLT_LEFT,
  VOLT_RIGHT,
  createWorld,
  stepWorld,
  type World,
} from "../games/elasto-fuse/src/engine/index.js";
import { RECORDED } from "../games/elasto-fuse/src/app/rides-data.js";

const OUT = fileURLToPath(
  new URL("../games/elasto-fuse/src/app/rides-data.ts", import.meta.url),
);
/** Points to pass before the apple or flower with that index in the level's objects, for levels a straight line misleads. */
const WAYPOINTS: Record<string, Record<number, [number, number][]>> = {
  switchback: {
    2: [
      [9, 5.6],
      [4, 1],
    ],
  },
};

const DECISION = 12;
const ACTIONS = [
  0,
  GAS,
  BRAKE,
  GAS | VOLT_LEFT,
  GAS | VOLT_RIGHT,
  VOLT_LEFT,
  VOLT_RIGHT,
  TURN | GAS,
  TURN,
];
interface Node {
  world: World;
  /** Index of the target being steered for. */
  target: number;
  score: number;
  path: number[];
}
interface Target {
  x: number;
  y: number;
  /** The apple's bit, -1 for a waypoint, -2 for the flower. */
  apple: number;
}

const copy = (world: World): World => ({
  ...world,
  riders: world.riders.map((rider) => ({ ...rider, bike: { ...rider.bike } })),
});

function targetsOf(level: number): Target[] {
  const L = LEVELS[level]!;
  const targets: Target[] = [];
  let bit = 0;
  L.objects.forEach((object, index) => {
    if (object.kind === "killer") return;
    for (const [x, y] of WAYPOINTS[L.id]?.[index] ?? [])
      targets.push({ x, y, apple: -1 });
    targets.push({
      x: object.x,
      y: object.y,
      apple: object.kind === "apple" ? bit++ : -2,
    });
  });
  return targets;
}

function solve(
  level: number,
  beam: number,
  limit: number,
): number[] | undefined {
  const targets = targetsOf(level);
  let nodes: Node[] = [
    { world: createWorld(["solver"], level, 0), target: 0, score: 0, path: [] },
  ];
  for (let depth = 0; depth < limit; depth++) {
    const next = new Map<string, Node>();
    for (const node of nodes)
      for (const action of ACTIONS) {
        const world = copy(node.world);
        const rider = world.riders[0]!;
        let alive = true;
        for (let step = 0; step < DECISION && alive; step++) {
          // A turn is a press: hold it for the first step only.
          stepWorld(world, [step === 0 ? action : action & ~TURN], [true]);
          if (rider.status === 1) alive = false;
          if (rider.status === 2) return [...node.path, action];
        }
        if (!alive) continue;
        let target = node.target;
        const b = rider.bike;
        for (;;) {
          const t = targets[target]!;
          const reached =
            t.apple >= 0
              ? (rider.taken & (1 << t.apple)) !== 0
              : t.apple === -1 && Math.hypot(b.fx - t.x, b.fy - t.y) < 1.6;
          if (!reached) break;
          target++;
        }
        const t = targets[target]!;
        // Upright and facing the target is worth a little, so the search does not settle for lying on its side.
        const facing = (t.x - b.fx) * (b.flipped ? 1 : -1) > 0 ? 0 : 1.5;
        const score =
          target * 10000 -
          Math.hypot(b.fx - t.x, b.fy - t.y) -
          Math.abs(b.frot) * 0.5 -
          facing;
        const key = [
          target,
          Math.round(b.fx * 2),
          Math.round(b.fy * 2),
          Math.round(b.frot * 3),
          b.flipped,
          Math.round(Math.hypot(b.fvx, b.fvy) / 3),
        ].join();
        const known = next.get(key);
        if (!known || known.score < score)
          next.set(key, { world, target, score, path: [...node.path, action] });
      }
    nodes = [...next.values()].sort((a, b) => b.score - a.score).slice(0, beam);
    if (nodes.length === 0) return undefined;
  }
  return undefined;
}

/** A ride as run-length text: `bits*decisions` joined by spaces. */
const pack = (path: readonly number[]): string => {
  const runs: string[] = [];
  for (let i = 0; i < path.length;) {
    let j = i;
    while (j < path.length && path[j] === path[i]) j++;
    runs.push(`${path[i]}*${j - i}`);
    i = j;
  }
  return runs.join(" ");
};

const args = process.argv.slice(2);
const beamAt = args.indexOf("--beam");
const beam = beamAt >= 0 ? Number(args[beamAt + 1]) : 300;
const chosen = args
  .filter(
    (arg, index) => /^\d+$/.test(arg) && (beamAt < 0 || index !== beamAt + 1),
  )
  .map(Number);
/** The module's text around its data: everything up to the object, and the object itself. */
const HEAD = `/**
 * The solver's finishing rides, written by \`scripts/elasto-fuse-solve.ts\` (never by hand): for each level a list of
 * held bits, one per decision of \`decision\` steps, and the step the ride reaches the flower on. The tests replay them
 * as the golden for the physics and the levels; the menu's demo rides them behind the buttons.
 */
export const RECORDED: {
  rules: string;
  decision: number;
  rides: Record<string, { ride: string; steps: number }>;
} = `;
// What is recorded so far: a run for some levels keeps the others' rides.
const rides: Record<string, { ride: string; steps: number }> = {
  ...RECORDED.rides,
};
for (const [index, level] of LEVELS.entries()) {
  if (chosen.length && !chosen.includes(index)) continue;
  const started = Date.now();
  const path = solve(index, beam, 600);
  if (!path) {
    console.log(`${index} ${level.id}: no ride found`);
    delete rides[level.id];
    continue;
  }
  // Replay it for the exact finishing step.
  const world = createWorld(["solver"], index, 0);
  let steps = 0;
  replay: for (const action of path)
    for (let step = 0; step < DECISION; step++) {
      stepWorld(world, [step === 0 ? action : action & ~TURN], [true]);
      steps++;
      if (world.riders[0]!.status === 2) break replay;
    }
  rides[level.id] = { ride: pack(path), steps };
  console.log(
    `${index} ${level.id}: ${(steps / 80).toFixed(2)} s, searched ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}
writeFileSync(
  OUT,
  `${HEAD}${JSON.stringify({ rules: RULES, decision: DECISION, rides }, null, 2)};\n`,
);
