import test from "node:test";
import assert from "node:assert/strict";
import { Mesh } from "./fixtures/mesh.js";
import { planNeuronPlacement } from "../src/app/neuron-placement.js";

test("a long construction batch reaches both online seats without truncation", () => {
  const mesh = new Mesh("host");
  const host = mesh.open("host"),
    friend = mesh.open("friend");
  mesh.until(() => friend.room().stage === "lobby");
  host.join("Host");
  friend.join("Friend");
  mesh.until(() => friend.room().seats.length === 2);
  host.configure({ mapId: "cortex-crossing", powerups: false });
  mesh.until(() => friend.room().mapId === "cortex-crossing");
  host.start();
  mesh.until(() => host.canControl && friend.canControl);
  const player = host.view().players.find((p) => p.id === "host")!;
  const plan = planNeuronPlacement(host.view(), player, 549);
  assert.equal(plan.cells.length, 32);
  assert.equal(
    host.dispatchBatch(
      plan.cells.map((cell) => ({
        type: "queueConstruction",
        kind: "neuron",
        cell,
      })),
    ),
    true,
  );
  mesh.until(() =>
    [host, friend].every((m) =>
      m
        .view()
        .players.find((p) => p.id === "host")!
        .queue.some((j) => j.cell === 549),
    ),
  );
  for (const member of [host, friend])
    assert.deepEqual(
      member
        .view()
        .players.find((p) => p.id === "host")!
        .queue.map((j) => j.cell),
      plan.cells,
    );
  // Lobby/rematch cancels any accepted but not yet logged actions.
  host.dispatchBatch(
    Array.from({ length: 32 }, () => ({
      type: "setAutoExpand" as const,
      enabled: true,
    })),
  );
  host.lobby();
  mesh.until(() => friend.room().stage === "lobby");
  host.start();
  mesh.until(() => host.canControl && friend.canControl);
  mesh.run(500);
  for (const member of [host, friend]) {
    assert.equal(
      member.view().players.find((p) => p.id === "host")!.autoExpand,
      false,
    );
    assert.equal(
      member.view().players.find((p) => p.id === "host")!.queue.length,
      0,
    );
    member.dispose();
  }
});

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

  assert.equal(friend.room().aiStrategy, "random", "bots open at random");
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

test("four members play a free-for-all on a four-seat map and every device agrees", () => {
  const mesh = new Mesh("host");
  const ids = ["host", "ada", "bo", "cy"];
  const members = ids.map((id) => mesh.open(id));
  const [host] = members;
  mesh.until(() => members.every((m) => m.room().stage === "lobby"));
  members.forEach((m, i) => m.join(ids[i]!.toUpperCase()));
  mesh.until(() =>
    members.every((m) => m.room().seats.filter((s) => !s.watcher).length === 4),
  );
  host!.configure({ mapId: "cortex-crossing", powerups: true });
  mesh.until(() => members.every((m) => m.room().mapId === "cortex-crossing"));
  // The table is full: no room for a bot.
  host!.addBot();
  mesh.run(300);
  assert.equal(
    host!.room().seats.some((s) => s.bot),
    false,
  );

  host!.start();
  mesh.until(() => members.every((m) => m.room().stage === "running"));
  const slots = host!
    .view()
    .players.map((p) => p.slot)
    .sort();
  assert.deepEqual(slots, [0, 1, 2, 3], "every spawn is taken");
  members.forEach((m) => m.dispatch({ type: "setAutoExpand", enabled: true }));
  mesh.run(15_000);
  // Each device sees each player's own choice and a growing network.
  for (const m of members) {
    const view = m.view();
    assert.equal(view.players.length, 4);
    for (const p of view.players) {
      assert.equal(p.autoExpand, true, `${m.localPlayerId} sees ${p.id}`);
      assert.ok(
        p.territory > 7,
        `${p.id} has grown: ${p.territory} at ${view.tick}`,
      );
    }
  }
  // Views agree on everything confirmed long enough ago.
  const owners = (m: (typeof members)[number], before: number) =>
    m
      .view()
      .structures.filter((s) => s.kind !== "brain" && s.id < before)
      .map((s) => `${s.ownerId}@${s.cell}`)
      .sort()
      .join();
  const settled = Math.min(...members.map((m) => m.view().nextEntityId)) - 20;
  for (const m of members.slice(1))
    assert.equal(owners(m, settled), owners(host!, settled));
  members.forEach((m) => m.dispose());
});

test("six seats fill a six-seat map with humans and bots", () => {
  const mesh = new Mesh("host");
  const ids = ["host", "ada", "bo", "cy"];
  const members = ids.map((id) => mesh.open(id));
  const [host] = members;
  mesh.until(() => members.every((m) => m.room().stage === "lobby"));
  members.forEach((m, i) => m.join(ids[i]!.toUpperCase()));
  host!.configure({ mapId: "grand-cortex", powerups: false });
  mesh.until(() => members.every((m) => m.room().mapId === "grand-cortex"));
  host!.addBot();
  host!.addBot();
  host!.addBot();
  mesh.until(() => members.every((m) => m.room().seats.length === 6), 5000);
  mesh.run(300);
  assert.equal(host!.room().seats.length, 6, "the third bot does not fit");
  host!.start();
  mesh.until(() => members.every((m) => m.room().stage === "running"));
  mesh.run(6000);
  for (const m of members) {
    assert.equal(m.view().players.length, 6);
    assert.ok(m.view().players.every((p) => p.alive));
  }
  const bots = host!.view().players.filter((p) => p.id.startsWith("bot-"));
  assert.equal(bots.length, 2);
  for (const bot of bots)
    assert.ok(
      host!
        .view()
        .structures.some((s) => s.ownerId === bot.id && s.kind !== "brain") ||
        bot.queue.length > 0,
      `${bot.id} plays`,
    );
  members.forEach((m) => m.dispose());
});
