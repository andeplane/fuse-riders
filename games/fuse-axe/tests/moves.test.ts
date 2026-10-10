import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  HERO_KINDS,
  JUMP,
  LEFT,
  RIGHT,
  UP,
  createWorld,
  decodeWorld,
  encodeWorld,
  spawnEnemy,
  step,
  toView,
  type EnemyState,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";

// The back attack, the jump attack and the throw (`step.ts`, "the back attack, the jump attack and the throw").
const { px } = T;
const FULL = T.ENEMY_HP.ravager,
  /** An ash ravager's full hit points against two heroes. */
  FULL2 = T.enemyMaxHp("ravager", 0, 2);
const hero = (world: World, index = 0) => world.heroes[index]!;
const enemy = (world: World, index = 0) => world.enemies[index]!;
const solo = (kind: HeroKind = "brakka") =>
  createWorld({ seed: 1, heroes: [{ seat: 0, kind }] });
/** A hero alone on the road with a ravager at each (dx, dy) px from it. */
function arena(kind: HeroKind, ...at: (readonly [number, number])[]): World {
  let world = solo(kind);
  const { x, y } = hero(world);
  for (const [dx, dy] of at)
    world = spawnEnemy(world, "ravager", x + px(dx), y + px(dy));
  return world;
}
/** `arena` with its first ravager reeling from a blow just taken: dazed. */
const dazed = (kind: HeroKind, ...at: (readonly [number, number])[]) => {
  const world = arena(kind, ...at);
  Object.assign(enemy(world), { state: "hurt", timer: 0 });
  return world;
};
const play = (world: World, rows: readonly number[]): World =>
  rows.reduce((w, bits) => step(w, [bits]), world);
const rest = (steps: number) => Array<number>(steps).fill(0);
/** Steps with seat 0 holding `held(index)` until `done`, within a bound. */
function until(
  world: World,
  done: (world: World) => boolean,
  held: (index: number) => number = () => 0,
): World {
  for (let index = 0; index < 1000 && !done(world); index++)
    world = step(world, [held(index)]);
  assert.ok(done(world), "never happened");
  return world;
}
const landed = (world: World) =>
  (["down", "dead"] as EnemyState[]).includes(enemy(world).state);

test("a lone Attack slashes and a lone Jump leaves the floor on the step it is pressed, and stays that move", () => {
  for (const kind of HERO_KINDS) {
    const slash = step(solo(kind), [ATTACK]);
    assert.deepEqual([hero(slash).state, hero(slash).timer], ["attack1", 0]);
    const jump = step(solo(kind), [JUMP]);
    assert.ok(hero(jump).state === "jump" && hero(jump).z > 0, kind);
    for (const world of [slash, jump]) {
      const later = play(world, rest(T.BACK_WINDOW + 1));
      assert.equal(hero(later).state, hero(world).state, kind);
      assert.equal(hero(later).timer, T.BACK_WINDOW + 1);
    }
  }
});

test("Attack and Jump pressed on the floor within BACK_WINDOW steps of each other, in either order, are the back attack", () => {
  /** `first`, then `second` pressed `gap` steps later (on the same step at 0). */
  const pair = (first: number, second: number, gap: number) =>
    hero(
      play(
        solo(),
        gap === 0 ? [first | second] : [first, ...rest(gap - 1), second],
      ),
    );
  for (let gap = 0; gap <= T.BACK_WINDOW; gap++)
    for (const [first, second] of [
      [ATTACK, JUMP],
      [JUMP, ATTACK],
    ] as const) {
      const after = pair(first, second, gap);
      // On the floor, from a standstill, facing as it was: a jump just begun comes back down.
      assert.deepEqual(
        [after.state, after.timer, after.z, after.vz, after.facing],
        ["backattack", 0, 0, 0, 1],
        `${first} then ${second} after ${gap}`,
      );
      assert.deepEqual([after.attackBuf, after.jumpBuf], [0, 0]);
    }
  // A step further apart, the slash goes on (the Jump waits in its buffer) and the jump's Attack is the jump attack.
  const late = T.BACK_WINDOW + 1;
  assert.equal(pair(ATTACK, JUMP, late).state, "attack1");
  assert.ok(pair(ATTACK, JUMP, late).jumpBuf > 0);
  assert.equal(pair(JUMP, ATTACK, late).state, "jumpattack");
  // Both waiting while the hero lands: within the window of each other they are the back attack as it comes free;
  // further apart, Attack goes first as it always has.
  const busy = (rows: number[]) => {
    let world = until(step(solo(), [JUMP]), (w) => hero(w).state === "land");
    world = play(world, [...rest(T.LAND_STEPS - 1 - rows.length), ...rows]);
    assert.equal(hero(world).state, "land");
    return hero(step(world, [0])).state;
  };
  assert.equal(busy([ATTACK, 0, JUMP]), "backattack");
  assert.equal(busy([JUMP, ...rest(T.BACK_WINDOW), ATTACK]), "attack1");
});

