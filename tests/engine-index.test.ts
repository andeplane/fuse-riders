import assert from "node:assert/strict";
import test from "node:test";
import * as engine from "../src/engine/index.js";

test("the engine's public API drives a room from an empty log to a played tick", () => {
  const room = engine.createRoomState("index", engine.defaultRoomSettings());
  for (let slot = 0; slot < 2; slot++)
    engine.addPlayer(room.game, {
      id: `bot:${slot}`,
      name: `Bot ${slot}`,
      slot,
      color: engine.SLOT_COLORS[slot]!,
    });
  room.bots.add("bot:0").add("bot:1");
  engine.startMatch(room.game);
  const bots = new engine.BotController();
  for (let tick = 0; tick <= engine.COUNTDOWN_TICKS; tick++)
    engine.applyTick(room, "nobody", new Map(), bots);
  assert.equal(room.game.phase, "playing");
  assert.equal(engine.toSnapshot(room.game).players.length, 2);
  assert.match(engine.RULES, /^fuse-p2p-\d+$/);
  assert.equal(engine.PHASES.at(-1)!.name, "resolveRound");
  const restored = engine.decodeGameState(engine.encodeGameState(room.game));
  assert.ok(restored, "the codec round-trips a live state");
  assert.equal(
    engine.hashRoomState({ ...room, game: restored }),
    engine.hashRoomState(room),
  );
});
