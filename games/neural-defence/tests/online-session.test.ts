import test from "node:test";
import assert from "node:assert/strict";
import { Mesh } from "./fixtures/mesh.js";

test("two members share a Versus room: seats, rules, bots, a match and the lobby", () => {
  const mesh = new Mesh("host");
  const host = mesh.open("host");
  const friend = mesh.open("friend");
  mesh.until(
    () => host.room().stage === "lobby" && friend.room().stage === "lobby",
  );
  assert.equal(host.room().manager, true);
  assert.equal(friend.room().manager, false);
  assert.equal(friend.canControl, false, "nobody plays in the lobby");

  host.join("Host");
  friend.join("Friend");
  mesh.until(() => friend.room().seats.filter((s) => !s.watcher).length === 2);
  assert.deepEqual(
    host
      .room()
      .seats.map((s) => s.name)
      .sort(),
    ["Friend", "Host"],
  );

  host.configure({ mapId: "sandbox-12", powerups: false, aiStrategy: "siege" });
  mesh.until(() => friend.room().mapId === "sandbox-12");
  assert.equal(friend.room().powerups, false);
  assert.equal(friend.room().aiStrategy, "siege");

  host.addBot();
  mesh.until(() => friend.room().seats.some((s) => s.bot));
  const botId = friend.room().seats.find((s) => s.bot)!.id;

  host.start();
  mesh.until(
    () => host.room().stage === "running" && friend.room().stage === "running",
  );
  assert.equal(friend.canControl, true);
  assert.equal(friend.localPlayerId, "friend");
  assert.deepEqual(
    host
      .view()
      .players.map((p) => p.id)
      .sort(),
    ["friend", "host", botId].sort(),
  );

  // A command from the joiner reaches the shared world on both devices.
  friend.dispatch({ type: "setAutoExpand", enabled: true });
  const autoExpand = (view: typeof host) =>
    view.view().players.find((p) => p.id === "friend")?.autoExpand === true;
  mesh.until(() => autoExpand(host) && autoExpand(friend));
  mesh.run(3000);
  assert.ok(
    host
      .view()
      .structures.some((s) => s.ownerId === botId && s.kind === "neuron") ||
      host
        .view()
        .players.find((p) => p.id === botId)!
        .queue.some((j) => j.paid),
    "the room bot grows its network",
  );

  friend.lobby();
  mesh.run(500);
  assert.equal(host.room().stage, "running", "only the host can end the match");
  host.lobby();
  mesh.until(() => friend.room().stage === "lobby");
  assert.equal(friend.canControl, false);

  host.dispose();
  friend.dispose();
});

test("the host removes bots, and cannot rematch before a match", () => {
  const mesh = new Mesh("host");
  const host = mesh.open("host");
  const friend = mesh.open("friend");
  mesh.until(() => friend.room().stage === "lobby");
  host.addBot();
  mesh.until(() => host.room().seats.some((s) => s.bot));
  host.removeBot(host.room().seats.find((s) => s.bot)!.id);
  mesh.until(() => !friend.room().seats.some((s) => s.bot));
  host.rematch();
  mesh.run(200);
  assert.equal(host.room().stage, "lobby", "no rematch before a match");
  host.dispose();
  friend.dispose();
});
