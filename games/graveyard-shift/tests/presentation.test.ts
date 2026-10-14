import test from "node:test";
import assert from "node:assert/strict";
import { draw, type Paint } from "../src/render/scene.js";
import { toView } from "../src/engine/view.js";
import { createWorld } from "../src/engine/world.js";
import { readPrefs, NightAudio } from "../src/app/audio.js";
import {
  safeStore,
  sessionFor,
  keys,
  roomFailure,
  NOT_OPEN,
  type Store,
} from "../src/app/session.js";
import { graveyardRegistration } from "../src/platform.js";
function storage(): Store {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}
test("renderer draws live state labels, tanks, resistance, tug, emergence, pulse and deposits without mutating it", () => {
  const text: string[] = [],
    coords: number[] = [];
  const call = (...n: unknown[]) => {
    coords.push(...n.filter((v): v is number => typeof v === "number"));
  };
  const c: Paint = {
    clearRect: call,
    createLinearGradient: () => ({ addColorStop() {} }),
    fillStyle: "",
    fillRect: call,
    beginPath: call,
    ellipse: call,
    fill: call,
    font: "",
    textAlign: "center",
    fillText: (s) => {
      text.push(s);
    },
    shadowColor: "",
    shadowBlur: 0,
    moveTo: call,
    lineTo: call,
    roundRect: call,
    save: call,
    translate: call,
    rotate: call,
    restore: call,
    strokeStyle: "",
    lineWidth: 1,
    stroke: call,
    quadraticCurveTo: call,
    bezierCurveTo: call,
    closePath: call,
    arc: call,
    globalAlpha: 1,
  };
  const w = createWorld(42, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  w.tick = 2;
  w.hunters[0]!.tank = [w.ghosts[0]!.id];
  w.ghosts[0]!.carrier = "a";
  w.hunters[0]!.deposit = 12;
  w.hunters[0]!.pulse = 5;
  w.hunters[0]!.protection = 15;
  w.hunters[1]!.beam = w.ghosts[3]!.id;
  w.ghosts[3]!.emerge = 0;
  w.ghosts[3]!.tug = 8;
  w.ghosts[2]!.emerge = 0;
  const before = structuredClone(w);
  draw(c, toView(w), "a");
  assert.deepEqual(w, before);
  for (const s of ["YOU", "P2", "1/5", "CONTAIN", "TUG!", "+1"])
    assert.ok(text.includes(s), s);
  assert.ok(coords.length > 100);
  assert.ok(coords.every(Number.isFinite));
});
test("session routing fences tokens by game and displays get fresh identities", () => {
  const s = storage(),
    k = keys("graveyard-shift"),
    valid = (v: string) => v === "AB42";
  assert.deepEqual(
    sessionFor("", s, "graveyard-shift", valid, () => "secret"),
    { kind: "landing" },
  );
  assert.deepEqual(
    sessionFor("?solo=1", s, "graveyard-shift", valid, () => "secret"),
    { kind: "solo" },
  );
  assert.equal(
    sessionFor("?room=bad", s, "graveyard-shift", valid, () => "secret").kind,
    "invalid",
  );
  const first = sessionFor(
    "?room=ab42",
    s,
    "graveyard-shift",
    valid,
    () => "secret",
  );
  assert.deepEqual(
    sessionFor("?room=AB42", s, "graveyard-shift", valid, () => "new"),
    first,
  );
  s.setItem(k.host("AB42"), "host");
  assert.deepEqual(
    sessionFor("?room=AB42", s, "graveyard-shift", valid, () => "new"),
    { kind: "room", code: "AB42", role: "host", token: "host" },
  );
  assert.deepEqual(
    sessionFor(
      "?room=AB42&display=1",
      s,
      "graveyard-shift",
      valid,
      () => "new",
    ),
    { kind: "room", code: "AB42", role: "display", token: "new" },
  );
  assert.equal(roomFailure("unknown game"), NOT_OPEN);
  assert.match(roomFailure("another game"), /another game/);
  assert.equal(roomFailure("Offline"), "Offline");
});
test("refused browser storage falls back safely; audio respects malformed preferences and temporary mute", () => {
  const blocked = safeStore(() => {
    throw Error("blocked");
  });
  blocked.setItem("x", "y");
  assert.equal(blocked.getItem("x"), "y");
  blocked.removeItem("x");
  assert.equal(blocked.getItem("x"), null);
  assert.equal(readPrefs(blocked).volume.music, 0.22);
  blocked.setItem("fuse-riders-audio", "{");
  assert.equal(readPrefs(blocked).muted.music, false);
  blocked.setItem(
    "fuse-riders-audio",
    JSON.stringify({
      muted: { music: true, effects: false },
      volume: { music: 3, effects: -1 },
    }),
  );
  assert.deepEqual(readPrefs(blocked), {
    muted: { music: true, effects: false },
    volume: { music: 1, effects: 0 },
  });
  const before = blocked.getItem("fuse-riders-audio");
  const a = new NightAudio(blocked, "?mute");
  a.resume();
  a.toggle();
  a.frame();
  a.cue("capture");
  a.visibility(true);
  a.stop();
  assert.equal(blocked.getItem("fuse-riders-audio"), before);
  assert.equal(new NightAudio(blocked, "?mute=0").silent, false);
});
test("platform registers rooms without accepting unimplemented career reports", () => {
  assert.equal(graveyardRegistration.id, "graveyard-shift");
  assert.equal(graveyardRegistration.isBot("bot:1"), true);
  assert.equal(graveyardRegistration.parseStats({}, 1), undefined);
  assert.deepEqual(graveyardRegistration.emptyTotals(), {});
  assert.equal(graveyardRegistration.parseTotals({ unexpected: 1 }), undefined);
  assert.deepEqual(graveyardRegistration.parseTotals({}), {});
});
