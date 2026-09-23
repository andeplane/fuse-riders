import test from "node:test";
import assert from "node:assert/strict";
import {
  createArena,
  syncKeepers,
  stepArena,
  encodeArena,
  decodeArena,
} from "../src/engine/arena.js";
import { DEFAULT_TUNING, NEUTRAL, S } from "../src/engine/world.js";
import { decode, encode, hash } from "../src/online/game.js";
import { Mesh } from "./fixtures/mesh.js";
import {
  sessionStore,
  saveCreator,
  sessionToken,
  inviteUrl,
} from "../src/app/session.js";

test("simultaneous opposed hooks hit both keepers, preserve ownership and replay identically", () => {
  const a = createArena(DEFAULT_TUNING);
  syncKeepers(a, [
    { id: "b", slot: 1, connected: true, generation: 1 },
    { id: "a", slot: 0, connected: true, generation: 1 },
  ]);
  for (let i = 0; i < 31; i++) stepArena(a);
  for (const k of a.keepers)
    k.world.input = {
      ...NEUTRAL,
      fire: true,
      aimX: k.slot ? 310 : 170,
      aimY: 782,
    };
  const b = decodeArena(encodeArena(a))!;
  for (let i = 0; i < 10; i++) {
    stepArena(a);
    stepArena(b);
    assert.deepEqual(encodeArena(a), encodeArena(b));
  }
  assert.deepEqual(
    a.keepers.map((k) => k.hits),
    [1, 1],
  );
  assert.ok(a.keepers[0]!.world.vx > 0 && a.keepers[1]!.world.vx < 0);
  assert.equal(a.hit!.by, "b");
  assert.equal(a.hit!.target, "a");
});
test("five slots are bounded, share one combat state and checkpoints reject identity corruption", () => {
  const a = createArena({ ...DEFAULT_TUNING, experiment: "ball" });
  syncKeepers(
    a,
    Array.from({ length: 5 }, (_, slot) => ({
      id: `p${slot}`,
      slot,
      generation: 1,
      connected: true,
    })),
  );
  for (let i = 0; i < 120; i++) stepArena(a);
  const decoded = decodeArena(encodeArena(a))!;
  assert.ok(decoded);
  assert.equal(new Set(decoded.keepers.map((k) => k.world.combat)).size, 1);
  const raw = JSON.parse(JSON.stringify(encodeArena(a)));
  raw.keepers[1].id = raw.keepers[0].id;
  assert.equal(decodeArena(raw), undefined);
  raw.keepers[1].id = "p1";
  raw.keepers[1].body.slot = 4;
  assert.equal(decodeArena(raw), undefined);
  raw.keepers[1].body.slot = 1;
  raw.keepers.push(raw.keepers[0]);
  assert.equal(decodeArena(raw), undefined);
  a.keepers[2]!.world.input.fire = true;
  syncKeepers(
    a,
    a.keepers.map((k) => ({ ...k, generation: k.slot === 2 ? 2 : 1 })),
  );
  assert.equal(a.keepers[2]!.world.input.fire, false);
});
test("personal return preserves shared props and disconnected keepers cannot attack", () => {
  const a = createArena({ ...DEFAULT_TUNING, experiment: "target" });
  syncKeepers(a, [
    { id: "a", slot: 0, generation: 1, connected: true },
    { id: "b", slot: 1, generation: 1, connected: true },
  ]);
  a.combat.target!.x = 470 * S;
  a.keepers[1]!.world.input.reset = true;
  stepArena(a);
  assert.equal(a.combat.target!.x, 470 * S);
  assert.equal(a.keepers[1]!.world.x, 170 * S);
  syncKeepers(
    a,
    a.keepers.map((k) => ({ ...k, connected: k.slot !== 1 })),
  );
  const away = a.keepers[1]!.world;
  away.input = { ...NEUTRAL, move: 1, fire: true };
  const x = away.x;
  stepArena(a);
  assert.equal(away.x, x);
  assert.equal(away.hook.phase, "ready");
});
test("real runtime repairs loss/reorder/duplicates, restores a refreshed member and survives creator departure", () => {
  const mesh = new Mesh(),
    a = mesh.join("a");
  mesh.run(500);
  a.command({ type: "join", name: "A" });
  mesh.run(500);
  const b = mesh.join("b");
  mesh.run(1500);
  b.command({ type: "join", name: "B" });
  mesh.run(1000);
  assert.equal(a.state()!.seats.size, 2);
  assert.equal(a.command({ type: "action", action: "start" }), true);
  mesh.run(1000);
  let packet = 0;
  mesh.fast = () => {
    packet++;
    return packet % 7 === 0
      ? { drop: true }
      : {
          delay: packet % 3 === 0 ? 160 : 20,
          duplicate: packet % 5 === 0 ? 190 : undefined,
        };
  };
  a.input({ ...NEUTRAL, move: 1, jump: true });
  b.input({ ...NEUTRAL, fire: true, aimX: 310, aimY: 782 });
  mesh.run(600);
  a.clear();
  b.clear();
  mesh.run(2500);
  mesh.fast = () => ({ delay: 20 });
  mesh.run(2000);
  const common = Math.min(a.state()!.tick, b.state()!.tick) - 10;
  assert.equal(a.hashAt(common), b.hashAt(common));
  const saved = hash(a.state()!),
    bad = encode(a.state()!);
  bad[4] = [];
  assert.equal(decode(bad, a.state()!.tick), undefined);
  assert.equal(hash(a.state()!), saved);
  b.stop();
  mesh.run(1200);
  const returning = mesh.join("b");
  mesh.run(2500);
  assert.equal(returning.state()!.seats.size, 2);
  assert.equal(returning.state()!.seats.get("b")!.generation, 2);
  assert.equal(
    returning.state()!.simulation.keepers.find((k) => k.id === "b")!.world.input
      .fire,
    false,
  );
  const resumedTick = Math.min(a.state()!.tick, returning.state()!.tick) - 10;
  assert.equal(a.hashAt(resumedTick), returning.hashAt(resumedTick));
  a.stop();
  mesh.run(6500);
  assert.equal(
    returning.command({
      type: "settings",
      settings: { ...DEFAULT_TUNING, experiment: "ball" },
    }),
    true,
  );
  mesh.run(500);
  assert.equal(returning.state()!.settings.experiment, "ball");
  returning.stop();
});
test("session refresh retains credentials, display is separate and public links contain only room flags", () => {
  const backing = new Map<string, string>();
  const store = sessionStore(() => ({
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => {
      backing.set(k, v);
    },
  }));
  saveCreator(store, "ABCDEF", "private-creator");
  assert.equal(
    sessionToken(store, "ABCDEF", false, () => "new"),
    "private-creator",
  );
  assert.equal(
    sessionToken(store, "ABCDEF", true, () => "display"),
    "display",
  );
  assert.equal(
    new URL(
      inviteUrl(
        "http://localhost:58826/hook-havok/?token=secret&mute&touch=1",
        "ABCDEF",
      ),
    ).search,
    "?room=ABCDEF&mute=",
  );
  const denied = sessionStore(() => {
    throw new Error("denied");
  });
  assert.equal(
    sessionToken(denied, "ABCDEF", false, () => "fallback"),
    "fallback",
  );
  assert.equal(
    sessionToken(denied, "ABCDEF", false, () => "different"),
    "fallback",
  );
});
