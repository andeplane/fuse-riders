import test from "node:test";
import assert from "node:assert/strict";
import {
  createArena,
  syncKeepers,
  stepArena,
  encodeArena,
  decodeArena,
  type Arena,
  type Keeper,
} from "../src/engine/arena.js";
import {
  CLASSIC_TUNING,
  DEFAULT_TUNING,
  NEUTRAL,
  S,
  cancel,
  type Input,
  type Tuning,
} from "../src/engine/world.js";
import {
  bombArc,
  bombLaunch,
  bombSpawn,
  type Bomb,
} from "../src/engine/bomb.js";
import { throwPreview, toView } from "../src/engine/view.js";
import {
  CHAIN_TICKS,
  CHARGE_TICKS,
  COOLDOWN_TICKS,
  FUSE_TICKS,
  KO_RESPAWN,
  KO_SHIELD,
  MAX_BOMBS,
} from "../src/engine/bomb-rules.js";
import { COUNTDOWN_TICKS, ROUND_TICKS } from "../src/engine/contest.js";
import { parseInput, parseTuning } from "../src/engine/codec.js";
import {
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  hookGame,
  stepInputs,
  type Entry,
} from "../src/online/game.js";
import {
  ACTION,
  JOIN,
  PRESENCE,
  SnapshotAssembler,
  World,
  decodeSnapshot,
  encodeSnapshot,
  packMessage,
  unpackMessage,
  type StreamEntries,
} from "fuse-netcode";
import { canonArena } from "./fixtures/canon.js";

const BOMBS: Tuning = { ...CLASSIC_TUNING, bomb: "fuse" };
const members = ["amber", "blue", "green", "violet", "rose"].map(
  (id, slot) => ({ id, slot, connected: true, generation: 1 }),
);
function arena(n = 1, tuning: Tuning = BOMBS): Arena {
  const a = createArena(tuning);
  syncKeepers(a, members.slice(0, n));
  if (tuning.rules !== "free") {
    for (let i = 0; i < COUNTDOWN_TICKS; i++) stepArena(a);
    assert.equal(a.contest.phase, "active");
  }
  for (const k of a.keepers) k.spawnGuard = 0;
  return a;
}
const keeper = (a: Arena, id: string) => a.keepers.find((k) => k.id === id)!;
/** Stand a keeper on a ledge top at x (world units). */
function stand(k: Keeper, x: number, top = 810): void {
  Object.assign(k.world, {
    x: x * S,
    feet: top * S - 1,
    vx: 0,
    vy: 0,
    grounded: true,
  });
}
function press(a: Arena, k: Keeper, input: Partial<Input>, ticks = 1): void {
  k.world.input = { ...NEUTRAL, ...input };
  for (let i = 0; i < ticks; i++) stepArena(a);
}
/** Hold the bomb for `ticks`, then release toward (aimX, aimY). */
function throwBomb(
  a: Arena,
  k: Keeper,
  ticks: number,
  aimX: number,
  aimY: number,
): Bomb {
  press(a, k, { bomb: true }, ticks);
  press(a, k, { bomb: false, aimX, aimY });
  const bomb = a.bombs.find((b) => b.owner === k.id);
  assert.ok(bomb, "released charge throws");
  return bomb;
}
/** A bomb placed by a test, with the owner's cooldown it would have. */
function plant(a: Arena, owner: Keeper, x: number, y: number, fuse = 1): Bomb {
  const bomb: Bomb = {
    id: a.tick * 32 + owner.slot * 4,
    kind: "plain",
    owner: owner.id,
    x: Math.round(x * S),
    y: Math.round(y * S),
    vx: 0,
    vy: 0,
    fuse,
  };
  owner.bomb.cooldown = COOLDOWN_TICKS;
  a.bombs.push(bomb);
  a.bombs.sort((p, q) => p.id - q.id);
  return bomb;
}
/** A checkpoint of the arena, through JSON, decodes to exactly the same state. */
function assertRoundTrip(a: Arena, label?: string): Arena {
  const restored = decodeArena(JSON.parse(JSON.stringify(encodeArena(a))));
  assert.ok(restored, label);
  assert.equal(canonArena(restored), canonArena(a), label);
  return restored;
}

