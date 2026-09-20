import test from "node:test";
import assert from "node:assert/strict";
import { BOT, JOIN, type RuntimeDependencies } from "fuse-netcode";
import {
  HOLD,
  ROLL,
  TARGET,
  createRoom,
  diceView,
  type DiceRoom,
  type DiceView,
} from "../src/game/index.js";
import { pips, presentTable, type Viewer } from "../src/app/presenter.js";
import { dueReports, sendReport, type DueReport } from "../src/app/reports.js";
import { DiceRuntime } from "../src/app/runtime.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
  type Store,
} from "../src/app/session.js";
import { FAST, addBot, fold, rig, runTo, started } from "./fixtures/dice.js";

const viewer = (patch: Partial<Viewer> = {}): Viewer => ({
  me: "a",
  host: true,
  solo: false,
  display: false,
  shared: false,
  ...patch,
});
const frame = (room: DiceRoom): DiceView => diceView(room);

/** Decides the current round for `id` by giving them the target and holding. */
function win(room: DiceRoom, id: string): void {
  if (room.turn !== id) fold(room, { [room.turn]: [[HOLD, room.turnNo]] });
  room.scores[id] = TARGET;
  fold(room, { [id]: [[HOLD, room.turnNo]] });
}

// ---- presenter ----

test("the lobby: roster, start and bots for the host, a wait for everyone else", () => {
  const room = createRoom("m0", FAST);
  fold(room, { a: [[BOT, "add", "bot:1", "Bot 1", 0]] });
  let model = presentTable(frame(room), viewer());
  assert.equal(model.screen, "lobby");
  assert.equal(model.headline, "WAITING FOR PLAYERS");
  assert.equal(model.askName, true, "not seated yet: offer the name entry");
  assert.equal(model.lobby.canStart, false, "one seat cannot start");
  assert.match(model.lobby.note, /two players start/);
  assert.deepEqual(model.lobby.removable, ["bot:1"]);
  assert.equal(model.lobby.canAddBot, true);

  const lobby = createRoom("m0", FAST);
  fold(lobby, {
    a: [
      [JOIN, "a", "Ada", 0, "fox", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
    ],
  });
  model = presentTable(frame(lobby), viewer());
  assert.equal(model.lobby.canStart, true);
  assert.equal(model.lobby.note, "");
  assert.equal(model.askName, false);
  assert.deepEqual(
    model.lobby.members.map((member) => [member.name, member.status]),
    [
      ["Ada (you)", "READY"],
      ["Bo", "READY"],
    ],
  );
  const guest = presentTable(frame(lobby), viewer({ me: "b", host: false }));
  assert.equal(guest.lobby.showStart, false);
  assert.equal(guest.lobby.canAddBot, false);
  assert.deepEqual(guest.lobby.removable, []);
  assert.equal(guest.lobby.note, "Waiting for the host to start");
  const tv = presentTable(
    frame(createRoom("m0", FAST)),
    viewer({ me: "tv", display: true }),
  );
  assert.equal(tv.askName, false, "the shared screen never joins");
  assert.equal(tv.lobby.note, "Waiting for players");
  assert.equal(tv.lobby.showStart, false);
  assert.equal(
    presentTable(frame(lobby), viewer({ me: "" })).askName,
    false,
    "nothing to offer before the room service admitted this device",
  );
});

test("the table: whose turn, the die from the view, the timer and the buttons", () => {
  const room = started();
  let model = presentTable(frame(room), viewer());
  assert.equal(model.screen, "table");
  assert.equal(model.headline, "YOUR TURN");
  assert.equal(model.detail, "Roll the die");
  assert.deepEqual(model.controls, { visible: true, roll: true, hold: false });
  assert.equal(model.die, undefined);
  assert.equal(model.timer, 1);
  assert.equal(model.seconds, FAST.turnTicks / 20);
  assert.equal(model.round, "ROUND 1 · FIRST TO 50");

  rig(room, 5);
  fold(room, { a: [[ROLL, 1]] });
  model = presentTable(frame(room), viewer());
  assert.equal(model.die?.value, 5);
  assert.deepEqual(model.die?.pips, pips(5));
  assert.equal(model.turnTotal, 5);
  assert.equal(model.detail, "Hold to bank 5, or roll on");
  assert.deepEqual(model.controls, { visible: true, roll: true, hold: true });
  const [ada, bo] = model.players;
  assert.equal(ada!.current, true);
  assert.equal(ada!.label, "Ada (you)");
  assert.equal(
    ada!.progress,
    5 / TARGET,
    "the turn total counts toward the bar",
  );
  assert.equal(bo!.label, "Bo");
  assert.equal(bo!.wins, "○○");

  const theirs = presentTable(frame(room), viewer({ me: "b", host: false }));
  assert.equal(theirs.headline, "ADA'S TURN");
  assert.equal(theirs.detail, "5 at risk");
  assert.deepEqual(theirs.controls, {
    visible: true,
    roll: false,
    hold: false,
  });
  runTo(room, room.tick + FAST.turnTicks / 2);
  assert.equal(presentTable(frame(room), viewer()).timer, 0.5);

  // A bust shows on the die and in the next player's detail; two equal rolls get two keys.
  const key = model.die!.key;
  rig(room, 1);
  fold(room, { a: [[ROLL, 1]] });
  model = presentTable(frame(room), viewer({ me: "b" }));
  assert.equal(model.die?.bust, true);
  assert.notEqual(model.die?.key, key);
  assert.equal(model.headline, "YOUR TURN");
  assert.equal(model.detail, "Ada rolled a 1: bust!");
  assert.equal(
    presentTable(frame(room), viewer()).headline,
    "BO'S TURN",
    "the possessive of a name",
  );
});

test("a rollback that changes the roll changes the die: the screen reads the view, not an event", () => {
  const room = started();
  const replay = structuredClone(room);
  rig(room, 6);
  fold(room, { a: [[ROLL, 1]] });
  rig(replay, 2);
  fold(replay, { a: [[ROLL, 1]] });
  const shown = presentTable(frame(room), viewer()).die!,
    corrected = presentTable(frame(replay), viewer()).die!;
  assert.equal(shown.key, corrected.key, "the same roll position");
  assert.deepEqual([shown.value, corrected.value], [6, 2]);
});

test("round and match results, the rematch for the host and the wait for a guest", () => {
  const room = started();
  win(room, "a");
  let model = presentTable(frame(room), viewer());
  assert.equal(model.headline, "ADA WINS ROUND 1");
  assert.equal(model.players[0]!.winner, true);
  assert.equal(model.players[0]!.wins, "●○");
  assert.deepEqual(model.controls, { visible: true, roll: false, hold: false });
  assert.equal(model.timer, 0);
  runTo(room, room.resumeAt);
  win(room, "a");
  model = presentTable(frame(room), viewer());
  assert.equal(room.stage, "over");
  assert.equal(model.headline, "ADA WINS THE MATCH");
  assert.equal(model.result?.title, "YOU WIN!");
  assert.equal(model.result?.host, true);
  assert.equal(model.result?.waiting, "");
  assert.match(
    model.result!.lines[0]!,
    /^Ada: 2 rounds, best turn \d+, 0 busts$/,
  );
  assert.match(model.result!.lines[1]!, /^Bo: 0 rounds/);
  const guest = presentTable(frame(room), viewer({ me: "b", host: false }));
  assert.equal(guest.result?.title, "ADA WINS");
  assert.equal(guest.result?.host, false);
  assert.match(guest.result!.waiting, /rematch/);
});

test("a shared-screen room: the TV shows the table, a seated phone is a controller", () => {
  const room = started();
  const tv = presentTable(
    frame(room),
    viewer({ me: "tv", host: false, display: true, shared: true }),
  );
  assert.equal(tv.layout, "table");
  assert.equal(tv.seated, false);
  assert.equal(tv.controls.visible, false);
  assert.equal(tv.headline, "ADA'S TURN");
  const phone = presentTable(frame(room), viewer({ shared: true }));
  assert.equal(phone.layout, "controller");
  assert.equal(phone.you?.id, "a");
  // The host on the TV itself is still not a seat: `display` wins.
  assert.equal(
    presentTable(frame(room), viewer({ display: true, shared: true })).seated,
    false,
  );
  // An away player is marked, a bot never is.
  const away = started(FAST, [addBot("bot:1", 2)]);
  away.seats.get("b")!.connected = false;
  const rows = presentTable(frame(away), viewer()).players;
  assert.deepEqual(
    rows.map((row) => [row.id, row.away, row.bot]),
    [
      ["a", false, false],
      ["b", true, false],
      ["bot:1", false, true],
    ],
  );
});

test("the solo seat is called You, without a second (you)", () => {
  const room = createRoom("m0", FAST);
  fold(room, { a: [[JOIN, "solo", "You", 0, "robot", 1]] });
  const model = presentTable(frame(room), viewer({ me: "solo", solo: true }));
  assert.equal(model.lobby.members[0]!.name, "You");
});

test("die faces", () => {
  assert.deepEqual(pips(0), Array(9).fill(false));
  for (let value = 1; value <= 6; value++)
    assert.equal(pips(value).filter(Boolean).length, value);
  assert.deepEqual(pips(1), [
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
  ]);
});

// ---- reports ----

test("a device reports a round once it is confirmed, the match once its last round is, and each once", () => {
  const room = started();
  win(room, "a");
  const decided = room.history[0]!.tick;
  assert.deepEqual(dueReports(room, "a", decided - 1, new Set()), []);
  const [round] = dueReports(room, "a", decided, new Set());
  assert.equal(round?.path, "round-results");
  assert.equal(round?.result.round, 1);
  assert.deepEqual(dueReports(room, "a", decided, new Set([round!.key])), []);
  assert.deepEqual(dueReports(room, "tv", decided, new Set()), []);
  assert.deepEqual(dueReports(room, "bot:1", decided, new Set()), []);
  assert.deepEqual(dueReports(room, "", decided, new Set()), []);
  runTo(room, room.resumeAt);
  win(room, "a");
  const sent = new Set([round!.key]);
  const due = dueReports(room, "b", room.tick - 1, sent);
  assert.deepEqual(due, [], "the deciding round is not confirmed yet");
  const later = dueReports(room, "b", room.tick, sent);
  assert.deepEqual(
    later.map((report) => report.path),
    ["round-results", "results"],
  );
  assert.equal(later[1]!.result.winnerId, "a");
});

test("a report goes with the room token, retries a lost race and stops at a refusal", async () => {
  const room = started();
  win(room, "a");
  const [report] = dueReports(room, "a", room.tick, new Set()) as [DueReport];
  const calls: { url: string; init: RequestInit }[] = [];
  const replies = [
    () => new Response("{}", { status: 503 }),
    () => {
      throw new TypeError("offline");
    },
    () => Response.json({ status: "confirmed" }),
  ];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return replies.shift()!();
  }) as typeof fetch;
  const waits: number[] = [];
  const wait = async (ms: number) => {
    waits.push(ms);
  };
  assert.equal(
    await sendReport("https://rooms/x", report, {
      fetch: fetcher,
      roomToken: "t0k",
      wait,
    }),
    "confirmed",
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [1000, 2000]);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer t0k");
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), {
    result: report.result,
  });

  const once = (response: Response) =>
    (async () => response) as unknown as typeof fetch;
  assert.equal(
    await sendReport("u", report, {
      fetch: once(Response.json({ status: "pending" })),
      roomToken: "t",
      wait,
    }),
    "pending",
  );
  assert.equal(
    await sendReport("u", report, {
      fetch: once(new Response("{}", { status: 400 })),
      roomToken: "t",
      wait,
    }),
    "failed",
    "a refusal is final",
  );
  let forbidden = 0;
  assert.equal(
    await sendReport(
      "u",
      report,
      {
        fetch: (async () => {
          forbidden++;
          return new Response("{}", { status: 403 });
        }) as unknown as typeof fetch,
        roomToken: "t",
        wait,
      },
      2,
    ),
    "failed",
  );
  assert.equal(forbidden, 2, "a 403 is a reconnecting socket: retried");
});

