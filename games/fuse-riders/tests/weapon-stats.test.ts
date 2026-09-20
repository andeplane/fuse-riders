import assert from "node:assert/strict";
import test from "node:test";
import {
  BOMB_BLAST_RANGE,
  eliminatePlayer,
  RIDER_COLORS,
  addPlayer,
  createGame,
  resetMatch,
  returnToLobby,
  startMatch,
  startNextRound,
  step,
  toView,
  type BombState,
  type GameState,
  type InputIntent,
  type PlayerState,
} from "../src/engine/game.js";
import { BOMB_FLIGHT_TICKS } from "../src/engine/bomb-launch.js";
import { volleyAngles } from "../src/engine/launch-modifiers.js";
import type { Weapon } from "../src/engine/shot-log.js";
import {
  defaultRoomSettings,
  type RoomSettings,
} from "../src/engine/room-settings.js";
import { roundShotEvents } from "../src/online/analytics.js";
import { classicSettings } from "./fixtures/classic-settings.js";
import { setArmed } from "./fixtures/rider-state.ts";
import { isArmed } from "../src/engine/weapons.ts";

/**
 * The round's shot log: every trigger pull, labelled with the powerup it spent, and every rider it killed. Shots are
 * logged where a launch consumes the powerup and kills where an elimination is credited; analytics turns a decided
 * round's log into one `Kill` per kill and one `Miss` per pull that killed nobody.
 */
function fixture(
  riders = 2,
  settings: RoomSettings = classicSettings(),
): {
  game: GameState;
  player: PlayerState;
  victim: PlayerState;
  input: (intent: Partial<InputIntent>) => void;
} {
  const game = createGame("weapons", settings);
  for (let slot = 0; slot < riders; slot += 1)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: RIDER_COLORS[slot]!,
    });
  startMatch(game);
  while (game.phase === "countdown") step(game, new Map());
  // No drops or scenery of its own: every powerup is armed on purpose, and every shot has a clear board.
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  game.obstacles = [];
  const player = game.players.get("p0")!;
  Object.assign(player, { x: 400, y: 450, angle: 0, trail: [] });
  for (let slot = 1; slot < riders; slot += 1)
    Object.assign(game.players.get(`p${slot}`)!, {
      x: 900 + slot * 120,
      y: 200 * slot,
      angle: 0,
      trail: [],
    });
  return {
    game,
    player,
    victim: game.players.get("p1")!,
    input: (intent) =>
      step(
        game,
        new Map([
          ["p0", { left: false, right: false, bomb: false, ...intent }],
        ]),
      ),
  };
}

const tally = (weapons: readonly Weapon[]): Partial<Record<Weapon, number>> => {
  const counts: Partial<Record<Weapon, number>> = {};
  for (const weapon of weapons) counts[weapon] = (counts[weapon] ?? 0) + 1;
  return counts;
};
/** This round's pulls by a rider, and the kills they made, each counted under the weapon of the pull. */
const shots = (game: GameState, playerId: string) =>
  tally(
    game.shots
      .filter((shot) => shot.shooterId === playerId)
      .map((shot) => shot.weapon),
  );
const kills = (game: GameState, playerId: string) =>
  tally(
    game.shots
      .filter((shot) => shot.shooterId === playerId)
      .flatMap((shot) => shot.kills.map(() => shot.weapon)),
  );

/** A pull of `weapon` whose one bomb is already due, so its blast opens on the next step wherever it is put. */
function dueBomb(
  game: GameState,
  id: number,
  ownerId: string,
  x: number,
  y: number,
  weapon: Weapon,
  landing = false,
): void {
  const bomb: BombState = {
    id,
    ownerId,
    launchX: x,
    launchY: y,
    x,
    y,
    launchedTick: game.tick - 1,
    landsAtTick: landing ? game.tick + 1 : game.tick - 1,
    explodeAtTick: landing ? game.tick + 99 : game.tick + 1,
    blastRange: BOMB_BLAST_RANGE,
    flightPath: Array.from({ length: BOMB_FLIGHT_TICKS + 1 }, () => ({
      x,
      y,
      angle: 0,
    })),
    shot: id,
  };
  game.bombs.set(id, bomb);
  game.shots.push({
    shot: id,
    shooterId: ownerId,
    weapon,
    elapsed: 0,
    bombs: 1,
    power: 0,
    extraBombs: 0,
    fuseLevel: 0,
    rangeLevel: 0,
    grip: false,
    kills: [],
  });
  game.nextBombId = Math.max(game.nextBombId, id + 1);
}