test("launch speed follows the charge: 450 at a tap, 950 when full, full stays full", () => {
  const speed = (charge: number) => {
    const v = bombLaunch(charge, 0, 0, 0, 0, 1000, 0, 1);
    return (Math.hypot(v.vx, v.vy) * 60) / S;
  };
  assert.ok(Math.abs(speed(1) - 450) < 0.1);
  assert.ok(Math.abs(speed(CHARGE_TICKS) - 950) < 0.1);
  assert.ok(speed(18) > 650 && speed(18) < 750);
  // Half the keeper's velocity carries into the throw.
  const carried = bombLaunch(1, 0, 0, 20 * S, -10 * S, 1000, 0, 1);
  assert.equal(carried.vx, Math.round((450 * S) / 60 + 10 * S));
  assert.equal(carried.vy, -5 * S);
  // Aim on the chest lobs forward and up at 45°.
  const lob = bombLaunch(1, 5 * S, 5 * S, 0, 0, 5, 5, -1);
  assert.ok(lob.vx < 0 && lob.vy < 0 && Math.abs(lob.vx - lob.vy) < 2);
});
test("charge→range: a tap throws about two keeper heights, a full charge about ten", () => {
  const range = (ticks: number) => {
    const a = arena();
    const k = a.keepers[0]!;
    stand(k, 700, 120); // the high anchor beam, open sky either side
    const chest = 120 - 31.2;
    const bomb = throwBomb(a, k, ticks, 1700, Math.round(chest - 1000));
    const startY = bomb.y;
    let last = { ...bomb };
    for (let t = 0; t < FUSE_TICKS - 1; t++) {
      stepArena(a);
      const now = a.bombs.find((b) => b.id === bomb.id)!;
      if (now.vy > 0 && now.y >= startY) {
        const f = (startY - last.y) / (now.y - last.y);
        return (last.x + (now.x - last.x) * f) / S - 700;
      }
      last = { ...now };
    }
    assert.fail("never came back to launch height");
  };
  const tap = range(1),
    half = range(18),
    full = range(CHARGE_TICKS);
  assert.ok(tap > 95 && tap < 120, `tap ${tap}`);
  assert.ok(full > 470 && full < 520, `full ${full}`);
  assert.ok(tap < half && half < full);
  assert.equal(range(90), full, "holding longer stays full");
});
test("bombs bounce off ledges losing speed, then roll and rest; walls bounce them back", () => {
  const a = arena();
  const owner = a.keepers[0]!;
  const bomb = plant(a, owner, 300, 700, FUSE_TICKS);
  bomb.vx = S;
  const apexes: number[] = [];
  let rising = false,
    top = Infinity,
    bounces = 0;
  for (let t = 0; t < 140; t++) {
    bomb.fuse = FUSE_TICKS;
    owner.bomb.cooldown = COOLDOWN_TICKS;
    const before = bomb.vy;
    stepArena(a);
    if (before > 0 && bomb.vy < 0) bounces++;
    if (bomb.vy < 0) rising = true;
    if (rising) top = Math.min(top, bomb.y);
    if (rising && bomb.vy >= 0) {
      apexes.push(800 * S - 1 - top);
      rising = false;
      top = Infinity;
    }
    assertRoundTrip(a, `tick ${t}`);
  }
  assert.ok(bounces >= 2, `bounces ${bounces}`);
  for (let i = 1; i < apexes.length; i++)
    assert.ok(apexes[i]! < apexes[i - 1]! * 0.4, "each bounce loses energy");
  assert.equal(bomb.vx, 0);
  assert.equal(bomb.vy, 0);
  assert.equal(bomb.y, 800 * S - 1, "resting on the terrace");
  assert.ok(bomb.x > 310 * S, "it rolled on after bouncing");
  const x = bomb.x;
  for (let t = 0; t < 10; t++) {
    bomb.fuse = FUSE_TICKS;
    stepArena(a);
  }
  assert.equal(bomb.x, x, "at rest it stays");
  const b = arena();
  plant(b, b.keepers[0]!, 30, 300, FUSE_TICKS).vx = -20 * S;
  stepArena(b);
  assert.ok(b.bombs[0]!.vx > 0 && b.bombs[0]!.vx <= 9 * S, "0.45 off the wall");
  assert.ok(b.bombs[0]!.x >= 10 * S);
});
test("the fuse runs 1.5 s from the throw; the blast knocks out every body in reach, the thrower included", () => {
  const a = arena(3);
  const [amber, blue, green] = a.keepers as [Keeper, Keeper, Keeper];
  stand(amber, 300);
  stand(blue, 350);
  stand(green, 420);
  throwBomb(a, amber, 1, 300, 900); // a tap straight down at the feet
  const thrown = a.tick;
  press(a, amber, {}, FUSE_TICKS - 1);
  assert.equal(a.bombs.length, 1);
  assert.equal(amber.world.respawn, 0);
  stepArena(a);
  assert.equal(a.bombs.length, 0);
  assert.equal(a.blasts.at(-1)!.tick, thrown + FUSE_TICKS);
  assert.equal(amber.world.respawn, KO_RESPAWN, "own blast");
  assert.equal(blue.world.respawn, KO_RESPAWN, "34 units away");
  assert.equal(green.world.respawn, 0, "104 units away survives");
  assert.deepEqual(
    a.knockouts.map((k) => [k.by, k.target]),
    [
      ["amber", "amber"],
      ["amber", "blue"],
    ],
  );
  assert.deepEqual(
    [amber.bomb.selfKnockouts, amber.bomb.knockouts, amber.bomb.thrown],
    [1, 1, 1],
  );
  assert.equal(amber.bomb.fate, "self");
  assert.deepEqual(
    [blue.bomb.bombed, blue.bomb.fate, blue.bomb.by],
    [1, "bomb", "amber"],
  );
  assert.equal(blue.world.deaths, 1);
  assertRoundTrip(a);
  // One second out, then one second of protection.
  press(a, blue, {}, KO_RESPAWN);
  assert.equal(blue.world.respawn, 0);
  assert.equal(blue.spawnGuard, KO_SHIELD);
  assert.equal(blue.world.feet, 810 * S - 1, "back at the spawn");
  // A fall still returns after half a second with half a second of cover.
  Object.assign(green.world, { x: 800 * S, feet: 954 * S, grounded: false });
  press(a, green, {}, 31);
  assert.equal(green.spawnGuard, 30);
  assert.equal(green.bomb.fate, "fall");
});
test("spawn protection shields a keeper from a blast", () => {
  const a = arena(2);
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  stand(amber, 300);
  stand(blue, 330);
  blue.spawnGuard = 5;
  plant(a, amber, 330, 790);
  stepArena(a);
  assert.equal(amber.world.respawn, KO_RESPAWN);
  assert.equal(blue.world.respawn, 0);
  assert.equal(blue.bomb.bombed, 0);
});
test("a blast pops orbs in reach once and sets off nearby bombs after a short delay", () => {
  const a = arena(2, { ...BOMBS, experiment: "ricochet" });
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  const ball = a.combat.balls[0]!;
  plant(a, amber, ball.x / S, ball.y / S);
  const second = plant(a, blue, ball.x / S + 70, ball.y / S, FUSE_TICKS);
  stepArena(a);
  const first = a.tick;
  assert.equal(a.combat.hits, 1);
  assert.deepEqual(
    a.combat.balls.map((b) => b.id),
    [2, 3],
    "children wait for the next tick",
  );
  assert.equal(second.fuse, CHAIN_TICKS);
  assertRoundTrip(a);
  press(a, amber, {}, CHAIN_TICKS);
  assert.equal(a.blasts.at(-1)!.id, second.id);
  assert.equal(a.blasts.at(-1)!.tick, first + CHAIN_TICKS);
  assert.equal(a.bombs.length, 0);
  assertRoundTrip(a);
});
test("cooldown: 2.5 s from the release, one bomb out per keeper, and a held button charges when it ends", () => {
  const a = arena();
  const k = a.keepers[0]!;
  stand(k, 300);
  throwBomb(a, k, CHARGE_TICKS, 1300, 500); // far off the terrace
  assert.equal(k.bomb.cooldown, COOLDOWN_TICKS);
  press(a, k, { bomb: true }, COOLDOWN_TICKS - 1);
  assert.equal(k.world.charge, 0, "no charge while cooling down");
  assert.ok(a.bombs.length <= 1);
  press(a, k, { bomb: true });
  assert.equal(k.bomb.cooldown, 0);
  assert.equal(k.world.charge, 1, "held through the end: charging now");
  press(a, k, { bomb: false, aimX: 700, aimY: 500 });
  assert.equal(k.bomb.thrown, 2);
  assert.equal(a.bombs.length, 1);
  // The hard cap refuses a throw and drops the charge without a cooldown.
  const b = arena(2);
  const [amber, blue] = b.keepers as [Keeper, Keeper];
  for (let i = 0; i < MAX_BOMBS; i++)
    b.bombs.push({
      id: i * 4,
      owner: `ghost${i}`,
      kind: "plain",
      x: 800 * S,
      y: 100 * S,
      vx: 0,
      vy: 0,
      fuse: FUSE_TICKS,
    });
  press(b, amber, { bomb: true }, 2);
  press(b, amber, { bomb: false });
  assert.equal(b.bombs.length, MAX_BOMBS);
  assert.equal(amber.world.charge, 0);
  assert.equal(amber.bomb.cooldown, 0);
  assert.equal(amber.bomb.thrown, 0);
  assert.equal(blue.bomb.thrown, 0);
});
test("impact bombs go off on touching a rival, never on the thrower; fuse bombs pass rivals by", () => {
  for (const variant of ["impact", "fuse"] as const) {
    const a = arena(2, { ...BOMBS, bomb: variant });
    const [amber, blue] = a.keepers as [Keeper, Keeper];
    stand(amber, 200);
    stand(blue, 330);
    // Full and flat from the chest: it reaches blue before it drops.
    throwBomb(a, amber, CHARGE_TICKS, 1200, 779);
    press(a, amber, {}, 20);
    if (variant === "impact") {
      assert.equal(a.bombs.length, 0);
      assert.equal(a.blasts[0]!.tick, a.tick - 13, "seven ticks of flight");
      assert.equal(blue.bomb.bombed, 1);
      assert.equal(amber.world.respawn, 0, "the blast was at blue");
    } else {
      assert.equal(a.bombs.length, 1);
      assert.equal(blue.world.respawn, 0);
    }
  }
});
test("a bomb that leaves the bottom fizzles; a departing keeper takes their bomb along", () => {
  const a = arena(2);
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  plant(a, amber, 800, 700, FUSE_TICKS); // over the open middle of the belfry
  press(a, amber, {}, 60);
  assert.equal(a.bombs.length, 0);
  assert.equal(a.blasts.length, 0);
  plant(a, blue, 300, 700, FUSE_TICKS);
  syncKeepers(a, members.slice(0, 1));
  assert.equal(a.bombs.length, 0);
  assertRoundTrip(a);
});
function competitive(rules: Tuning["rules"], n: number) {
  const a = arena(n, { ...BOMBS, rules });
  a.keepers.forEach((k, i) => stand(k, 150 + i * 160));
  return a;
}
test("score rules: a knockout +1 to the thrower and −2 to the victim; a self-knockout −1 on top", () => {
  const a = competitive("score", 2);
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  const score = (id: string) =>
    a.contest.entries.find((e) => e.id === id)!.score;
  plant(a, amber, blue.world.x / S, 790);
  stepArena(a);
  assert.equal(score("amber"), 1);
  assert.equal(score("blue"), -2);
  press(a, amber, {}, COOLDOWN_TICKS);
  stand(blue, 470);
  plant(a, amber, amber.world.x / S, 790);
  stepArena(a);
  assert.equal(score("amber"), 1 - 1 - 2);
  assert.equal(a.contest.phase, "active", "score rounds keep going");
  assertRoundTrip(a);
});
test("elimination: a knockout puts the victim out, and one blast can leave nobody standing", () => {
  const a = competitive("elimination", 3);
  const [amber, blue, green] = a.keepers as [Keeper, Keeper, Keeper];
  const out = () => a.contest.entries.filter((e) => e.out).map((e) => e.id);
  plant(a, amber, blue.world.x / S, 790);
  stepArena(a);
  assert.deepEqual(out(), ["blue"]);
  assert.equal(a.contest.phase, "active");
  assertRoundTrip(a);
  press(a, amber, {}, 2);
  stand(green, 200);
  stand(amber, 160);
  plant(a, green, 180, 790);
  stepArena(a);
  assert.deepEqual(out(), ["amber", "blue", "green"]);
  assert.equal(a.contest.phase, "over");
  assert.deepEqual(a.contest.winners, []);
  assert.equal(a.bombs.length, 0);
  assertRoundTrip(a);
});
test("free play keeps tallies without a contest; the off setting ignores the bomb button", () => {
  const a = arena(2);
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  plant(a, amber, blue.world.x / S, blue.world.feet / S - 20);
  stepArena(a);
  assert.equal(amber.bomb.knockouts, 1);
  assert.deepEqual(a.contest.entries, []);
  const off = arena(1, CLASSIC_TUNING);
  press(off, off.keepers[0]!, { bomb: true }, 10);
  press(off, off.keepers[0]!, { bomb: false });
  assert.equal(off.keepers[0]!.world.charge, 0);
  assert.equal(off.bombs.length, 0);
});

