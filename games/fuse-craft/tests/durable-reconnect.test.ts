import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeState,
  encodeState,
  step,
  hashState,
} from "../src/engine/index.ts";
import { aiCommands } from "../src/engine/ai.ts";
import {
  constructionQueueAvailability,
  constructionDispatchAvailability,
} from "../src/engine/catalog.ts";
const snapshot = () =>
  decodeState(
    readFileSync(
      new URL("./fixtures/balanced-repair-1511.world.json", import.meta.url),
      "utf8",
    ),
  );
for (const [id, cell] of [
  ["alpha", 127],
  ["beta", 352],
] as const) {
  test(`durable repair replaces same-cell flank conduit: ${id}`, () => {
    const w = snapshot(),
      original = encodeState(w);
    const cs = aiCommands(w, id, "balanced");
    assert.deepEqual(
      cs.find((c) => c.action.type === "queueConstruction")?.action,
      { type: "queueConstruction", kind: "bastion", cell },
    );
    assert.equal(encodeState(w), original);
    assert.equal(
      step(w, cs).outcomes.some((o) => o.type === "rejected"),
      false,
    );
    const reversed = snapshot();
    reversed.structures.reverse();
    assert.deepEqual(aiCommands(reversed, id, "balanced"), cs);
    const restored = decodeState(encodeState(w));
    assert.equal(
      hashState(step(restored, aiCommands(restored, id, "balanced"))),
      hashState(step(w, cs)),
    );
  });
  test(`ordinary flank survives absent dormant guns: ${id}`, () => {
    const w = snapshot();
    w.structures = w.structures.filter((s) => s.ownerId === id || s.connected);
    assert.deepEqual(
      aiCommands(w, id, "balanced").find(
        (c) => c.action.type === "queueConstruction",
      )?.action,
      { type: "queueConstruction", kind: "neuron", cell },
    );
  });
  test(`missing Growth uses legal Tower repair: ${id}`, () => {
    const w = snapshot(),
      p = w.players.find((p) => p.id === id)!;
    p.research = p.research.filter((r) => r !== "growth");
    assert.equal(
      constructionQueueAvailability(w, p, "bastion", cell).allowed,
      false,
    );
    assert.equal(
      constructionQueueAvailability(w, p, "tower", cell).allowed,
      true,
    );
    const commands = aiCommands(w, id, "balanced");
    assert.deepEqual(
      commands.find((c) => c.action.type === "queueConstruction")?.action,
      { type: "queueConstruction", kind: "tower", cell },
    );
    assert.equal(
      step(w, commands).outcomes.some((o) => o.type === "rejected"),
      false,
    );
  });
  test(`unaffordable durable repair waits unpaid then dispatches from ordinary income: ${id}`, () => {
    let w = snapshot();
    const p = w.players.find((p) => p.id === id)!;
    p.biomass = 0;
    const earned = p.statistics.biomassEarned;
    assert.equal(
      constructionQueueAvailability(w, p, "bastion", cell).allowed,
      true,
    );
    assert.equal(
      constructionDispatchAvailability(w, p, { kind: "bastion", cell }).allowed,
      false,
    );
    const commands = w.players.flatMap((p) => aiCommands(w, p.id, "balanced"));
    assert.deepEqual(
      commands.find(
        (c) => c.playerId === id && c.action.type === "queueConstruction",
      )?.action,
      { type: "queueConstruction", kind: "bastion", cell },
    );
    w = step(w, commands);
    assert.equal(
      w.outcomes.some((o) => o.type === "rejected"),
      false,
    );
    let job = w.players
      .find((p) => p.id === id)!
      .queue.find((j) => j.cell === cell);
    assert.ok(job);
    assert.equal(job.kind, "bastion");
    assert.equal(job.paid, false);
    const queuedAt = w.tick;
    while (!job.paid && w.tick < queuedAt + 1200) {
      w = step(
        w,
        w.players.flatMap((p) => aiCommands(w, p.id, "balanced")),
      );
      assert.equal(
        w.outcomes.some((o) => o.type === "rejected"),
        false,
      );
      job = w.players
        .find((p) => p.id === id)!
        .queue.find((j) => j.cell === cell);
      assert.ok(job, "ordinary AI preserves the waiting repair");
    }
    assert.equal(job.paid, true);
    assert.ok(
      w.players.find((p) => p.id === id)!.statistics.biomassEarned > earned,
    );
  });
}