test("every launch logs one shot under the powerup it spent, and its bombs name that shot", () => {
  // Armed state, the weapon the pull is reported as, and how many bombs it puts in the air.
  const cases: [Partial<PlayerState>, Weapon, number][] = [
    [{}, "bomb", 1],
    [{ armed: ["triple"] }, "triple", 3],
    [{ armed: ["five"] }, "five", 5],
    // Five wins where both are armed, because that is the volley the launch actually fires.
    [{ armed: ["five", "triple"] }, "five", 5],
    [{ armed: ["gun"] }, "gun", 1],
    [{ armed: ["shell"] }, "shell", 1],
    [{ armed: ["gun", "shell"] }, "gun", 1],
    // Triple, Five and Extra Bomb fan Gun and Shell out too; the pull is still labelled by the projectile.
    [{ armed: ["gun", "triple"] }, "gun", 3],
    [{ armed: ["gun", "five"] }, "gun", 5],
    [{ armed: ["shell", "triple"] }, "shell", 3],
    [{ armed: ["shell", "five"], extraBombs: 1 }, "shell", 6],
  ];
  for (const [armed, weapon, launched] of cases) {
    const { game, player, input } = fixture();
    Object.assign(player, armed);
    input({ bomb: true, bombCommands: [{ action: "press" }] });
    input({ bombCommands: [{ action: "release" }] });
    assert.deepEqual(
      shots(game, "p0"),
      { [weapon]: 1 },
      `${JSON.stringify(armed)} is one ${weapon} shot`,
    );
    assert.deepEqual(kills(game, "p0"), {}, "nothing was in range");
    // A volley is still one shot, however many bombs it put in the air, and each of them names it.
    assert.equal(
      game.matchStats.get("p0")!.bombsPlaced,
      launched,
      "bombsPlaced still counts bombs, not pulls",
    );
    // A Gun's bullets are resolved at once and leave tracers; everything else is a bomb in flight.
    const bombs = [
      ...[...game.bombs.values()].map((bomb) => ({
        ...bomb,
        heading: Math.atan2(bomb.shell?.vy ?? 0, bomb.shell?.vx ?? 0),
      })),
      ...game.tracers.map((tracer) => ({
        ...tracer,
        heading: Math.atan2(tracer.vy, tracer.vx),
      })),
    ];
    assert.equal(bombs.length, launched);
    for (const bomb of bombs)
      assert.equal(
        bomb.shot,
        game.shots[0]!.shot,
        "every bomb of the pull names the one shot",
      );
    assert.equal(
      game.shots[0]!.shot,
      Math.min(...bombs.map((bomb) => bomb.id)),
      "whose id is its first bomb",
    );
    assert.equal(
      game.shots[0]!.bombs,
      launched,
      "and the log records how many bombs the pull launched",
    );
    if (weapon === "gun" || weapon === "shell") {
      // Whatever the pull did not spend is still armed, so no later shot goes uncounted.
      assert.equal(
        isArmed(player, "shell") === true,
        weapon === "gun" && armed.armed?.includes("shell") === true,
        "a Gun pull leaves a held Shell armed for the next pull",
      );
      assert.equal(
        isArmed(player, "triple") || isArmed(player, "five"),
        false,
        "a projectile pull spends Triple and Five",
      );
      const headings = bombs.map((bomb) => bomb.heading);
      assert.equal(
        new Set(headings.map((h) => h.toFixed(6))).size,
        launched,
        "each projectile flies its own heading",
      );
    }
  }
});

test("an instant headshot is one shot and one kill for the gun, end to end", () => {
  const { game, player, victim, input } = fixture();
  setArmed(player, "gun", true);
  // Head on, so the rider is between the bullet and its own trail: the bullet reaches the rider first.
  Object.assign(victim, { x: 700, y: 450, angle: Math.PI, trail: [] });
  input({ bomb: true, bombCommands: [{ action: "press" }] });
  input({ bombCommands: [{ action: "release" }] });
  assert.deepEqual(shots(game, "p0"), { gun: 1 });
  assert.equal(victim.alive, false, "the shot killed the tick it was fired");
  assert.equal(player.alive, true, "and the riders never met");
  assert.deepEqual(kills(game, "p0"), { gun: 1 });
  assert.equal(game.matchStats.get("p1")!.deathsByCause.explosion, 1);
});

