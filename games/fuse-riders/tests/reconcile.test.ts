import test from "node:test";
import assert from "node:assert/strict";
import { World } from "fuse-netcode";
import { fuseGame } from "../src/online/fuse-game.js";
import { createRoomState } from "../src/engine/apply-tick.js";
import { JOIN, ACTION } from "../src/engine/input-log.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import { COUNTDOWN_TICKS } from "../src/engine/game.js";
import { presentFrames } from "../src/render/time/present.js";
import {
  CORRECTION_MS,
  RiderReconciler,
} from "../src/render/time/reconcile.js";
import type { WorldView } from "../src/engine/view.js";
import { FakeNetwork } from "./fixtures/fake-room.js";

function view(): WorldView {
  const world = new World(
    fuseGame,
    createRoomState("m", defaultRoomSettings()),
    "a",
    "a",
  );
  const log = world.stream("a", 1);
  world.stream("b", 1).through = 200;
  log.append(1, [JOIN, "a", "A", 0, "fox", 1]);
  log.append(1, [JOIN, "b", "B", 1, "cat", 1]);
  log.append(2, [ACTION, "start", "m"]);
  log.through = 200;
  world.advance(COUNTDOWN_TICKS + 4);
  return world.view()[0]!;
}
function moved(s: WorldView, x = 40): WorldView {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, x: p.x + x, angle: p.angle + 1 })),
  };
}

test("corrections preserve the visible remote pose, settle within 120 ms and never delay the local rider", () => {
  const r = new RiderReconciler(),
    a = view(),
    b = moved(a);
  const unchanged = structuredClone(b);
  r.sample(a, 0, "m:1", 0, "a");
  const corrected = r.sample(b, 16, "m:1", 1, "a");
  assert.deepEqual(corrected.get("b"), {
    x: a.players[1]!.x,
    y: a.players[1]!.y,
    angle: a.players[1]!.angle,
  });
  assert.equal(corrected.get("a"), b.players[0]);
  assert.deepEqual(
    r.sample(b, 16, "m:1", 1, "a"),
    corrected,
    "same timestamp is stable",
  );
  const mid = r.sample(b, 76, "m:1", 1, "a").get("b")!;
  assert.ok(mid.x > a.players[1]!.x && mid.x < b.players[1]!.x);
  assert.equal(
    r.sample(b, 16 + CORRECTION_MS, "m:1", 1, "a").get("b"),
    b.players[1],
  );
  assert.deepEqual(
    b,
    unchanged,
    "no view, trails or gameplay state is changed",
  );
  const c = moved(b, 10);
  assert.equal(
    r.sample(c, 150, "m:1", 1, "a").get("b"),
    c.players[1],
    "normal motion has no added delay",
  );
});

test("successive corrections stay continuous without permanent offsets", () => {
  const r = new RiderReconciler(),
    a = view(),
    b = moved(a),
    c = moved(b, -20);
  r.sample(a, 0, "scope", 0);
  r.sample(b, 10, "scope", 1);
  const prior = r.sample(b, 50, "scope", 1).get("b")!;
  assert.deepEqual(r.sample(c, 50, "scope", 2).get("b"), prior);
  assert.equal(
    r.sample(c, 50 + CORRECTION_MS, "scope", 2).get("b"),
    c.players[1],
  );
  r.reset();
  assert.equal(r.sample(a, 200, "scope", 2).get("b"), a.players[1]);
});

test("open edges reconcile along the short wrapped path and shortest heading", () => {
  const a = view();
  a.openEdges = true;
  a.players[1]!.x = a.width - 2;
  a.players[1]!.angle = Math.PI - 0.1;
  const b = {
    ...a,
    players: a.players.map((p) =>
      p.id === "b" ? { ...p, x: 2, angle: -Math.PI + 0.1 } : p,
    ),
  };
  const r = new RiderReconciler();
  r.sample(a, 0, "scope", 0);
  const at = r.sample(b, 10, "scope", 1).get("b")!;
  assert.ok(Math.abs(at.x - a.players[1]!.x) < 1e-9);
  assert.ok(
    Math.abs(
      Math.atan2(
        Math.sin(at.angle - a.players[1]!.angle),
        Math.cos(at.angle - a.players[1]!.angle),
      ),
    ) < 1e-9,
  );
});