test("the back attack strikes behind the hero once, knocking down, and leaves what is in front or out of the lane alone", () => {
  for (const kind of HERO_KINDS) {
    const back = T.BACK_ATTACK[kind];
    let world = arena(kind, [-20, 0], [20, 0], [-20, 10]);
    const from = enemy(world).x;
    world = until(step(world, [ATTACK | JUMP]), (w) => w.fx.length > 0);
    assert.deepEqual(
      [hero(world).state, hero(world).timer, hero(world).facing],
      ["backattack", back.startup, 1],
    );
    world = play(world, rest(T.HEAVY_HITSTOP + back.active + 2));
    assert.deepEqual(
      world.enemies.map((e) => e.hp),
      [FULL - back.damage, FULL, FULL],
      kind,
    );
    assert.equal(enemy(world).state, "knockdown");
    assert.ok(enemy(world).x < from, "knocked further behind");
    assert.deepEqual(
      [hero(world).struck, hero(world).knockdowns, hero(world).damage],
      [[enemy(world).id], 1, back.damage],
    );
    assert.deepEqual(
      world.fx.map((fx) => fx.kind),
      ["heavy"],
    );
    world = until(world, (w) => hero(w).state === "idle");
    assert.equal(hero(world).facing, 1);
  }
});

test("a jump attack stabs down once a jump, knocking down what is under or ahead in its lane, and misses the rest", () => {
  for (const kind of HERO_KINDS) {
    const stab = T.JUMP_ATTACK[kind];
    /**
     * A ravager (dx, dy) px from the hero at height `z` px, stabbed at from a jump until the stab is over. It stands
     * where it is unless lined up with the hero, so none walks into the blade.
     */
    const stabbed = (dx: number, dy: number, z = 0) => {
      let world = arena(kind, [dx, dy]);
      Object.assign(enemy(world), { z: px(z), thinkAt: 10_000 });
      world = play(world, [JUMP, ...rest(T.BACK_WINDOW), ATTACK]);
      assert.deepEqual(
        [hero(world).state, hero(world).timer],
        ["jumpattack", 0],
      );
      return until(world, (w) => hero(w).state !== "jumpattack");
    };
    for (const [dx, dy] of [
      [0, 0],
      [10, 4],
      [30, -4],
    ] as const) {
      const world = stabbed(dx, dy);
      assert.equal(enemy(world).hp, FULL - stab.damage, `${kind} ${dx},${dy}`);
      assert.ok(["knockdown", "down"].includes(enemy(world).state));
      assert.deepEqual(
        [hero(world).state, hero(world).struck, hero(world).knockdowns],
        ["land", [enemy(world).id], 1],
      );
    }
    for (const [dx, dy, z] of [
      [-16, 0, 0],
      [46, 0, 0],
      [10, 10, 0],
      [10, 0, 90],
    ] as const)
      assert.equal(enemy(stabbed(dx, dy, z)).hp, FULL, `${kind} misses`);
    // Attack again in the air does not start the stab over.
    const mashed = play(solo(kind), [
      ...[JUMP, ...rest(T.BACK_WINDOW), ATTACK],
      ...[0, ATTACK, 0, ATTACK],
    ]);
    assert.deepEqual(
      [hero(mashed).state, hero(mashed).timer],
      ["jumpattack", 4],
    );
  }
  // The stab reaches `STAB_BELOW` under the hero's feet, where a swing's sweep from them would not.
  const above = (z: number) => {
    const world = arena("brakka", [5, 0]);
    Object.assign(hero(world), {
      state: "jumpattack",
      timer: T.JUMP_ATTACK.brakka.startup,
      z: px(z),
    });
    return enemy(step(world, [0])).hp;
  };
  assert.equal(above(55), FULL - T.JUMP_ATTACK.brakka.damage);
  assert.equal(above(62), FULL);
});