test("a shell that sweeps into a rider is one shot and one kill for the shell, end to end", () => {
  const { game, player, victim, input } = fixture();
  setArmed(player, "shell", true);
  // Head on again: a shell reflects off trails, so it must meet the rider before the rider's own trail.
  Object.assign(victim, { x: 700, y: 450, angle: Math.PI, trail: [] });
  input({ bomb: true, bombCommands: [{ action: "press" }] });
  input({ bombCommands: [{ action: "release" }] });
  assert.deepEqual(shots(game, "p0"), { shell: 1 });
  // Measured at tick 9; same reasoning as the cannon above.
  for (let tick = 0; tick < 14 && victim.alive; tick += 1) input({});
  assert.equal(victim.alive, false, "the shell swept into it");
  assert.equal(player.alive, true, "and the riders never met");
  assert.deepEqual(kills(game, "p0"), { shell: 1 });
});

test("a blast and a direct landing both credit the weapon that fired the bomb", () => {
  for (const landing of [false, true]) {
    for (const weapon of ["bomb", "triple", "five", "shell"] as const) {
      const { game, victim } = fixture();
      dueBomb(
        game,
        1,
        "p0",
        victim.x + (landing ? 7 : 0),
        victim.y,
        weapon,
        landing,
      );
      step(game, new Map());
      assert.equal(
        victim.alive,
        false,
        `${weapon} ${landing ? "landing" : "blast"} killed`,
      );
      assert.deepEqual(
        kills(game, "p0"),
        { [weapon]: 1 },
        `${weapon} by ${landing ? "landing" : "blast"}`,
      );
      assert.equal(
        game.shots[0]!.kills[0]!.victimId,
        "p1",
        "logged against the pull, naming the victim",
      );
    }
  }
});

test("a rider that blows itself up records the death and credits the weapon to nobody", () => {
  const { game, player } = fixture();
  dueBomb(game, 1, "p0", player.x, player.y, "five");
  step(game, new Map());
  assert.equal(player.alive, false);
  assert.equal(game.matchStats.get("p0")!.deathsByCause.explosion, 1);
  assert.deepEqual(
    kills(game, "p0"),
    {},
    "an own goal is not a kill for the weapon that caused it",
  );
  assert.equal(game.matchStats.get("p0")!.eliminations, 0);
});

test("two riders blasting the same victim credit neither an elimination nor a weapon", () => {
  const { game } = fixture(3);
  const victim = game.players.get("p2")!;
  dueBomb(game, 1, "p0", victim.x, victim.y, "bomb");
  dueBomb(game, 2, "p1", victim.x, victim.y, "five");
  step(game, new Map());
  assert.equal(victim.alive, false);
  assert.equal(game.matchStats.get("p2")!.deathsByCause.explosion, 1);
  for (const id of ["p0", "p1"]) {
    assert.deepEqual(
      kills(game, id),
      {},
      `${id} shares the blame, so it gets no credit`,
    );
    assert.equal(game.matchStats.get(id)!.eliminations, 0);
  }
});

test("one owner, two weapons on the same victim: the lowest bomb id decides, so every replica agrees", () => {
  for (const [first, second] of [
    ["triple", "five"],
    ["five", "triple"],
  ] as const) {
    const { game } = fixture(3);
    const victim = game.players.get("p2")!;
    dueBomb(game, 1, "p1", victim.x, victim.y, first);
    dueBomb(game, 2, "p1", victim.x, victim.y, second);
    step(game, new Map());
    assert.equal(victim.alive, false);
    assert.deepEqual(kills(game, "p1"), { [first]: 1 }, `bomb 1 was ${first}`);
    assert.equal(
      game.matchStats.get("p1")!.eliminations,
      1,
      "still exactly one elimination",
    );
  }
});

test("a shot that kills nobody stays a shot: the miss half of the measure, end to end", () => {
  const { game, player, victim, input } = fixture();
  // Both riders run straight down a clear arena, so the round is still going when the bomb goes off well
  // behind them and reaches nobody.
  Object.assign(player, { x: 100, y: 450, angle: 0, trail: [] });
  Object.assign(victim, { x: 100, y: 800, angle: 0, trail: [] });
  input({ bomb: true, bombCommands: [{ action: "press" }] });
  input({ bombCommands: [{ action: "release" }] });
  for (let tick = 0; tick < 90; tick += 1) input({});
  assert.equal(
    game.matchStats.get("p0")!.bombsExploded,
    1,
    "the bomb did go off",
  );
  assert.ok(player.alive && victim.alive, "and caught nobody");
  assert.deepEqual(
    shots(game, "p0"),
    { bomb: 1 },
    "the pull is counted all the same",
  );
  assert.deepEqual(kills(game, "p0"), {}, "so shots minus kills is the miss");
});