for (const kind of [
  "death",
  "portal",
  "avatar",
  "gun",
  "armed",
  "charge",
  "scope",
  "phase",
  "backwards",
  "gap",
  "oversized",
  "dimensions",
  "removed",
] as const) {
  test(`${kind} clears correction history immediately`, () => {
    const a = view(),
      b = moved(a);
    const r = new RiderReconciler();
    r.sample(a, 0, "scope", 0);
    r.sample(b, 10, "scope", 1);
    let c = moved(b, 2),
      now = 20,
      scope = "scope";
    if (kind === "death") c.players[1]!.alive = false;
    if (kind === "portal") c.players[1]!.portalCooldownUntilTick++;
    if (kind === "avatar") c.players[1]!.avatarId = "fox";
    if (kind === "gun") c.players[1]!.gunAim = 0;
    if (kind === "armed") c.players[1]!.gunArmed = true;
    if (kind === "charge") c.players[1]!.bombChargeStartedTick = c.tick;
    if (kind === "scope") scope = "new";
    if (kind === "phase") c.phase = "roundOver";
    if (kind === "backwards") now = 5;
    if (kind === "gap") now = 500;
    if (kind === "oversized") c = moved(b, 500);
    if (kind === "dimensions") c.width++;
    if (kind === "removed") c.players = c.players.filter((p) => p.id !== "b");
    const pose = r.sample(c, now, scope, 2).get("b");
    assert.equal(
      pose,
      c.players.find((p) => p.id === "b"),
    );
  });
}

test("a delayed steering release converges while the remote portrait avoids the raw 84-degree snap", () => {
  const net = new FakeNetwork(
    "a",
    { loss: 0, baseMs: 20, jitterMs: 0, reliableMs: 20 },
    7,
  );
  const settings = { ...defaultRoomSettings(), map: "classic" as const };
  const a = net.add("a", settings),
    b = net.add("b", settings);
  const r = new RiderReconciler();
  a.start();
  b.start();
  net.step(3000);
  a.command({ type: "join", name: "A" });
  b.command({ type: "join", name: "B" });
  net.step(400);
  a.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 100);
  const sample = () => {
    const frames = a.presentation()!,
      raw = presentFrames(frames);
    const shown = r
      .sample(raw, net.now, "match", frames.revision, "a")
      .get("b")!;
    return { raw: raw.players.find((p) => p.id === "b")!, shown };
  };
  const run = (ms: number) => {
    for (let i = 0; i < ms; i += 10) {
      net.step(10);
      sample();
    }
  };
  b.command({ type: "input", seq: 1, left: true, right: false, bomb: false });
  run(100);
  net.muted.add("b");
  b.command({ type: "input", seq: 2, left: false, right: false, bomb: false });
  run(500);
  net.muted.delete("b");
  let previous = sample(),
    rawDegrees = 0,
    shownDegrees = 0,
    shownDistance = 0;
  const angle = (a: number, b: number) =>
    (Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * 180) / Math.PI;
  for (let i = 0; i < 40; i++) {
    net.step(10);
    const current = sample();
    rawDegrees = Math.max(
      rawDegrees,
      angle(current.raw.angle, previous.raw.angle),
    );
    shownDegrees = Math.max(
      shownDegrees,
      angle(current.shown.angle, previous.shown.angle),
    );
    shownDistance = Math.max(
      shownDistance,
      Math.hypot(
        current.shown.x - previous.shown.x,
        current.shown.y - previous.shown.y,
      ),
    );
    previous = current;
  }
  assert.ok(
    rawDegrees > 80,
    `scenario still exercises the raw correction: ${rawDegrees}`,
  );
  assert.ok(shownDegrees < 15, `largest 10ms heading change: ${shownDegrees}`);
  assert.ok(
    shownDistance < 10,
    `largest 10ms portrait movement: ${shownDistance}`,
  );
  assert.equal(previous.raw.alive, true);
  assert.deepEqual(previous.shown, previous.raw);
  assert.deepEqual(a.heldControls("b"), { left: false, right: false });
  assert.equal(a.metrics().mismatches, 0);
  a.stop();
  b.stop();
});