test("a run never makes the back attack: Attack and Jump together dash, and Attack in a running jump stabs at once", () => {
  for (const kind of HERO_KINDS) {
    const running = play(solo(kind), [RIGHT, 0, RIGHT, RIGHT]);
    assert.equal(hero(running).state, "run", kind);
    assert.equal(hero(step(running, [RIGHT | ATTACK | JUMP])).state, "dash");
    const leapt = step(running, [RIGHT | JUMP]);
    assert.equal(hero(leapt).state, "jump");
    const stab = step(leapt, [RIGHT | ATTACK]);
    assert.deepEqual(
      [hero(stab).state, hero(stab).vx],
      ["jumpattack", T.RUN[kind]],
    );
    assert.ok(hero(stab).z > hero(leapt).z, "it flies on");
  }
});

test("no move starts while the hero reels or flies from a blow, and presses made in hit-stop wait for it to end", () => {
  const base = solo();
  for (const [state, z] of [
    ["hurt", 0],
    ["knockdown", px(20)],
  ] as const) {
    const struck: World = {
      ...base,
      heroes: [{ ...hero(base), state, timer: 0, z, vz: px(1) }],
    };
    for (const bits of [ATTACK | JUMP, ATTACK, JUMP]) {
      const world = play(struck, [bits, 0, bits]);
      assert.equal(hero(world).state, state, `${state} ${bits}`);
    }
  }
  const stopped: World = {
    ...base,
    heroes: [{ ...hero(base), stopUntil: 4 }],
  };
  let world = play(stopped, [ATTACK | JUMP, 0, 0, 0]);
  assert.equal(hero(world).state, "idle");
  world = step(world, [0]);
  assert.equal(hero(world).state, "backattack");
});

test("walking into a dazed enemy, Attack grabs it and throws it over the shoulder to land behind, with the throw's damage", () => {
  const slash = T.COMBO.brakka[0].damage;
  let world = arena("brakka", [18, 0]);
  world = until(step(world, [ATTACK]), (w) => hero(w).state === "idle");
  assert.equal(enemy(world).state, "hurt");
  world = play(world, [RIGHT, RIGHT | ATTACK]);
  const h = hero(world),
    held = enemy(world);
  assert.deepEqual(
    [h.state, held.state, held.holder, held.y, held.x - h.x, held.facing],
    ["grab", "held", h.id, h.y, T.GRAB_HOLD, -1],
  );
  assert.deepEqual(
    [toView(world).heroes[0]!.anim, toView(world).enemies[0]!.anim],
    ["grab", "held"],
  );
  world = play(world, rest(T.GRAB_STEPS - 1));
  assert.deepEqual([hero(world).state, enemy(world).state], ["grab", "held"]);
  world = step(world, [0]);
  assert.deepEqual(
    [hero(world).state, enemy(world).state, hero(world).throws],
    ["throw", "thrown", 1],
  );
  assert.ok(enemy(world).z > T.THROW_LIFT && enemy(world).vx < 0);
  const from = hero(world).x;
  world = until(world, landed);
  assert.deepEqual(
    [enemy(world).state, enemy(world).hp, enemy(world).holder, enemy(world).z],
    ["down", FULL - slash - T.THROW_DAMAGE, 0, 0],
  );
  assert.ok(enemy(world).x < from - px(40), "it lands well behind");
  assert.deepEqual(
    [hero(world).damage, hero(world).knockdowns, hero(world).facing],
    [slash + T.THROW_DAMAGE, 1, 1],
  );
  until(world, (w) => hero(w).state === "idle");
});