test("a chained bomb credits its own owner and its own weapon, as its elimination always has", () => {
  const { game } = fixture(3);
  const victim = game.players.get("p2")!;
  // p0's plain bomb goes off this tick and sets off p1's Five bomb, whose blast is what reaches p2.
  dueBomb(game, 1, "p0", victim.x - 120, victim.y, "bomb");
  dueBomb(game, 2, "p1", victim.x, victim.y, "five", true);
  step(game, new Map());
  assert.equal(victim.alive, false);
  assert.deepEqual(
    kills(game, "p1"),
    { five: 1 },
    "the bomb that reached the victim was p1 Five",
  );
  assert.deepEqual(kills(game, "p0"), {}, "p0 only lit the fuse");
  assert.equal(game.matchStats.get("p1")!.eliminations, 1);
  assert.equal(game.matchStats.get("p0")!.eliminations, 0);
});

test("a decided round keeps its log until the next is decided, through a rematch, and leaves out interrupted pulls", () => {
  // Two rounds decide it, so round 1 ends at roundOver and round 2 at matchOver.
  const { game, player, victim, input } = fixture(2, {
    ...defaultRoomSettings(),
    match: "rounds",
    length: 2,
  });
  const phase = () => String(game.phase);
  const decided = () => toView(game).decidedRound;
  const strike = () => {
    // Every round lays out its own scenery, and the bullet below needs a clear line.
    game.obstacles = [];
    Object.assign(player, { x: 400, y: 450, angle: 0, trail: [] });
    // Head on, so the bullet below reaches the rider before the rider's own trail.
    Object.assign(victim, { x: 900, y: 450, angle: Math.PI, trail: [] });
    // A plain bomb still in the air when the round ends: interrupted, so neither a kill nor a miss.
    input({ bomb: true, bombCommands: [{ action: "press" }] });
    input({ bombCommands: [{ action: "release" }] });
    player.bombReadyAtTick = game.tick;
    setArmed(player, "gun", true);
    game.bombs.forEach((bomb) => {
      bomb.ownerId = "p0";
      bomb.shell = { vx: 0, vy: 0 };
    }); // a shell does not block the next pull
    // A tap on the Gun fires on its release and kills at once, while the first bomb is still in the air.
    input({ bombCommands: [{ action: "press" }, { action: "release" }] });
  };
  assert.equal(
    decided(),
    undefined,
    "nothing is published before any round is decided",
  );
  strike();
  assert.equal(phase(), "roundOver", "the round ended with one rider left");
  assert.equal(game.shots.length, 2, "the round in play logged both pulls");
  const first = decided()!;
  assert.deepEqual(
    [first.round, first.tick],
    [1, game.tick],
    "stamped with its round and the tick it was decided at",
  );
  assert.deepEqual(
    first.shots.map((shot) => [
      shot.weapon,
      shot.kills.map((kill) => kill.victimId),
    ]),
    [["gun", ["p1"]]],
    "the bomb still in the air is left out: the round ended on it, it did not miss",
  );
  game.tick = game.phaseEndsAtTick!;
  startNextRound(game);
  assert.deepEqual(
    game.shots,
    [],
    "the next round starts an empty log, because bomb ids restart with it",
  );
  assert.deepEqual(
    decided(),
    first,
    "but the decided round stays readable for the whole next round",
  );
  while (phase() === "countdown") step(game, new Map());
  strike();
  assert.equal(phase(), "matchOver", "the second round decided the match");
  assert.equal(
    decided()!.round,
    2,
    "the deciding round replaces it at matchOver",
  );
  const second = decided();
  resetMatch(game, "weapons-2");
  assert.deepEqual(
    decided(),
    second,
    "a rematch keeps it, so a device still waiting on confirmation can report it",
  );
  returnToLobby(game, "weapons-3");
  assert.deepEqual(decided(), second, "and so does the lobby");
});

test("a bomb naming no shot kills without a kill being logged against a guess", () => {
  const { game, victim } = fixture();
  dueBomb(game, 1, "p0", victim.x, victim.y, "bomb");
  // The shot is optional at the checkpoint boundary so a missing one can never become a wrong one. Nothing in
  // play omits it, so this is the only way to reach the fallback.
  delete game.bombs.get(1)!.shot;
  step(game, new Map());
  assert.equal(victim.alive, false);
  assert.equal(
    game.matchStats.get("p0")!.eliminations,
    1,
    "the elimination is still credited",
  );
  assert.deepEqual(
    kills(game, "p0"),
    {},
    "but nothing is logged against a guess",
  );
});