const host = "host";
function room(tuning: Tuning = BOMBS) {
  const r = createRoom("lobby", tuning);
  foldTick(
    r,
    host,
    stream([
      [1, 1, JOIN, host, "Keeper", 0, "keeper", 1],
      [2, 1, ACTION, "start", "match"],
    ]),
  );
  return r;
}
function stream(
  entries: Entry[],
  generation = 1,
): Map<string, StreamEntries<Entry>> {
  return new Map([[host, { generation, entries }]]);
}
const at = (tick: number, input: Partial<Input>, seq = 0): Entry => [
  tick * 4 + 10 + seq,
  tick,
  0,
  "match",
  1,
  { ...NEUTRAL, ...input },
];
test("a press and release inside one log tick still throws; held and cancelled charges do not", () => {
  const r = room();
  foldTick(r, host, stream([at(2, { bomb: true }), at(2, { aimX: 900 }, 1)]));
  assert.equal(r.simulation.bombs.length, 1, "tapped inside one log tick");
  assert.equal(r.simulation.keepers[0]!.bomb.thrown, 1);
  const held = room();
  for (let t = 2; t < 40; t++)
    foldTick(held, host, stream([at(t, { bomb: true })]));
  const w = held.simulation.keepers[0]!.world;
  assert.equal(w.charge, CHARGE_TICKS, "full and held");
  assert.equal(held.simulation.bombs.length, 0);
  // Disconnecting cancels the charge: nothing is thrown on the way out or back.
  foldTick(held, host, stream([[200, 40, PRESENCE, host, false, 1]]));
  assert.equal(w.charge, 0);
  foldTick(held, host, stream([[201, 41, PRESENCE, host, true, 1]]));
  foldTick(held, host, stream([at(42, {})]));
  assert.equal(held.simulation.bombs.length, 0);
  assert.equal(held.simulation.keepers[0]!.bomb.thrown, 0);
  // The engine's cancel drops a charge the same way.
  const c = arena();
  press(c, c.keepers[0]!, { bomb: true }, 5);
  cancel(c.keepers[0]!.world);
  stepArena(c);
  assert.equal(c.bombs.length, 0);
  assert.ok(decode(encode(held), held.tick));
});
test("inputs and settings carry the bomb field strictly", () => {
  assert.ok(parseInput({ ...NEUTRAL, bomb: true }));
  const { bomb: _bomb, ...old } = NEUTRAL;
  assert.equal(parseInput(old), undefined, "a pre-12 input is rejected");
  assert.equal(parseInput({ ...NEUTRAL, bomb: 1 }), undefined);
  assert.equal(parseTuning({ ...DEFAULT_TUNING, bomb: "sticky" }), undefined);
  assert.equal(DEFAULT_TUNING.bomb, "fuse");
});