test("only a dazed enemy close in front, in the lane, with the hero holding toward it, is grabbed; otherwise Attack slashes", () => {
  const after = (world: World, bits: number) => hero(step(world, [bits])).state;
  assert.equal(after(dazed("rhea", [16, 0]), RIGHT | ATTACK), "grab");
  assert.equal(after(dazed("rhea", [24, 4]), RIGHT | ATTACK), "grab");
  assert.equal(after(dazed("rhea", [-16, 0]), LEFT | ATTACK), "grab");
  for (const [what, world, bits] of [
    ["not holding toward it", dazed("rhea", [16, 0]), ATTACK],
    ["holding away", dazed("rhea", [16, 0]), LEFT | ATTACK],
    ["holding both ways", dazed("rhea", [16, 0]), LEFT | RIGHT | ATTACK],
    ["too far", dazed("rhea", [25, 0]), RIGHT | ATTACK],
    ["out of the lane", dazed("rhea", [16, 7]), RIGHT | ATTACK],
    ["behind", dazed("rhea", [-16, 0]), RIGHT | ATTACK],
    ["not dazed", arena("rhea", [16, 0]), RIGHT | ATTACK],
  ] as const)
    assert.equal(after(world, bits), "attack1", what);
  // A hero reeling right in front of another is never grabbed: heroes do not throw heroes.
  const pair = createWorld({
    seed: 1,
    heroes: [
      { seat: 0, kind: "gorm" },
      { seat: 1, kind: "rhea" },
    ],
  });
  Object.assign(hero(pair, 1), {
    x: hero(pair).x + px(16),
    y: hero(pair).y,
    state: "hurt",
  });
  assert.equal(hero(step(pair, [RIGHT | ATTACK, 0])).state, "attack1");
});

test("the thrown body knocks down each enemy on its feet it meets in its lane, once, and lands with the throw's damage once", () => {
  let world = dazed("gorm", [16, 0], [-30, 4], [-30, 24]);
  world = step(world, [RIGHT | ATTACK]);
  world = until(world, landed);
  const [body, struck, aside] = world.enemies;
  assert.equal(body!.hp, FULL - T.THROW_DAMAGE);
  assert.equal(struck!.hp, FULL - T.BODY_DAMAGE);
  assert.ok(["knockdown", "down"].includes(struck!.state));
  assert.ok(struck!.vx <= 0, "knocked the way the body flew");
  assert.equal(aside!.hp, FULL);
  assert.deepEqual(
    [hero(world).throws, hero(world).knockdowns, hero(world).damage],
    [1, 2, T.THROW_DAMAGE + T.BODY_DAMAGE],
  );
  // It lies as a knocked-down enemy does, and the throw's damage is not taken again.
  world = until(world, (w) => enemy(w).state === "getup");
  assert.equal(enemy(world).hp, FULL - T.THROW_DAMAGE);
  // A body at its last hit points lands dead, a knockout, and one it meets with few left is knocked out too.
  let ko = dazed("gorm", [16, 0], [-30, 4]);
  ko.enemies[0]!.hp = T.THROW_DAMAGE;
  ko.enemies[1]!.hp = T.BODY_DAMAGE;
  ko = until(step(ko, [RIGHT | ATTACK]), landed);
  assert.deepEqual(
    ko.enemies.map((e) => [e.hp, e.state]),
    [
      [0, "dead"],
      [0, "knockdown"],
    ],
  );
  assert.equal(ko.fx.at(-1)!.kind, "ko");
});

test("a body thrown toward either end of the road lands on it", () => {
  for (const [name, toward, setUp] of [
    ["start", RIGHT, (w: World) => (hero(w).x = px(20))],
    [
      "end",
      LEFT,
      (w: World) => {
        w.camX = T.CAMERA_END;
        hero(w).x = T.STAGE_LENGTH - px(20);
      },
    ],
  ] as const) {
    let world = solo("rhea");
    setUp(world);
    world = spawnEnemy(
      world,
      "ravager",
      hero(world).x + (toward === RIGHT ? px(16) : -px(16)),
      hero(world).y,
    );
    Object.assign(enemy(world), { state: "hurt", timer: 0 });
    world = step(world, [toward | ATTACK]);
    assert.equal(hero(world).state, "grab", name);
    for (let index = 0; !landed(world); index++) {
      assert.ok(index < 200, `${name}: never landed`);
      world = step(world, [0]);
      assert.ok(enemy(world).x >= 0 && enemy(world).x <= T.STAGE_LENGTH);
    }
    assert.equal(enemy(world).x, toward === RIGHT ? 0 : T.STAGE_LENGTH, name);
  }
});

test("no mace lands on a hero mid-grab; throwing, it can be hit", () => {
  let world = dazed("brakka", [16, 0], [30, 0]);
  world = step(world, [RIGHT | ATTACK]);
  /** The ravager in front swings its mace at the hero on the next step. */
  const swung = (w: World) => {
    const next = structuredClone(w);
    Object.assign(enemy(next, 1), {
      state: "windup",
      timer: T.RAVAGER[0].windup - 1,
      facing: -1,
      stopUntil: 0,
    });
    return hero(step(next, [0]));
  };
  assert.deepEqual(
    [swung(world).state, swung(world).hp],
    ["grab", T.HERO_HP.brakka],
  );
  world = until(world, (w) => hero(w).state === "throw");
  assert.equal(swung(world).state, "hurt");
  assert.ok(swung(world).hp < T.HERO_HP.brakka);
});