// ---- session ----

function memoryStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}
const valid = (code: string) => /^[A-Z0-9]{4,10}$/.test(code);

test("the page's query decides landing, solo, creator, joiner or shared screen", () => {
  const store = memoryStore(),
    names = keys("dice");
  let n = 0;
  const secret = () => `secret-${++n}`;
  const session = (search: string) =>
    sessionFor(search, store, "dice", valid, secret);
  assert.deepEqual(session(""), { kind: "landing" });
  assert.deepEqual(session("?mute"), { kind: "landing" });
  assert.deepEqual(session("?solo=1&mute"), { kind: "solo" });
  assert.deepEqual(session("?room=no!"), { kind: "invalid", code: "NO!" });
  store.setItem(names.host("AB42"), "host-token");
  assert.deepEqual(session("?room=ab42"), {
    kind: "room",
    code: "AB42",
    role: "host",
    token: "host-token",
  });
  const joiner = session("?room=CD12");
  assert.deepEqual(joiner, {
    kind: "room",
    code: "CD12",
    role: "joiner",
    token: "secret-1",
  });
  assert.deepEqual(
    session("?room=CD12"),
    joiner,
    "a refresh is the same member",
  );
  assert.deepEqual(session("?room=AB42&display=1"), {
    kind: "room",
    code: "AB42",
    role: "display",
    token: "secret-2",
  });
  assert.notDeepEqual(
    session("?room=AB42&display=1"),
    session("?room=AB42&display=1"),
    "the shared screen takes a fresh token every load",
  );
  assert.equal(keys("dice").name, "dice-player-name");
});