function script(slot: number, tick: number): Input {
  const phase = (tick + slot * 37) % 240;
  return {
    ...NEUTRAL,
    move: (phase < 60 ? 1 : phase < 120 ? -1 : 0) as Input["move"],
    jump: phase % 50 === 5,
    fire: phase > 150 && phase < 175,
    bomb: phase % 80 < 4 + slot * 9,
    aimX: 800 + (slot - 1) * 200,
    aimY: 600 + slot * 60,
  };
}
test("deterministic replay through throws, bounces, chains and knockouts, restoring from checkpoints", () => {
  const tuning: Tuning = { ...DEFAULT_TUNING, map: "belfry" };
  const a = createArena(tuning),
    ghosts = members.slice(0, 3);
  syncKeepers(a, ghosts);
  let b = structuredClone(a);
  for (let tick = 0; tick < 1500; tick++) {
    for (const arena of [a, b])
      arena.keepers.forEach((k) => (k.world.input = script(k.slot, tick)));
    stepArena(a);
    stepArena(b);
    assert.deepEqual(encodeArena(a), encodeArena(b), `tick ${tick}`);
    const restored = assertRoundTrip(a, `tick ${tick} checkpoints`);
    if (tick % 17 === 0) b = restored;
  }
  const total = (f: (k: Keeper) => number) =>
    a.keepers.reduce((sum, k) => sum + f(k), 0);
  assert.ok(total((k) => k.bomb.thrown) > 20);
  assert.ok(total((k) => k.bomb.knockouts + k.bomb.selfKnockouts) > 0);
});
/** The encoded arena, loosely typed so tests can corrupt it. */
interface Encoded {
  tick: number;
  tuning: Tuning;
  bombs: (Bomb & { spin?: number })[];
  blasts: unknown[];
  knockouts: unknown[];
  keepers: {
    spawnGuard: number;
    bomb?: Record<string, unknown>;
    body: { deaths: number; charge: number; respawn: number; input: Input };
  }[];
}
/** A live room behind the netcode's rollback world, its log appended like a real one. */
function liveRoom(tuning: Tuning, until: number) {
  const world = new World(hookGame, createRoom("lobby", tuning), host, host),
    log = world.stream(host, 1);
  log.append(1, [JOIN, host, "Keeper", 0, "keeper", 1]);
  log.append(1, [ACTION, "start", "match"]);
  let through = 1;
  const play = (to: number) => {
    for (let t = through + 1; t <= to; t++)
      log.append(t, [
        0,
        "match",
        1,
        { ...NEUTRAL, bomb: t % 40 < 18, aimX: 700, aimY: 500 },
      ]);
    log.through = through = to;
    world.advance(to);
  };
  play(until);
  return { world, play };
}
test("checkpoints round-trip bombs; a corrupt one is refused whole and the live room is untouched", () => {
  const tuning: Tuning = { ...BOMBS, experiment: "ricochet" };
  const live = liveRoom(tuning, 29),
    twin = liveRoom(tuning, 29);
  assert.equal(live.world.state.simulation.bombs.length, 1);
  const saved = hash(live.world.state);
  // The restore path a joining or resyncing peer runs: snapshot chunks,
  // reassembly, the adapter's decode and the hash check.
  const assembler = new SnapshotAssembler(hookGame, 7);
  let bytes: Uint8Array | undefined;
  for (const chunk of encodeSnapshot(live.world, 7))
    bytes = assembler.accept(chunk)?.bytes ?? bytes;
  assert.ok(bytes);
  const restored = decodeSnapshot(hookGame, bytes, 7);
  assert.ok(restored);
  assert.equal(hash(restored.state), saved);
  const cases: [string, (s: Encoded) => void][] = [
    ["extra bomb key", (s) => (s.bombs[0]!.spin = 1)],
    ["fuse spent", (s) => (s.bombs[0]!.fuse = 0)],
    ["fuse too long", (s) => (s.bombs[0]!.fuse = FUSE_TICKS + 1)],
    ["fractional x", (s) => (s.bombs[0]!.x += 0.5)],
    ["x outside", (s) => (s.bombs[0]!.x = -1)],
    ["below the floor", (s) => (s.bombs[0]!.y = 941 * S)],
    ["too fast", (s) => (s.bombs[0]!.vx = 31 * S)],
    ["unknown owner", (s) => (s.bombs[0]!.owner = "stranger")],
    ["future id", (s) => (s.bombs[0]!.id = s.tick * 32 + 32)],
    [
      "two bombs, one owner",
      (s) => s.bombs.push({ ...s.bombs[0]!, id: s.bombs[0]!.id + 4 }),
    ],
    [
      "too many bombs",
      (s) =>
        (s.bombs = Array.from({ length: MAX_BOMBS + 1 }, (_, i) => ({
          ...s.bombs[0]!,
          id: i * 4,
          owner: `k${i}`,
        }))),
    ],
    ["bombs not an array", (s) => (s.bombs = {} as Encoded["bombs"])],
    ["owner cooled down", (s) => (s.keepers[0]!.bomb!.cooldown = 10)],
    [
      "owner cooldown under the fuse's",
      (s) =>
        (s.keepers[0]!.bomb!.cooldown =
          s.bombs[0]!.fuse + COOLDOWN_TICKS - FUSE_TICKS - 1),
    ],
    [
      "cooldown too long",
      (s) => (s.keepers[0]!.bomb!.cooldown = COOLDOWN_TICKS + 1),
    ],
    ["missing kit", (s) => delete s.keepers[0]!.bomb],
    ["bad fate", (s) => (s.keepers[0]!.bomb!.fate = "lava")],
    ["fate without deaths", (s) => (s.keepers[0]!.bomb!.fate = "fall")],
    ["bombed beyond deaths", (s) => (s.keepers[0]!.bomb!.bombed = 1)],
    [
      "bomb fate without thrower",
      (s) => {
        s.keepers[0]!.body.deaths = 1;
        s.keepers[0]!.bomb!.fate = "bomb";
      },
    ],
    [
      "charge while cooling",
      (s) => {
        s.keepers[0]!.body.charge = 3;
        s.keepers[0]!.body.input.bomb = true;
      },
    ],
    [
      "charge released",
      (s) => {
        s.keepers[0]!.bomb!.cooldown = 0;
        s.bombs = [];
        s.keepers[0]!.body.charge = 3;
      },
    ],
    [
      "charge too full",
      (s) => {
        s.keepers[0]!.bomb!.cooldown = 0;
        s.bombs = [];
        s.keepers[0]!.body.input.bomb = true;
        s.keepers[0]!.body.charge = CHARGE_TICKS + 1;
      },
    ],
    ["shield too long", (s) => (s.keepers[0]!.spawnGuard = KO_SHIELD + 1)],
    [
      "stale blast",
      (s) =>
        s.blasts.push({
          tick: s.tick - 40,
          id: 0,
          owner: host,
          kind: "plain",
          x: 0,
          y: 0,
        }),
    ],
    [
      "future knockout",
      (s) =>
        s.knockouts.push({
          tick: s.tick + 1,
          by: host,
          target: host,
          x: 0,
          y: 0,
        }),
    ],
    ["missing blasts", (s) => delete (s as Partial<Encoded>).blasts],
  ];
  for (const [name, edit] of cases) {
    // The live room's own encoding, edited in place: an encoder that shared
    // objects with the room would corrupt the room here.
    const fields = hookGame.checkpoint.encode(live.world.state);
    edit(fields[5] as Encoded);
    assert.equal(
      hookGame.checkpoint.decode(fields, live.world.state.tick),
      undefined,
      name,
    );
    assert.equal(hash(live.world.state), saved, `${name}: live room unchanged`);
  }
  // A snapshot carrying such a checkpoint is refused whole.
  const packed = unpackMessage(bytes) as unknown[];
  (packed[10] as Encoded).bombs[0]!.fuse = 0;
  assert.equal(decodeSnapshot(hookGame, packMessage(packed), 7), undefined);
  // Bomb state under the off setting is rejected by the arena itself.
  const good = hookGame.checkpoint.encode(live.world.state);
  const off = structuredClone(good[5]) as Encoded;
  off.tuning.bomb = "off";
  assert.equal(decodeArena(off), undefined);
  // Settings and snapshot tuning disagree about bombs: rejected too.
  const fields = structuredClone(good);
  (fields[3] as Tuning).bomb = "impact";
  assert.equal(decode(fields, live.world.state.tick), undefined);
  // Nothing leaked: the live room folds on exactly like its twin.
  assert.equal(hash(live.world.state), saved);
  live.play(110);
  twin.play(110);
  assert.equal(hash(live.world.state), hash(twin.world.state));
  assert.ok(live.world.state.simulation.keepers[0]!.bomb.thrown >= 2);
});
test("checkpoint bounds follow what play can reach: fall-length returns without bombs, no bomb state outside play", () => {
  const rejects = (a: Arena, edit: (s: Encoded) => void, name: string) => {
    const s = JSON.parse(JSON.stringify(encodeArena(a))) as Encoded;
    assert.ok(
      decodeArena(structuredClone(s)),
      `${name}: the unedited arena decodes`,
    );
    edit(s);
    assert.equal(decodeArena(s), undefined, name);
  };
  // Without bombs nothing protects or keeps a keeper out longer than a fall.
  const off = arena(1, CLASSIC_TUNING),
    faller = off.keepers[0]!;
  Object.assign(faller.world, { x: 800 * S, feet: 954 * S, grounded: false });
  stepArena(off);
  assert.equal(faller.world.respawn, 30);
  rejects(
    off,
    (s) => (s.keepers[0]!.body.respawn = 31),
    "respawn beyond a fall's",
  );
  press(off, faller, {}, 30);
  assert.equal(faller.spawnGuard, 30);
  rejects(
    off,
    (s) => (s.keepers[0]!.spawnGuard = 31),
    "spawn protection beyond a fall's",
  );
  // With bombs a knockout's longer return is reachable and accepted.
  const on = arena(2);
  const amber = on.keepers[0]!;
  stand(amber, 300);
  plant(on, amber, 300, 790);
  stepArena(on);
  assert.equal(amber.world.respawn, KO_RESPAWN);
  assertRoundTrip(on);
  press(on, amber, {}, KO_RESPAWN);
  assert.equal(amber.spawnGuard, KO_SHIELD);
  assertRoundTrip(on);
  // Before a round (one keeper waiting) there is no bomb state at all.
  const waiting = createArena({ ...BOMBS, rules: "score" });
  syncKeepers(waiting, members.slice(0, 1));
  press(waiting, waiting.keepers[0]!, { bomb: true }, 5);
  assert.equal(waiting.contest.phase, "waiting");
  assert.equal(waiting.keepers[0]!.world.charge, 0, "no charge before a round");
  rejects(
    waiting,
    (s) => {
      s.bombs.push({
        id: 0,
        owner: "amber",
        kind: "plain",
        x: 800 * S,
        y: 100 * S,
        vx: 0,
        vy: 0,
        fuse: 10,
      });
      s.keepers[0]!.bomb!.cooldown = COOLDOWN_TICKS;
    },
    "a bomb before the round",
  );
  rejects(
    waiting,
    (s) =>
      s.blasts.push({
        tick: s.tick,
        id: 0,
        owner: "amber",
        kind: "plain",
        x: 0,
        y: 0,
      }),
    "a blast before the round",
  );
  rejects(
    waiting,
    (s) => {
      s.keepers[0]!.body.input.bomb = true;
      s.keepers[0]!.body.charge = 3;
    },
    "a charge before the round",
  );
  // A disconnected keeper's charge was cancelled on the way out.
  const away = arena(2);
  syncKeepers(away, [members[0]!, { ...members[1]!, connected: false }]);
  rejects(
    away,
    (s) => {
      s.keepers[1]!.body.input.bomb = true;
      s.keepers[1]!.body.charge = 3;
    },
    "a charge while disconnected",
  );
  // The lobby holds a fresh arena that never runs.
  const lobby = createRoom("lobby", BOMBS);
  foldTick(lobby, host, stream([[1, 1, JOIN, host, "Keeper", 0, "keeper", 1]]));
  for (let t = 2; t < 6; t++) foldTick(lobby, host, stream([]));
  assert.equal(lobby.stage, "lobby");
  assert.ok(decode(encode(lobby), lobby.tick));
  const planted = encode(lobby),
    fields = planted[5] as Encoded;
  fields.bombs.push({
    id: 0,
    owner: host,
    kind: "plain",
    x: 800 * S,
    y: 100 * S,
    vx: 0,
    vy: 0,
    fuse: 10,
  });
  fields.keepers[0]!.bomb!.cooldown = COOLDOWN_TICKS;
  assert.ok(
    decodeArena(structuredClone(fields)),
    "free play's arena alone allows it",
  );
  assert.equal(decode(planted, lobby.tick), undefined, "a bomb in the lobby");
});
test("wall and ceiling bounces keep 0.8 of the tangential speed as well as 0.45 of the normal", () => {
  const g = Math.round((BOMBS.gravity * S) / 3600);
  const wall = arena();
  const side = plant(wall, wall.keepers[0]!, 30, 300, FUSE_TICKS);
  Object.assign(side, { vx: -20 * S, vy: -10 * S });
  stepArena(wall);
  assert.equal(side.vx, Math.round(20 * S * 0.45), "0.45 of the normal");
  assert.equal(side.vy, Math.round((-10 * S + g) * 0.8), "0.8 along the wall");
  // Under the belfry's lower-left ledge (stone 670–698, solid to 708).
  const roof = arena();
  const up = plant(roof, roof.keepers[0]!, 330, 712, FUSE_TICKS);
  Object.assign(up, { vx: 5 * S, vy: -10 * S });
  stepArena(roof);
  assert.equal(up.vy, -Math.round((-10 * S + g) * 0.45));
  assert.equal(up.vx, Math.round(5 * S * 0.8), "0.8 along the ceiling");
  assert.ok(up.y > 708 * S, "still under the ledge");
});
test("an impact bomb passes a spawn-protected rival by, as its blast would", () => {
  const a = arena(2, { ...BOMBS, bomb: "impact" });
  const [amber, blue] = a.keepers as [Keeper, Keeper];
  stand(amber, 150);
  stand(blue, 330);
  blue.spawnGuard = 20;
  plant(a, amber, 330, 790, FUSE_TICKS); // inside blue's body
  press(a, amber, {}, 3);
  assert.equal(a.bombs.length, 1, "no impact on a protected rival");
  assert.equal(a.blasts.length, 0);
  blue.spawnGuard = 0;
  stepArena(a);
  assert.equal(a.bombs.length, 0, "it goes off once they are exposed");
  assert.equal(blue.bomb.bombed, 1);
  assert.equal(amber.world.respawn, 0);
});
test("a bomb thrown from inside a ledge starts at its nearest face instead of passing through the stone", () => {
  // Crossroads' middle ledge: stone 690–910 × 660–688, solid to bombs 10 units out.
  assert.deepEqual(bombSpawn(800 * S, 670 * S, "crossroads"), {
    x: 800 * S,
    y: 650 * S - 1,
  });
  assert.deepEqual(bombSpawn(800 * S, 695 * S, "crossroads"), {
    x: 800 * S,
    y: 698 * S + 1,
  });
  assert.deepEqual(bombSpawn(684 * S, 680 * S, "crossroads"), {
    x: 680 * S - 1,
    y: 680 * S,
  });
  assert.deepEqual(
    bombSpawn(800 * S, 600 * S, "crossroads"),
    { x: 800 * S, y: 600 * S },
    "open air is left alone",
  );
  const a = arena(1, { ...BOMBS, map: "crossroads" });
  const k = a.keepers[0]!;
  // A keeper rising through that one-way ledge: the chest is in the stone.
  const inside = () =>
    Object.assign(k.world, {
      x: 800 * S,
      feet: 700 * S,
      vx: 0,
      vy: 0,
      grounded: false,
    });
  inside();
  press(a, k, { bomb: true }, 3);
  inside();
  press(a, k, { bomb: false, aimX: 800, aimY: 900 }); // straight down
  const bomb = a.bombs[0]!;
  assert.equal(bomb.y, 650 * S - 1, "it enters flight on the top face");
  assert.ok(bomb.vy > 0);
  for (let t = 0; t < 40; t++) {
    stepArena(a);
    assert.ok(bomb.y < 650 * S, `tick ${t}: above the stone at ${bomb.y / S}`);
  }
  // The preview starts where the bomb does.
  const arc = bombArc(3, 800, 669, 0, 0, 800, 900, 1, 1800, "crossroads");
  assert.ok(arc.length && arc.every((p) => p.y <= 650));
});
test("a release and re-press inside one log tick still throws; each bomb change gets an engine step", () => {
  const r = room();
  for (let t = 2; t < 12; t++)
    foldTick(r, host, stream([at(t, { bomb: true })]));
  assert.equal(r.simulation.keepers[0]!.world.charge, 30);
  foldTick(
    r,
    host,
    stream([at(12, { aimX: 900 }), at(12, { bomb: true, aimX: 900 }, 1)]),
  );
  assert.equal(r.simulation.bombs.length, 1, "thrown on the release");
  assert.equal(r.simulation.keepers[0]!.bomb.thrown, 1);
  const bombs = (from: Partial<Input>, ...held: boolean[]) =>
    stepInputs(
      { ...NEUTRAL, ...from },
      held.map((bomb) => ({ ...NEUTRAL, bomb })),
    ).map((i) => i.bomb);
  assert.deepEqual(bombs({ bomb: true }, false, true), [false, true, true]);
  assert.deepEqual(bombs({}, true, false), [true, false, false], "a tap");
  assert.deepEqual(bombs({}, true, false, true), [true, false, true]);
  assert.deepEqual(
    bombs({ bomb: true }, false, true, false, true),
    [false, true, true],
    "more changes than steps: the first two, then the last state",
  );
  assert.deepEqual(bombs({ bomb: true }), [true, true, true], "held");
  // The release step aims where the release did, although a later input in
  // the tick (W lifted after K) moved the aim.
  const lifted = stepInputs(
    { ...NEUTRAL, bomb: true, aimX: 1300, aimY: -300 },
    [
      { ...NEUTRAL, aimX: 1300, aimY: -300 },
      { ...NEUTRAL, aimX: 300, aimY: -300 },
    ],
  );
  assert.deepEqual(
    lifted.map((i) => [i.bomb, i.aimX]),
    [
      [false, 1300],
      [false, 300],
      [false, 300],
    ],
  );
  const tapped = stepInputs(NEUTRAL, [
    { ...NEUTRAL, bomb: true, aimX: 100 },
    { ...NEUTRAL, aimX: 200 },
    { ...NEUTRAL, bomb: true, aimX: 300 },
    { ...NEUTRAL, bomb: true, aimX: 400 },
  ]);
  assert.deepEqual(
    tapped.map((i) => [i.bomb, i.aimX]),
    [
      [true, 400],
      [false, 200],
      [true, 400],
    ],
    "a tap then a new charge: the tap throws along its own release",
  );
  const late = stepInputs({ ...NEUTRAL, bomb: true }, [
    { ...NEUTRAL, aimX: 100 },
    { ...NEUTRAL, bomb: true, aimX: 200 },
    { ...NEUTRAL, aimX: 300 },
    { ...NEUTRAL, aimX: 400 },
  ]);
  assert.deepEqual(
    late.map((i) => [i.bomb, i.aimX]),
    [
      [false, 100],
      [true, 400],
      [false, 300],
    ],
    "the last release, on the last step",
  );
  // Other buttons keep press edges only.
  const hook = stepInputs({ ...NEUTRAL, fire: true }, [
    { ...NEUTRAL },
    { ...NEUTRAL, fire: true },
  ]);
  assert.deepEqual(
    hook.map((i) => i.fire),
    [true, true, true],
    "a hook released and pressed again inside one tick stays held",
  );
  const hop = stepInputs(NEUTRAL, [{ ...NEUTRAL, jump: true }, NEUTRAL]);
  assert.deepEqual(
    hop.map((i) => i.jump),
    [true, false, false],
  );
});
test("elimination: a bomb outlives its thrower's fall and still knocks rivals out; the round resolves", () => {
  for (const draw of [false, true]) {
    const a = competitive("elimination", 3);
    const [amber, blue, green] = a.keepers as [Keeper, Keeper, Keeper];
    const out = () => a.contest.entries.filter((e) => e.out).map((e) => e.id);
    if (draw) stand(green, 350);
    plant(a, amber, 330, 790, 4); // blue stands at 310
    // The thrower falls out of the arena with the bomb still burning.
    Object.assign(amber.world, { x: 800 * S, feet: 954 * S, grounded: false });
    stepArena(a);
    assert.deepEqual(out(), ["amber"], "the thrower fell");
    assert.equal(a.bombs.length, 1, "their bomb burns on");
    assertRoundTrip(a);
    press(a, blue, {}, 3);
    assert.equal(a.blasts.at(-1)!.owner, "amber");
    assert.deepEqual([blue.bomb.fate, blue.bomb.by], ["bomb", "amber"]);
    assert.equal(amber.bomb.knockouts, draw ? 2 : 1, "credited to the thrower");
    assert.equal(amber.world.deaths, 1);
    assert.deepEqual(
      out().sort(),
      draw ? ["amber", "blue", "green"] : ["amber", "blue"],
    );
    assert.equal(a.contest.phase, "over");
    assert.deepEqual(a.contest.winners, draw ? [] : ["green"]);
    assert.equal(a.bombs.length, 0);
    assertRoundTrip(a);
  }
});
test("the arc preview traces the flight a release would make", () => {
  const a = arena();
  const k = a.keepers[0]!;
  stand(k, 480); // clear of the ledge above the terrace
  press(a, k, { bomb: true }, 20);
  const aim = { x: 1200, y: 400 };
  const preview = throwPreview(toView(k.world), aim);
  press(a, k, { bomb: false, aimX: aim.x, aimY: aim.y });
  const bomb = a.bombs[0]!,
    flight: { x: number; y: number }[] = [];
  for (let t = 0; t < 2 * preview.length && a.bombs.length; t++) {
    stepArena(a);
    flight.push({ x: bomb.x / S, y: bomb.y / S });
  }
  assert.ok(preview.length > 5, `${preview.length} dots`);
  // A dot every other tick: dot i is the bomb after 2i + 2 ticks of flight.
  // The last dot is where it first meets stone, which bounces are not.
  preview.slice(0, -1).forEach((dot, i) => {
    const at = flight[2 * i + 1]!;
    assert.ok(
      Math.abs(dot.x - at.x) < 0.01 && Math.abs(dot.y - at.y) < 0.01,
      `dot ${i}: ${JSON.stringify([dot, at])}`,
    );
  });
});
test("a charge is dropped, never thrown, when its keeper is eliminated or the round ends", () => {
  const a = competitive("elimination", 3);
  const amber = a.keepers[0]!;
  press(a, amber, { bomb: true }, 10);
  assert.equal(amber.world.charge, 10);
  Object.assign(amber.world, { x: 800 * S, feet: 954 * S, grounded: false });
  press(a, amber, { bomb: true });
  assert.ok(a.contest.entries.find((e) => e.id === "amber")!.out);
  assert.equal(amber.world.charge, 0, "the fall drops it");
  press(a, amber, { bomb: false, aimX: 900, aimY: 500 }, 5);
  assert.equal(a.bombs.length, 0);
  assert.equal(amber.bomb.thrown, 0);
  assertRoundTrip(a);
  // The end of a score round cancels every charge.
  const b = competitive("score", 2);
  const blue = b.keepers[1]!;
  press(b, blue, {}, ROUND_TICKS - 20);
  press(b, blue, { bomb: true }, 10);
  assert.equal(b.contest.phase, "active");
  assert.equal(blue.world.charge, 10);
  while (b.contest.phase === "active") press(b, blue, { bomb: true });
  assert.equal(blue.world.charge, 0, "the round's end drops it");
  press(b, blue, { bomb: false, aimX: 900, aimY: 500 }, 5);
  assert.equal(b.bombs.length, 0);
  assert.equal(blue.bomb.thrown, 0);
  assertRoundTrip(b);
});