/**
 * Brakka grabs a dazed ravager and throws it into another; Rhea jumps, stabs a ravager, and back-attacks once she is
 * free. The inputs are recorded as they are played, so a replay folds exactly them.
 */
function brawl(): { start: World; inputs: number[][] } {
  let world = createWorld({
    seed: 4,
    heroes: [
      { seat: 0, kind: "brakka" },
      { seat: 1, kind: "rhea" },
    ],
  });
  const [a, b] = world.heroes;
  for (const [x, y] of [
    [a!.x + px(16), a!.y],
    [a!.x - px(30), a!.y + px(4)],
    [b!.x + px(12), b!.y],
    [b!.x - px(18), b!.y],
  ])
    world = spawnEnemy(world, "ravager", x!, y!);
  Object.assign(enemy(world), { state: "hurt", timer: 0 });
  const start = world,
    inputs: number[][] = [];
  for (let index = 0; index < 300; index++) {
    const free = hero(world, 1).state === "idle" && index > 60;
    const row = [
      index === 0 ? RIGHT | ATTACK : 0,
      index === 0 ? JUMP : index === 5 || free ? ATTACK | JUMP : 0,
    ];
    inputs.push(row);
    world = step(world, row);
  }
  return { start, inputs };
}

test("a rollback or a checkpoint mid-grab, mid-throw, mid-stab and mid-back-attack replays to the same world", () => {
  const { start, inputs } = brawl();
  const trail = [start];
  for (const held of inputs) trail.push(step(trail.at(-1)!, held));
  const straight = trail.at(-1)!;
  const fold = (world: World, from: number) =>
    inputs.slice(from).reduce<World>((w, held) => step(w, held), world);
  assert.deepEqual(fold(start, 0), straight, "the same inputs fold the same");
  const first = (what: string, found: (world: World) => boolean) => {
    const cut = trail.findIndex(found);
    assert.ok(cut > 0, `never ${what}`);
    return cut;
  };
  const cuts = [
    first("grabbed", (w) => w.heroes.some((h) => h.state === "grab")),
    first("held a while", (w) =>
      w.enemies.some((e) => e.state === "held" && e.timer > 4),
    ),
    first("thrown", (w) => w.enemies.some((e) => e.state === "thrown")),
    first("knocked down by a body", (w) =>
      w.enemies.some(
        (e) => e.state === "knockdown" && e.hp === FULL2 - T.BODY_DAMAGE,
      ),
    ),
    first("stabbed", (w) =>
      w.heroes.some((h) => h.state === "jumpattack" && h.struck.length > 0),
    ),
    first("struck behind", (w) =>
      w.heroes.some((h) => h.state === "backattack" && h.struck.length > 0),
    ),
  ];
  for (const cut of cuts) {
    const json = JSON.parse(JSON.stringify(trail[cut])) as World;
    assert.deepEqual(fold(json, cut), straight, `cut ${cut} through JSON`);
    const checkpoint = decodeWorld(structuredClone(encodeWorld(trail[cut]!)));
    assert.deepEqual(checkpoint, trail[cut], `cut ${cut} survives the codec`);
    assert.deepEqual(fold(checkpoint!, cut), straight, `cut ${cut} replays`);
  }
  // Brakka's throw and the ravager its body bowled over; Rhea's stab and her back attacks.
  assert.deepEqual(
    [hero(straight).throws, hero(straight).knockdowns, hero(straight).damage],
    [1, 2, T.THROW_DAMAGE + T.BODY_DAMAGE],
  );
  assert.ok(hero(straight, 1).knockdowns > 2);
});