test("a decided round becomes one Kill per kill and one Miss per miss, from the shooter alone", () => {
  const { game, player, victim, input } = fixture(3, {
    ...defaultRoomSettings(),
    match: "rounds",
    length: 1,
  });
  const third = game.players.get("p2")!;
  // A harmless bomb, then a Gun kill, then another rider's resolved gun miss with a visible tracer.
  Object.assign(player, { x: 100, y: 450, angle: 0 });
  input({ bomb: true, bombCommands: [{ action: "press" }] });
  input({ bombCommands: [{ action: "release" }] });
  // Bring it down at once in an empty corner, so it genuinely explodes and reaches nobody.
  for (const bomb of game.bombs.values())
    Object.assign(bomb, {
      x: 800,
      y: 860,
      landsAtTick: game.tick,
      explodeAtTick: game.tick + 1,
    });
  input({});
  assert.equal(game.bombs.size, 0, "it went off");
  assert.equal(game.matchStats.get("p0")!.bombsExploded, 1);
  player.bombReadyAtTick = game.tick;
  setArmed(player, "gun", true);
  // Upgrades held at this pull, which must be what the Kill reports even though they change afterwards.
  Object.assign(player, {
    powerPickups: 3,
    extraBombs: 1,
    fuseLevel: 2,
    rangeLevel: 0,
    grip: true,
  });
  // Extra Bomb fans the Gun out into two bullets either side of the heading, so the victim stands on the first
  // one's line, facing the shooter: the bullet reaches the rider before the rider's own trail.
  const line = volleyAngles(player.angle, 2)[0]!;
  Object.assign(victim, {
    x: player.x + Math.cos(line) * 300,
    y: player.y + Math.sin(line) * 300,
    angle: line + Math.PI,
    trail: [],
  });
  input({ bombCommands: [{ action: "press" }, { action: "release" }] });
  assert.equal(victim.alive, false, "the tap killed immediately");
  Object.assign(player, {
    powerPickups: 9,
    extraBombs: 4,
    fuseLevel: 0,
    rangeLevel: 0,
    grip: false,
  });
  setArmed(third, "gun", true);
  Object.assign(third, { x: 1200, y: 100, angle: 0 });
  step(
    game,
    new Map([
      [
        "p2",
        {
          left: false,
          right: false,
          bomb: true,
          bombCommands: [{ action: "press" }],
        },
      ],
    ]),
  );
  step(
    game,
    new Map([
      [
        "p2",
        {
          left: false,
          right: false,
          bomb: false,
          bombCommands: [{ action: "release" }],
        },
      ],
    ]),
  );
  // p2 leaves, which decides the one-round match.
  eliminatePlayer(game, "p2");
  step(game, new Map());
  assert.equal(game.phase, "matchOver");
  const published = toView(game).decidedRound!.shots;

  const room = { round: game.round, riders: 3, bots: 0 };
  const mine = roundShotEvents(published, "p0", room);
  assert.deepEqual(
    mine.map((entry) => entry.event),
    ["Miss", "Kill"],
    "one event per pull outcome, in pull order",
  );
  assert.deepEqual(mine[0]!.properties, {
    weapon: "bomb",
    round: 1,
    secondsIntoRound: mine[0]!.properties.secondsIntoRound,
    bombs: 1,
    power: 0,
    extraBombs: 0,
    fuseLevel: 0,
    rangeLevel: 0,
    grip: false,
    riders: 3,
    bots: 0,
  });
  assert.deepEqual(mine[1]!.properties, {
    weapon: "gun",
    round: 1,
    secondsIntoRound: mine[1]!.properties.secondsIntoRound,
    bombs: 2,
    power: 3,
    extraBombs: 1,
    fuseLevel: 2,
    rangeLevel: 0,
    grip: true,
    riders: 3,
    bots: 0,
    victimBot: false,
    shotKills: 1,
    firstKillOfShot: true,
    secondsToKill: 0,
  });
  assert.deepEqual(
    roundShotEvents(published, "p2", room).map((entry) => entry.event),
    ["Miss"],
    "a visible gun tracer already resolved, so it counts as a miss",
  );
  assert.deepEqual(
    roundShotEvents(published, "p1", room),
    [],
    "the victim reports nothing about the kill",
  );
  assert.deepEqual(
    roundShotEvents(published, "", room),
    [],
    "nor does a shared-TV display with no rider",
  );
});
