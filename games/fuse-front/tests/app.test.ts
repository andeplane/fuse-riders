import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStorage } from "fuse-ui/safe-storage";
import { DRAW, NO_WINNER, fortSite } from "../src/engine/index.js";
import {
  COUNTDOWN_TICKS,
  DEFAULT_SETTINGS,
  mapOf,
  view,
} from "../src/online/game.js";
import {
  banner,
  cycleDifficulty,
  mapOptions,
  slotsOf,
} from "../src/app/model.js";
import { keys, roomFailure, sessionFor } from "../src/app/session.js";
import { frontRegistration } from "../src/platform.js";
import { Mesh } from "./fixtures/mesh.js";

test("the registration admits rooms and reports nothing yet", () => {
  assert.equal(frontRegistration.id, "fuse-front");
  assert.equal(frontRegistration.parseStats({}, 1), undefined);
  assert.deepEqual(frontRegistration.parseTotals({}), {});
  assert.equal(frontRegistration.parseTotals({ wins: 1 }), undefined);
});

test("the page's query and stored tokens decide landing, solo, host, joiner or shared screen", () => {
  const store = createMemoryStorage();
  const valid = (code: string) => /^[A-Z]{4}$/.test(code);
  let n = 0;
  const at = (search: string) =>
    sessionFor(search, store, valid, () => `t${++n}`);
  assert.deepEqual(at(""), { kind: "landing" });
  assert.deepEqual(at("?solo=1"), { kind: "solo" });
  assert.deepEqual(at("?room=no"), { kind: "invalid", code: "NO" });
  const joiner = at("?room=abcd");
  assert.deepEqual(joiner, { kind: "room", code: "ABCD", role: "joiner", token: "t1" }); // prettier-ignore
  assert.deepEqual(at("?room=ABCD"), joiner, "a refresh is the same member");
  store.setItem(keys.host("WXYZ"), "host-token");
  assert.deepEqual(at("?room=WXYZ"), { kind: "room", code: "WXYZ", role: "host", token: "host-token" }); // prettier-ignore
  assert.deepEqual(at("?room=WXYZ&display=1"), { kind: "room", code: "WXYZ", role: "display", token: "t2" }); // prettier-ignore
  assert.match(roomFailure("unknown game fuse-front"), /not open/);
  assert.match(roomFailure("room of another game"), /another game/);
  assert.equal(roomFailure("full"), "full");
});

test("the lobby model lists the slots a start plays, and the board maps clicks and banners", () => {
  const mesh = new Mesh("host", DEFAULT_SETTINGS);
  const host = mesh.join("host");
  mesh.run(300);
  host.command({ type: "join", name: "Ada" });
  mesh.run(500);
  const room = view(host.roomState()!);
  const slots = slotsOf(room, "host");
  assert.deepEqual(
    slots.map((s) => [s.slot, s.team, s.bot, s.self]),
    [
      [0, 0, false, true],
      [1, 1, true, false],
    ],
  );
  assert.equal(
    slotsOf({ ...room, settings: { ...room.settings, size: 3 } }, "host")
      .length,
    6,
  );
  const harder = cycleDifficulty(DEFAULT_SETTINGS, 1);
  assert.equal(harder.bots[1], "hard");
  assert.equal(cycleDifficulty(harder, 1).bots[1], "easy");
  assert.equal(DEFAULT_SETTINGS.bots[1], "normal", "the input is left alone");
  assert.equal(banner(NO_WINNER, 0), "");
  assert.equal(banner(DRAW, 0), "DRAW");
  assert.equal(banner(1, 1), "VICTORY");
  assert.equal(banner(1, 0), "DEFEAT");
  assert.equal(banner(0, -1), "RED WINS");
});

test("the runtime logs this device's controls only while it rides a seat in a running match", () => {
  const mesh = new Mesh("host", DEFAULT_SETTINGS);
  const host = mesh.join("host");
  mesh.run(300);
  host.command({ type: "join", name: "Ada" });
  mesh.run(500);
  assert.equal(host.slot(), -1);
  assert.equal(host.move(1, 1), false, "no controls in the lobby");
  assert.ok(
    host.command({
      type: "settings",
      settings: cycleDifficulty(DEFAULT_SETTINGS, 1),
    }),
  );
  mesh.run(200);
  assert.ok(host.command({ type: "action", action: "start" }));
  mesh.run(500 + COUNTDOWN_TICKS * 50);
  const room = host.roomState()!;
  assert.equal(room.stage, "running");
  assert.equal(
    room.play.bots[1],
    "hard",
    "the bot plays at the picked difficulty",
  );
  assert.equal(host.slot(), 0);
  const map = mapOf(room);
  assert.equal(
    map.name,
    "Rust Canyon",
    "a 1v1 with no map chosen plays its default",
  );
  const target = fortSite(map, 1);
  assert.ok(host.move(target.x, target.y));
  assert.ok(host.stance("hold"));
  mesh.run(300);
  const world = host.roomState()!.world!;
  assert.equal(world.heroes[0]!.goal, target.y * map.width + target.x);
  assert.equal(world.players[0]!.stance, "hold");
  const seen = view(host.roomState()!).world!;
  assert.equal(seen.heroes.length, 2);
  assert.equal(seen.heroes[0]!.team, 0);
  assert.equal(seen.heroes[0]!.level, 1);
  assert.equal(seen.heroes[0]!.hp, seen.heroes[0]!.maxHp);
});

test("the lobby offers the maps that hold the battle size, lighting the one a start would play", () => {
  const offered = (size: number, map: string | null) =>
    mapOptions({ ...DEFAULT_SETTINGS, size, map })
      .map((o) => (o.on ? `[${o.id}]` : o.id))
      .join(" ");
  assert.equal(
    offered(1, null),
    "dust-basin [rust-canyon] glass-lakes iron-delta",
  );
  assert.equal(offered(2, "dust-basin"), "[dust-basin] glass-lakes iron-delta");
  assert.equal(offered(3, "glass-lakes"), "dust-basin [iron-delta]");
  assert.equal(
    mapOptions({ ...DEFAULT_SETTINGS, size: 3, map: null })[1]!.label,
    "Iron Delta 256×192",
  );
});