test("a checkpoint whose grabs and throws do not add up is refused whole", () => {
  const { start, inputs } = brawl();
  let grabbing = start,
    flying = start;
  for (const held of inputs) {
    if (hero(grabbing).state !== "grab") grabbing = step(grabbing, held);
    if (enemy(flying).state !== "thrown") flying = step(flying, held);
  }
  const back = (world: World) =>
    decodeWorld(structuredClone(encodeWorld(world)));
  const changed = (world: World, change: (copy: World) => void) => {
    const copy = structuredClone(world);
    change(copy);
    return back(copy);
  };
  // A body still flies, credited to its thrower, after the thrower has been hit.
  assert.ok(changed(flying, (w) => (hero(w).state = "hurt")));
  for (const [what, world, change] of [
    ["a held enemy nobody grabs", grabbing, (w) => (hero(w).state = "idle")],
    ["a grab holding nothing", grabbing, (w) => (enemy(w).state = "hurt")],
    ["a held enemy with no holder", grabbing, (w) => (enemy(w).holder = 0)],
    ["held by an enemy", grabbing, (w) => (enemy(w).holder = enemy(w, 1).id)],
    [
      "two held by one hero",
      grabbing,
      (w) => Object.assign(enemy(w, 1), { state: "held", holder: hero(w).id }),
    ],
    ["an idle enemy with a holder", grabbing, (w) => (enemy(w, 1).holder = 1)],
    ["a body thrown by nobody", flying, (w) => (enemy(w).holder = 0)],
    [
      "a body thrown by an id not issued",
      flying,
      (w) => (enemy(w).holder = 99),
    ],
    ["negative throws", flying, (w) => (hero(w).throws = -1)],
    ["half a throw", flying, (w) => (hero(w).throws = 0.5)],
  ] as [string, World, (copy: World) => void][])
    assert.equal(changed(world, change), undefined, what);
});

test("a jump after a knockback or a dash leaves from a standstill: Attack within the window is the back attack, not the stab", () => {
  for (const kind of HERO_KINDS) {
    // Reeling from a blow nudges the hero along at more than a walk, until it is on its feet again.
    const struck = solo(kind);
    Object.assign(hero(struck), { state: "hurt", timer: 0, vx: px(3) });
    const reeled = until(struck, (w) => hero(w).state === "idle");
    // A dash slides at more than a run, and ends standing.
    const running = play(solo(kind), [RIGHT, 0, RIGHT, RIGHT]);
    const dashed = until(step(running, [RIGHT | ATTACK]), (w) => {
      assert.ok(["dash", "idle"].includes(hero(w).state), kind);
      return hero(w).state === "idle";
    });
    // Whatever speed a hero stands with, a take-off carries the held directions' alone.
    const leftover = solo(kind);
    Object.assign(hero(leftover), { vx: px(3), vy: px(3) });
    for (const [what, world] of [
      ["knocked back", reeled],
      ["dashed", dashed],
      ["with speed left over", leftover],
    ] as const) {
      const jumped = step(world, [JUMP]);
      assert.deepEqual([hero(jumped).state, hero(jumped).vx], ["jump", 0]);
      const after = step(jumped, [ATTACK]);
      assert.deepEqual(
        [hero(after).state, hero(after).z, hero(after).vx],
        ["backattack", 0, 0],
        `${kind} ${what}`,
      );
    }
  }
});

test("two heroes grabbing the same dazed enemy on the same step: the lower id gets it, and the other's Attack slashes the air", () => {
  let world = createWorld({
    seed: 1,
    heroes: [
      { seat: 0, kind: "gorm" },
      { seat: 1, kind: "rhea" },
    ],
  });
  const [first, second] = world.heroes;
  Object.assign(second!, { x: first!.x + px(6), y: first!.y });
  world = spawnEnemy(world, "ravager", first!.x + px(20), first!.y);
  Object.assign(enemy(world), { state: "hurt", timer: 0 });
  world = step(world, [RIGHT | ATTACK, RIGHT | ATTACK]);
  assert.deepEqual(
    [hero(world).state, hero(world, 1).state, enemy(world).holder],
    ["grab", "attack1", first!.id],
  );
  assert.ok(decodeWorld(structuredClone(encodeWorld(world))), "and it holds");
  // The slash's blade is out over the held body, which no blade lands on, and the throw is the first hero's.
  world = until(world, landed);
  assert.deepEqual(
    [enemy(world).hp, hero(world).damage, hero(world, 1).damage],
    [FULL2 - T.THROW_DAMAGE, T.THROW_DAMAGE, 0],
  );
  assert.deepEqual([hero(world).throws, hero(world, 1).throws], [1, 0]);
});