test("storage that throws falls back to memory for the page's life", () => {
  const refused = safeStore(() => {
    throw new Error("SecurityError");
  });
  assert.equal(refused.getItem("a"), null);
  refused.setItem("a", "1");
  assert.equal(refused.getItem("a"), "1");
  refused.removeItem("a");
  assert.equal(refused.getItem("a"), null);

  const backing = memoryStore();
  const working = safeStore(() => backing as unknown as Storage);
  working.setItem("k", "v");
  assert.equal(backing.data.get("k"), "v");
  assert.equal(working.getItem("k"), "v");
  working.removeItem("k");
  assert.equal(backing.data.has("k"), false);

  let fail = false;
  const flaky = safeStore(
    () =>
      ({
        getItem: (key: string) => {
          if (fail) throw new Error("quota");
          return key === "probe" ? null : "stored";
        },
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {
          throw new Error("quota");
        },
      }) as unknown as Storage,
  );
  flaky.setItem("x", "1");
  assert.equal(flaky.getItem("x"), "stored");
  fail = true;
  assert.equal(flaky.getItem("x"), "1", "a failing read falls back to memory");
  flaky.removeItem("x");
  assert.equal(flaky.getItem("x"), null);
});

test("a service that does not host the game yet says so in the page's words", () => {
  assert.equal(roomFailure("Unknown game"), NOT_OPEN);
  assert.equal(
    roomFailure("Room is for another game"),
    "That code is a room of another game",
  );
  assert.equal(roomFailure("Room not found"), "Room not found");
});

