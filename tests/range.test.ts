import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  createGame,
  startMatch,
  startNextRound,
  step,
  toView,
  SLOT_COLORS,
  type GameState,
  type InputIntent,
} from "../src/engine/game.js";
import { bombLaunchDistance } from "../src/engine/bomb-launch.js";
import { bombPreviewDistance } from "../src/render/bomb-preview.js";
import {
  decodeGameState,
  encodeGameState,
} from "../src/engine/codec/checkpoint.js";
import { powerLabel } from "../src/render/power-indicator.js";
import { classicSettings } from "./fixtures/classic-settings.js";

function playing() {
  const game = createGame("range", classicSettings(), 725);
  for (let slot = 0; slot < 3; slot++)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  while (game.phase === "countdown") step(game, new Map());
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  for (const p of game.players.values())
    Object.assign(p, { x: 200, y: 200 + p.slot * 250, angle: 0, trail: [] });
  return game;
}
function drop(game: GameState, count = 1) {
  const p = game.players.get("p0")!;
  for (let i = 0; i < count; i++)
    game.pickups.push({
      id: game.nextPickupId++,
      type: "range",
      x: p.x + 3,
      y: p.y,
      expiresAtTick: game.tick + 100,
    });
}
const command = (action: "press" | "release" | "cancel") =>
  new Map<string, InputIntent>([
    [
      "p0",
      { left: false, right: false, bomb: false, bombCommands: [{ action }] },
    ],
  ]);

test("Range stacks three times, persists across shots, and leaves excess drops for eligible rivals", () => {
  const game = playing(),
    p = game.players.get("p0")!;
  for (const [level, maximum] of [
    [1, 600],
    [2, 700],
    [3, 800],
  ]) {
    drop(game);
    step(game, new Map());
    assert.equal(p.rangeLevel, level);
    assert.equal(toView(game).players[0]!.rangeLevel, level);
    for (let shot = 0; shot < 2; shot++) {
      p.bombReadyAtTick = game.tick;
      step(game, command("press"));
      for (let tick = 0; tick < 7; tick++) step(game, new Map());
      step(game, command("release"));
      const bomb = [...game.bombs.values()].at(-1)!;
      assert.ok(Math.abs(bomb.x - bomb.flightPath[0]!.x - maximum!) < 1e-9);
      assert.equal(p.rangeLevel, level);
      assert.equal(game.shots.at(-1)!.rangeLevel, level);
      game.bombs.clear();
    }
  }
  drop(game, 2);
  step(game, new Map());
  assert.equal(game.pickups.length, 2);
  const rival = game.players.get("p1")!;
  Object.assign(rival, { x: p.x, y: p.y + 16, angle: 0, trail: [] });
  step(game, new Map());
  assert.equal(p.rangeLevel, 3);
  assert.equal(rival.rangeLevel, 2);
  assert.equal(game.pickups.length, 0);
  game.phase = "roundOver";
  game.phaseEndsAtTick = game.tick;
  startNextRound(game);
  assert.equal(p.rangeLevel, 0);
  assert.equal(rival.rangeLevel, 0);
});

test("same-tick drops cap at three; cancellation retains Range and restore replays identically", () => {
  const game = playing();
  drop(game, 4);
  step(game, command("press"));
  assert.equal(game.players.get("p0")!.rangeLevel, 3);
  assert.equal(game.pickups.length, 1);
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  for (const inputs of [
    command("cancel"),
    command("press"),
    new Map(),
    command("release"),
  ]) {
    assert.deepEqual(step(restored, inputs), step(game, inputs));
    assert.equal(encodeGameState(restored), encodeGameState(game));
  }
  assert.equal(game.players.get("p0")!.rangeLevel, 3);
  for (const invalid of ["-1", "4", "1.5", "null", '"3"']) {
    assert.equal(
      decodeGameState(
        encodeGameState(game).replace(
          '"rangeLevel":3',
          `"rangeLevel":${invalid}`,
        ),
      ),
      undefined,
    );
  }
  assert.equal(
    decodeGameState(encodeGameState(game).replace('"rangeLevel":3,', "")),
    undefined,
  );
});

test("Range preserves minimum reach and charge timing; fractional preview agrees at release ticks", () => {
  for (let level = 0; level <= 3; level++)
    for (const maxTicks of [2, 8, 24, 40])
      for (const bounce of [false, true]) {
        const maximum = [400, 600, 700, 800][level]!;
        assert.equal(bombLaunchDistance(0, maxTicks, bounce, level), 100);
        assert.equal(
          bombLaunchDistance(maxTicks, maxTicks, bounce, level),
          maximum,
        );
        for (let tick = 0; tick < 90; tick++)
          assert.equal(
            bombPreviewDistance(tick, maxTicks, bounce, level),
            bombLaunchDistance(tick, maxTicks, bounce, level),
          );
        assert.ok(bombPreviewDistance(0.5, maxTicks, bounce, level) > 100);
      }
  assert.equal(powerLabel(2, 0, false, 2), "◆ 2 · RANGE×1.75");
});
