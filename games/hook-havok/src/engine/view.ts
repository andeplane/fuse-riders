import { BALL_RADII, BODY, HALF, S, ballField, type World } from "./world.js";
import { MAPS, type MapId } from "./maps.js";
import {
  createContest,
  COUNTDOWN_TICKS,
  ROUND_TICKS,
  type Contest,
} from "./contest.js";
export interface WorldView {
  map: MapId;
  contest: Contest & { rules: World["tuning"]["rules"]; seconds: number };
  keepers: KeeperView[];
  hit: {
    tick: number;
    by: string;
    target: string;
    x: number;
    y: number;
  } | null;
  localId?: string;
  experiment: World["tuning"]["experiment"];
  combat: {
    target: { x: number; feet: number; respawn: number } | null;
    balls: {
      id: number;
      x: number;
      y: number;
      radius: number;
      vx: number;
      vy: number;
    }[];
    field: readonly [number, number, number, number];
    hits: number;
    falls: number;
    impact: { tick: number; x: number; y: number };
  };
  tick: number;
  x: number;
  feet: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: -1 | 1;
  respawn: number;
  deaths: number;
  hook: { phase: World["hook"]["phase"]; x: number; y: number };
  platforms: readonly (readonly [number, number, number, number])[];
  body: { half: number; height: number };
  aim: { x: number; y: number };
}
export interface KeeperView {
  playing: boolean;
  id: string;
  slot: number;
  name: string;
  connected: boolean;
  shield: number;
  hits: number;
  body: WorldView;
}
export function toView(world: World): WorldView {
  return {
    map: world.tuning.map,
    contest: {
      ...createContest(world.tuning.rules),
      rules: world.tuning.rules,
      seconds: 0,
    },
    keepers: [],
    hit: null,
    experiment: world.tuning.experiment,
    combat: {
      target: world.combat.target
        ? {
            x: world.combat.target.x / S,
            feet: world.combat.target.feet / S,
            respawn: world.combat.target.respawn,
          }
        : null,
      balls: world.combat.balls.map((b) => ({
        id: b.id,
        x: b.x / S,
        y: b.y / S,
        radius: BALL_RADII[b.tier]!,
        vx: b.vx / S,
        vy: b.vy / S,
      })),
      field: ballField(world.tuning.experiment, world.tuning.map),
      hits: world.combat.hits,
      falls: world.combat.falls,
      impact: {
        tick: world.combat.impact.tick,
        x: world.combat.impact.x / S,
        y: world.combat.impact.y / S,
      },
    },
    tick: world.tick,
    x: world.x / S,
    feet: world.feet / S,
    vx: (world.vx * 60) / S,
    vy: (world.vy * 60) / S,
    grounded: world.grounded,
    facing: world.facing,
    respawn: world.respawn,
    deaths: world.deaths,
    hook: { phase: world.hook.phase, x: world.hook.x / S, y: world.hook.y / S },
    platforms: MAPS[world.tuning.map].platforms,
    body: { half: HALF / S, height: BODY / S },
    aim: { x: world.input.aimX, y: world.input.aimY },
  };
}
export function contestView(
  contest: Contest,
  rules: World["tuning"]["rules"],
): WorldView["contest"] {
  return {
    ...structuredClone(contest),
    rules,
    seconds: Math.ceil(
      Math.max(
        0,
        (contest.phase === "countdown" ? COUNTDOWN_TICKS : ROUND_TICKS) -
          contest.elapsed,
      ) / 60,
    ),
  };
}