// ---- runtime ----

test("ROLL and HOLD are logged only on this device's own turn, for that turn", () => {
  let now = 0;
  const loops: (() => void)[] = [];
  const dependencies: RuntimeDependencies = {
    now: () => now,
    hidden: () => false,
    token: () => `m${now}`,
    generation: () => 1,
    schedule: (callback) => {
      loops.push(callback);
      return () => {};
    },
    onVisibilityChange: () => () => {},
  };
  const frames: DiceView[] = [];
  const runtime = new DiceRuntime(
    "SOLO",
    FAST,
    {
      state: (view) => frames.push(view),
      event: () => {},
      status: () => {},
      ready: () => {},
    },
    { dependencies, humanName: "Ada" },
  );
  assert.equal(runtime.play("roll"), false, "no world yet");
  assert.equal(runtime.roomState(), undefined);
  runtime.start();
  const run = (ms: number) => {
    for (let step = 0; step < ms / 10; step++) {
      now += 10;
      for (const loop of loops) loop();
    }
  };
  run(100);
  assert.equal(runtime.self, "solo");
  const room = runtime.roomState()!;
  assert.equal(room.stage, "running");
  assert.equal(room.turn, "solo", "the human opens round 1");
  assert.equal(runtime.play("hold"), false, "nothing to bank");
  assert.equal(runtime.play("roll"), true);
  run(100);
  const after = runtime.roomState()!;
  assert.equal(after.rolls, 1);
  const view = frames.at(-1)!;
  assert.equal(view.lastRoll?.id, "solo");
  if (after.turn === "solo") {
    assert.equal(runtime.play("hold"), true);
    run(100);
    assert.notEqual(runtime.roomState()!.turn, "solo");
  }
  assert.equal(runtime.play("roll"), false, "the bot's turn");
  runtime.stop();
});