test("a thrower hit mid-throw still has its body fly on and land, and is credited for it", () => {
  let world = dazed("brakka", [16, 0], [30, 0]);
  world = step(world, [RIGHT | ATTACK]);
  world = until(world, (w) => hero(w).state === "throw");
  // The ravager in front swings its mace at the hero as the body leaves.
  Object.assign(enemy(world, 1), {
    state: "windup",
    timer: T.RAVAGER[0].windup - 1,
    facing: -1,
    stopUntil: 0,
  });
  world = step(world, [0]);
  assert.equal(hero(world).state, "hurt");
  assert.equal(enemy(world).state, "thrown");
  world = until(world, landed);
  assert.deepEqual(
    [enemy(world).state, enemy(world).holder, hero(world).damage],
    ["down", 0, T.THROW_DAMAGE],
  );
  assert.ok(decodeWorld(structuredClone(encodeWorld(world))));
});

test("every world a brawl of grabs, throws, stabs and back attacks reaches is one the checkpoint takes back whole, with the held body in its holder's hands", () => {
  const seen = { grab: 0, throw: 0, stab: 0, back: 0 };
  for (let seed = 1; seed <= 4; seed++) {
    let state = seed;
    const roll = (n: number) =>
      ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 8) % n;
    let world = createWorld({
      seed,
      heroes: HERO_KINDS.map((kind, seat) => ({ seat, kind })),
    });
    const held = HERO_KINDS.map(() => 0);
    for (let index = 0; index < 1500; index++) {
      // A crowd round the heroes, some of it dazed, for them to grab.
      if (index % 20 === 0 && world.enemies.length < 6) {
        const near = hero(world, roll(HERO_KINDS.length));
        world = spawnEnemy(
          world,
          "ravager",
          near.x + px(roll(80) - 40),
          near.y + px(roll(16) - 8),
        );
      }
      if (index % 7 === 0)
        for (const each of world.enemies)
          if (roll(3) === 0 && ["idle", "walk", "windup"].includes(each.state))
            Object.assign(each, { state: "hurt", timer: 0, stopUntil: 0 });
      // Each hero heads for the nearest enemy, pressing and releasing on alternate steps.
      for (const me of world.heroes) {
        const foe = [...world.enemies].sort(
          (a, b) =>
            Math.abs(a.x - me.x) +
            Math.abs(a.y - me.y) -
            (Math.abs(b.x - me.x) + Math.abs(b.y - me.y)),
        )[0];
        if (!foe || index % 2) {
          held[me.seat] = held[me.seat]! & ~(ATTACK | JUMP);
          continue;
        }
        const dx = foe.x - me.x,
          dy = foe.y - me.y,
          press = roll(100);
        held[me.seat] =
          (Math.abs(dx) > px(14) || roll(2) ? (dx > 0 ? RIGHT : LEFT) : 0) |
          (Math.abs(dy) > px(3) ? (dy > 0 ? DOWN : UP) : 0) |
          (press < 60
            ? ATTACK
            : press < 66
              ? JUMP
              : press < 70
                ? ATTACK | JUMP
                : 0);
      }
      const before = world;
      world = step(world, held);
      for (const [at, now] of world.heroes.entries()) {
        const was = hero(before, at);
        for (const state of ["grab", "throw"] as const)
          if (now.state === state && was.state !== state) seen[state]++;
        if (now.state === "jumpattack" && was.state !== "jumpattack")
          seen.stab++;
        if (now.state === "backattack" && was.state !== "backattack") {
          seen.back++;
          assert.deepEqual([now.z, now.vx, now.vy, now.vz], [0, 0, 0, 0]);
          assert.ok(!["run", "jumpattack"].includes(was.state));
          if (was.state === "jump")
            assert.ok(
              Math.abs(was.vx) <= T.WALK[was.kind].x,
              "no running jump",
            );
        }
      }
      for (const each of world.enemies)
        if (each.state === "held") {
          const holder = world.heroes.find((one) => one.id === each.holder)!;
          assert.deepEqual(
            [each.x - holder.x, each.y, each.z],
            [holder.facing * T.GRAB_HOLD, holder.y, 0],
          );
        }
      if (world.step % 3 === 0)
        assert.deepEqual(
          decodeWorld(structuredClone(encodeWorld(world))),
          world,
          `seed ${seed} step ${world.step}`,
        );
    }
  }
  assert.ok(seen.grab >= 3 && seen.throw >= 3, JSON.stringify(seen));
  assert.ok(seen.stab >= 3 && seen.back >= 3, JSON.stringify(seen));
});
