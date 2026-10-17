import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMANDS_PER_SEAT,
  DIFFICULTIES,
  NO_WINNER,
  botCommands,
  pickHeroes,
  createWorld,
  encodeWorld,
  levelXp,
  next,
  step,
  stepTick,
  teamSectors,
  tileOf,
  type Command,
  type Difficulty,
  type GameMap,
  type World,
} from "../src/engine/index.js";
import { dustBasin, tiny } from "./fixtures/maps.js";
import { addUnit, arena } from "./fixtures/heroes.js";

const map = dustBasin();

/** Every bot's commands for this tick, in seat order, as the netcode will fold them into the log. */
const allBots = (
  board: GameMap,
  world: World,
  bots: ReadonlyMap<number, Difficulty>,
): Command[] =>
  world.players.flatMap((player) =>
    botCommands(board, world, player.seat, bots.get(player.seat)!),
  );

/** Plays bots against each other until a winner or `limit` ticks; `watch` sees each world before its tick. */
function play(
  board: GameMap,
  bots: ReadonlyMap<number, Difficulty>,
  limit: number,
  watch: (world: World, commands: Command[]) => void = () => {},
): World {
  let world = createWorld(board, [...bots.keys()], 1);
  for (let tick = 0; tick < limit && world.winner === NO_WINNER; tick++) {
    const commands = allBots(board, world, bots);
    watch(world, commands);
    world = stepTick(board, world, commands);
  }
  return world;
}

/**
 * Whether `command`, sent alone on `world`'s next step, does what it says: a stance or order holds, the hero walks
 * toward the tile (or has reached it), a cast is announced. An order's sector captured in the same step is the one
 * exception, since a capture resets the factory's order after commands apply; so is a hero killed on that step.
 */
function takesEffect(board: GameMap, world: World, command: Command): boolean {
  const after = step(board, world, [command]);
  const seat = command.seat;
  if (command.type === "stance")
    return (
      after.players.find((p) => p.seat === seat)!.stance === command.stance
    );
  if (command.type === "order") {
    const sector = board.sites[command.factory]!.sector;
    const building = after.buildings.find((b) => b.id === command.factory)!;
    return (
      building.order === command.kind ||
      after.sectors[sector] !== world.sectors[sector]
    );
  }
  if (command.type === "cast")
    return after.events.some(
      (e) => e.type === "cast" && e.seat === seat && e.slot === command.slot,
    );
  if (command.type === "move") {
    const hero = after.heroes.find((h) => h.seat === seat)!;
    const goal = command.y * board.width + command.x;
    const at = tileOf(hero.y) * board.width + tileOf(hero.x);
    // A hero killed on that very step drops its move.
    return hero.goal === goal || at === goal || hero.hp === 0;
  }
  return false;
}

test("every command a bot sends is one a player could send, and takes effect", () => {
  let state = 0x5eed;
  const roll = (count: number): number => {
    const draw = next(state);
    state = draw.state;
    return draw.value % count;
  };
  const kinds = new Set<string>();
  for (const [board, seatSets] of [
    [
      map,
      [
        [0, 1],
        [0, 1, 2, 3],
        [0, 1, 2, 3, 4, 5],
      ],
    ],
    [
      tiny(),
      [
        [0, 1],
        [0, 1, 2],
      ],
    ],
  ] as const)
    for (const seats of seatSets) {
      const bots = new Map(seats.map((seat) => [seat, DIFFICULTIES[roll(3)]!]));
      // Sample a varied set of moments, with the heroes levelled now and then so every spell comes into play.
      play(board, bots, 2400, (world, commands) => {
        if (roll(8) !== 0) return;
        const varied: World = {
          ...world,
          heroes: world.heroes.map((hero) =>
            roll(4) === 0 ? { ...hero, xp: levelXp(6 + roll(5)) } : hero,
          ),
        };
        for (const seat of seats) {
          const sent = botCommands(board, varied, seat, bots.get(seat)!);
          assert.ok(sent.length <= COMMANDS_PER_SEAT);
          assert.equal(new Set(sent.map((c) => c.type)).size, sent.length);
          for (const command of sent) {
            assert.equal(command.seat, seat);
            kinds.add(
              command.type === "cast" ? `cast${command.slot}` : command.type,
            );
            assert.ok(
              takesEffect(board, varied, command),
              `${JSON.stringify(command)} at step ${world.step}`,
            );
          }
        }
        assert.ok(
          commands.every((c) => (seats as readonly number[]).includes(c.seat)),
        );
      });
    }
  for (const kind of ["move", "stance", "order", "cast0", "cast1", "cast3"])
    assert.ok(kinds.has(kind), `no bot sent ${kind}`);
});

test("a bot's commands are a pure function of the world and seat, and never change it", () => {
  const bots = new Map<number, Difficulty>([
    [0, "hard"],
    [1, "normal"],
    [2, "easy"],
    [3, "hard"],
  ]);
  play(map, bots, 1500, (world, commands) => {
    if (world.step % 50 !== 0) return;
    const before = encodeWorld(world);
    const again = allBots(map, world, bots);
    assert.deepEqual(again, commands);
    assert.deepEqual(encodeWorld(world), before);
  });
});

test("an empty seat or a finished match gets no commands", () => {
  const world = createWorld(map, [0, 1], 1);
  assert.deepEqual(botCommands(map, world, 4, "hard"), []);
  assert.deepEqual(botCommands(map, { ...world, winner: 0 }, 0, "hard"), []);
});

test("a hard bot beats an easy one from most starts", () => {
  const starts = [
    [0, 1],
    [1, 0],
    [2, 3],
    [3, 2],
    [4, 5],
    [5, 4],
  ] as const;
  let ahead = 0;
  for (const [hard, easy] of starts) {
    const bots = new Map<number, Difficulty>([
      [hard, "hard"],
      [easy, "easy"],
    ]);
    let sectors = 0;
    const world = play(map, bots, 12_000, (each) => {
      if (each.step === 4000)
        sectors = teamSectors(each, hard % 2) - teamSectors(each, easy % 2);
    });
    if (
      world.winner === hard % 2 ||
      (world.winner === NO_WINNER && sectors > 0)
    )
      ahead++;
  }
  assert.ok(ahead >= 5, `hard won ${ahead} of ${starts.length}`);
});

test("six bots think within budget", () => {
  const bots = new Map<number, Difficulty>(
    [0, 1, 2, 3, 4, 5].map((seat) => [seat, DIFFICULTIES[seat % 3]!]),
  );
  let calls = 0,
    spent = 0;
  let world = createWorld(map, [...bots.keys()], 1);
  for (let tick = 0; tick < 2000 && world.winner === NO_WINNER; tick++) {
    const start = performance.now();
    const commands = allBots(map, world, bots);
    spent += performance.now() - start;
    calls += bots.size;
    world = stepTick(map, world, commands);
  }
  // Generous: measured near 0.01 ms a call; a tick is 50 ms.
  assert.ok(spent / calls < 0.5, `${(spent / calls).toFixed(3)} ms a call`);
});

test("pickHeroes keeps each hero once a team: picks first, then the rest from a place their seat sets", () => {
  // prettier-ignore
  assert.deepEqual(pickHeroes([0, 1, 2, 3, 4, 5], {}),
    { 0: "brick", 1: "brick", 2: "vix", 3: "vix", 4: "brick", 5: "brick" });
  // A teammate's repeat falls back, the other team may pick the same hero, and a team with none left repeats one.
  // prettier-ignore
  assert.deepEqual(pickHeroes([0, 1, 2, 3], { 2: "vix", 0: "vix", 1: "vix", 3: null }),
    { 0: "vix", 1: "vix", 2: "brick", 3: "brick" });
  assert.deepEqual(pickHeroes([1, 0], { 1: "vix" }), {
    0: "brick",
    1: "vix",
  });
});

test("each kit's bot casts its spells at what calls for them", () => {
  const vix = arena("vix");
  addUnit(vix, 1, "lightTank", 9, 6);
  const casts = (world: typeof vix) =>
    botCommands(tiny(), world, 0, "normal").filter((c) => c.type === "cast");
  assert.deepEqual(casts(vix), [
    { seat: 0, type: "cast", slot: 0, x: 9, y: 6 },
  ]);
});
