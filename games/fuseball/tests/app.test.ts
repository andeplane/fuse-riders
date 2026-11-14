import test from "node:test";
import assert from "node:assert/strict";
import type { SeatRecord } from "fuse-netcode";
import { createPlayMetrics } from "fuse-ui/play-metrics";
import {
  TARGET,
  ZAP_STEPS,
  createWorld,
  resetPoint,
  type MapId,
  type World,
} from "../src/engine/index.js";
import { createRoom, view, type Room, type View } from "../src/online/game.js";
import {
  GOAL_SETTLE_STEPS,
  MAP_BLURBS,
  createGoalWatch,
  playRound,
  present,
  type Viewer,
} from "../src/app/presenter.js";
import { createSfx, type SfxDependencies } from "../src/app/audio.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "../src/app/session.js";
import { sendReport, type DueReport } from "../src/app/reports.js";
import type { Cue } from "../src/render/effects.js";

const host: Viewer = { me: "a", host: true, solo: false, display: false };
const guest: Viewer = { me: "b", host: false, solo: false, display: false };
const tv: Viewer = { me: "tv", host: false, solo: false, display: true };

const seat = (
  id: string,
  name: string,
  slot: number,
  extra: Partial<SeatRecord> = {},
): SeatRecord => ({
  id,
  name,
  slot,
  avatarId: "robot",
  connected: true,
  bot: false,
  generation: 1,
  ...extra,
});

/** A room with Ada (the host) and Bo seated, in `stage`, on `mapId`; `shape` adjusts it before it is viewed. */
function room(
  stage: Room["stage"],
  shape: (room: Room, world: World | null) => void = () => {},
  mapId: MapId = "gridlock",
): View {
  const state = createRoom("m1", { display: false, mapId });
  state.seats.set("a", seat("a", "Ada", 0));
  state.seats.set("b", seat("b", "Bo", 1));
  if (stage !== "lobby") {
    state.stage = stage;
    state.world = createWorld(mapId, ["a", "b"]);
    state.roster = [
      { id: "a", name: "Ada", slot: 0, bot: false },
      { id: "b", name: "Bo", slot: 1, bot: false },
    ];
  }
  shape(state, state.world);
  return view(state);
}
/** `team` scores: the world as the engine leaves it on that step, `into` steps into the celebration. */
function point(world: World, team: 0 | 1, ownGoal = false, into = 0): void {
  world.score[team]++;
  world.lastScorer = team;
  const scorer = world.riders[team],
    other = world.riders[team === 0 ? 1 : 0];
  if (ownGoal) other.ownGoals++;
  else scorer.goals++;
  other.zapped = true;
  world.ball.live = false;
  world.phase = "zap";
  world.phaseSteps = ZAP_STEPS - into;
  world.suddenDeath =
    world.score[0] >= TARGET - 1 && world.score[1] >= TARGET - 1;
}

test("the lobby: the host picks the arena, adds a bot and starts; a guest waits; a newcomer names itself", () => {
  const two = present(room("lobby"), host);
  assert.equal(two.screen, "lobby");
  assert.deepEqual(
    two.lobby.members.map((m) => [m.name, m.slot, m.you]),
    [
      ["Ada", 0, true],
      ["Bo", 1, false],
    ],
  );
  assert.equal(two.lobby.canStart, true);
  assert.equal(two.lobby.showStart, true);
  assert.equal(two.lobby.canAddBot, false, "both seats are taken");
  assert.equal(two.lobby.editable, true);
  assert.equal(two.lobby.note, "");
  assert.deepEqual(
    two.lobby.maps.map((m) => [m.id, m.name, m.selected]),
    [
      ["gridlock", "Gridlock", true],
      ["downlink", "Downlink", false],
      ["halo", "Halo", false],
      ["overflow", "Overflow", false],
      ["firewall", "Firewall", false],
      ["cornercase", "Corner Case", false],
      ["coredump", "Core Dump", false],
      ["bruteforce", "Brute Force", false],
      ["bouncerate", "Bounce Rate", false],
      ["portforward", "Port Forward", false],
      ["backdoor", "Backdoor", false],
      ["quadcore", "Quad Core", false],
      ["bitstream", "Bitstream", false],
      ["memoryleak", "Memory Leak", false],
    ],
  );
  assert.equal(two.lobby.maps[2]!.blurb, MAP_BLURBS.halo);
  assert.equal(two.mapName, "Gridlock");
  assert.deepEqual(two.sides, []);
  assert.equal(two.names, undefined);
  assert.equal(two.status, "");
  assert.equal(two.result, null);

  const alone = present(
    room("lobby", (r) => r.seats.delete("b"), "halo"),
    host,
  );
  assert.equal(alone.lobby.canStart, false);
  assert.equal(alone.lobby.canAddBot, true);
  assert.match(alone.lobby.note, /needs two riders/);
  assert.equal(alone.lobby.maps[2]!.selected, true);

  const bots = present(
    room("lobby", (r) => {
      r.seats.delete("b");
      r.seats.set("bot:1", seat("bot:1", "Volta", 1, { bot: true }));
    }),
    host,
  );
  assert.deepEqual(bots.lobby.removable, ["bot:1"]);
  assert.equal(bots.lobby.members[1]!.connected, true);

  const waiting = present(room("lobby"), guest);
  assert.equal(waiting.lobby.showStart, false);
  assert.equal(waiting.lobby.editable, false);
  assert.deepEqual(waiting.lobby.removable, []);
  assert.equal(waiting.lobby.note, "Waiting for the host to start");
  assert.equal(waiting.askName, false);

  const stranger = present(room("lobby"), { ...guest, me: "c" });
  assert.equal(stranger.askName, true);
  assert.equal(stranger.seated, false);
  const empty = present(
    room("lobby", (r) => r.seats.clear()),
    { ...guest, me: "c" },
  );
  assert.equal(empty.lobby.note, "Pick a name to take a seat");
  assert.equal(present(room("lobby"), tv).askName, false);
  assert.equal(
    present(room("lobby"), { ...host, solo: true, me: "x" }).askName,
    false,
  );

  const shared = present(
    room("lobby", (r) => (r.settings.display = true)),
    host,
  );
  assert.match(shared.lobby.note, /Shared screen/);
  const watched = present(
    room("lobby", (r) =>
      r.seats.set("w", seat("w", "Wim", 2, { watcher: true })),
    ),
    { ...guest, me: "w" },
  );
  assert.equal(watched.lobby.watchers, 1);
  assert.equal(watched.seated, false);
  assert.equal(watched.askName, false, "a watcher already has a name");
});

test("in a match: the arena on devices and the TV, a controller on the phones of a shared screen", () => {
  const mine = present(room("running"), host);
  assert.equal(mine.screen, "play");
  assert.equal(mine.riding, true);
  assert.equal(mine.localSlot, 0);
  assert.deepEqual(mine.names, ["Ada", "Bo"]);
  assert.deepEqual(
    mine.sides.map((s) => [s.name, s.slot, s.you, s.away, s.score]),
    [
      ["Ada", 0, true, false, 0],
      ["Bo", 1, false, false, 0],
    ],
  );
  assert.equal(present(room("running"), guest).localSlot, 1);

  const shared = (r: Room) => {
    r.settings.display = true;
    r.play.display = true;
  };
  assert.equal(present(room("running", shared), host).screen, "controller");
  const screen = present(room("running", shared), tv);
  assert.equal(screen.screen, "play");
  assert.equal(screen.localSlot, -1);
  assert.equal(screen.riding, false);
  assert.equal(screen.note, "", "the TV shows no note");
  // The room made on the big screen itself: its creator holds no seat and that page is the TV in all but name.
  // No name bar and no note over the arena while the match is on; both riders are on their phones.
  const creatorTv: Viewer = {
    me: "tvhost",
    host: true,
    solo: false,
    display: false,
  };
  for (const stage of ["running", "over"] as const) {
    const big = present(room(stage, shared), creatorTv);
    assert.equal(big.screen, "play");
    assert.equal(big.askName, false, `${stage}: no name bar over the arena`);
    assert.equal(big.note, "");
  }
  assert.equal(
    present(
      room("lobby", (r) => (r.settings.display = true)),
      creatorTv,
    ).askName,
    true,
    "back in the lobby it may still take a seat",
  );
  assert.equal(
    present(room("running"), creatorTv).askName,
    true,
    "an ordinary room still offers a visitor the next match",
  );
  // After the match the host's phone starts the next one, and the other rider's says who will.
  const done = (r: Room, w: World | null) => {
    shared(r);
    w!.phase = "over";
  };
  const hostPhone = present(room("over", done), host),
    guestPhone = present(room("over", done), guest);
  assert.equal(hostPhone.screen, "controller");
  assert.equal(hostPhone.result?.host, true);
  assert.equal(guestPhone.screen, "controller");
  assert.equal(guestPhone.result?.host, false);
  assert.match(guestPhone.result!.waiting, /Waiting for the host/);
  // A watcher's phone has nothing to control: it sees the arena.
  const watcher = present(
    room("running", (r) => {
      shared(r);
      r.seats.set("w", seat("w", "Wim", 2, { watcher: true }));
    }),
    { ...guest, me: "w" },
  );
  assert.equal(watcher.screen, "play");
  assert.equal(watcher.note, "Watching");
  assert.equal(
    present(room("running"), { ...guest, me: "c" }).note,
    "Pick a name to ride in the next match",
  );
  // Seated after the match began: the seat rides from the next one.
  const late = present(
    room("running", (r) => {
      r.seats.delete("b");
      r.seats.set("c", seat("c", "Cy", 1));
    }),
    { ...guest, me: "c" },
  );
  assert.equal(late.note, "You ride in the next match");
  assert.equal(late.sides[1]!.away, true, "Bo's seat is gone");
  const dropped = present(
    room("running", (r) => (r.seats.get("b")!.connected = false)),
    host,
  );
  assert.equal(dropped.sides[1]!.away, true);
  const bot = present(
    room("running", (r) => {
      r.roster[1]!.bot = true;
      r.seats.delete("b");
    }),
    host,
  );
  assert.equal(bot.sides[1]!.away, false, "a bot is never away");
});

test("the controller's line: the countdown, the score, sudden death, a goal and the result", () => {
  assert.equal(present(room("running"), host).status, "0 – 0 · 3");
  const play = (shape: (world: World) => void) =>
    room("running", (_, world) => {
      world!.phase = "play";
      world!.phaseSteps = 0;
      shape(world!);
    });
  assert.equal(
    present(
      play((w) => (w.score = [1, 2])),
      host,
    ).status,
    "1 – 2",
  );
  const sudden = (w: World) => {
    w.score = [2, 2];
    w.suddenDeath = true;
  };
  assert.equal(present(play(sudden), host).status, "SUDDEN DEATH");
  assert.equal(
    present(
      room("running", (_, w) => sudden(w!)),
      host,
    ).status,
    "SUDDEN DEATH · 3",
  );
  const scored = room("running", (_, w) => point(w!, 0));
  assert.equal(present(scored, host).status, "YOU SCORED!");
  assert.equal(present(scored, guest).status, "ZAPPED!");
  assert.equal(present(scored, tv).status, "GOAL!");

  const guide = present(room("running"), host);
  assert.equal(guide.controlsVisible, true);
  assert.equal(guide.guideKey, "m1");
  const second = room("running", (_, w) => {
    w!.score = [1, 0];
    resetPoint(w!);
  });
  assert.equal(present(second, host).controlsVisible, false);
  assert.equal(
    present(
      play(() => {}),
      host,
    ).controlsVisible,
    false,
  );
});

test("the match result: the winner, the score, each rider's numbers, and who can rematch", () => {
  const over = room("over", (r, w) => {
    w!.score = [3, 1];
    w!.phase = "over";
    w!.phaseSteps = 0;
    w!.riders[0].goals = 2;
    w!.riders[1].goals = 1;
    w!.riders[1].ownGoals = 1;
    w!.bubbles[0].seq = 7;
    w!.bubbles[1].seq = 1;
    r.decided = { clock: 100, winner: "a", finishers: ["a", "b"] };
  });
  const winner = present(over, host);
  assert.equal(winner.screen, "play");
  assert.equal(winner.riding, false, "the controls are done");
  assert.equal(winner.status, "YOU WIN!");
  assert.deepEqual(winner.result, {
    title: "YOU WIN!",
    lines: [
      "Ada 3 – 1 Bo",
      "Ada: 2 goals, 0 own goals, 7 bubbles",
      "Bo: 1 goal, 1 own goal, 1 bubble",
    ],
    host: true,
    waiting: "",
  });
  const loser = present(over, guest);
  assert.equal(loser.status, "YOU LOSE");
  assert.equal(loser.result?.title, "ADA WINS");
  assert.equal(loser.result?.host, false);
  assert.match(loser.result!.waiting, /Waiting for the host/);
  assert.equal(present(over, tv).status, "3 – 1");
  assert.equal(present(over, tv).note, "");
  const unknown = room("over", (r, w) => {
    w!.phase = "over";
    r.decided = { clock: 1, winner: "gone", finishers: [] };
  });
  assert.equal(present(unknown, host).result?.title, "MATCH OVER");
});

test("goals are reported once each, after they settle, by the device they belong to", () => {
  const watch = createGoalWatch();
  const at = (shape: (world: World, room: Room) => void) =>
    room("running", (r, w) => shape(w!, r), "halo");
  assert.deepEqual(watch(room("lobby"), "a"), []);
  assert.deepEqual(
    watch(
      at(() => {}),
      "a",
    ),
    [],
  );
  // Just scored: a rollback could still take it back.
  assert.deepEqual(
    watch(
      at((w) => point(w, 0, false, 5)),
      "a",
    ),
    [],
  );
  const settled = at((w) => point(w, 0, false, GOAL_SETTLE_STEPS));
  assert.deepEqual(watch(settled, "a"), [
    { mapId: "halo", ownGoal: false, suddenDeath: false, mine: true },
  ]);
  assert.deepEqual(watch(settled, "a"), [], "once");
  // The next point is the other rider's: their device reports it, not this one.
  const theirs = at((w) => {
    point(w, 0);
    point(w, 1, true, 200);
  });
  assert.deepEqual(watch(theirs, "a"), []);
  const other = createGoalWatch();
  assert.deepEqual(other(settled, "b"), [], "Ada's point is Ada's to report");
  assert.deepEqual(other(theirs, "b"), [
    { mapId: "halo", ownGoal: true, suddenDeath: false, mine: true },
  ]);

  // Against a bot the human reports both sides' points; the fifth at 2–2 is sudden death, seen after the reset.
  const bot = createGoalWatch();
  const versusBot = (shape: (world: World) => void) =>
    room("over", (r, w) => {
      r.roster[1]!.bot = true;
      shape(w!);
    });
  const fifth = versusBot((w) => {
    w.score = [2, 2];
    w.riders[0].goals = 2;
    w.riders[1].goals = 2;
    point(w, 1);
    w.phase = "over";
    w.phaseSteps = 0;
  });
  // A device that slept through four points reports none of them.
  assert.deepEqual(bot(fifth, "a"), []);
  const fresh = createGoalWatch();
  assert.deepEqual(
    fresh(
      versusBot((w) => {
        w.score = [2, 2];
        w.suddenDeath = true;
        resetPoint(w);
      }),
      "a",
    ),
    [],
  );
  assert.deepEqual(fresh(fifth, "a"), [
    { mapId: "gridlock", ownGoal: false, suddenDeath: true, mine: false },
  ]);
  // A watcher and the TV report nothing; a new match starts the count again.
  const tvWatch = createGoalWatch();
  tvWatch(
    at(() => {}),
    "tv",
  );
  assert.deepEqual(tvWatch(settled, "tv"), []);
  assert.deepEqual(
    watch(
      room("running", (r) => (r.matchId = "m2")),
      "a",
    ),
    [],
  );
  const next = room("running", (r, w) => {
    r.matchId = "m2";
    point(w!, 0, false, 300);
  });
  assert.deepEqual(watch(next, "a").length, 1);
});

test("a page that loads into a match under way reports only the goals scored from then on", () => {
  const at = (shape: (world: World) => void) =>
    room("running", (_r, w) => shape(w!));
  // A reload during the second point: the first, already on the board and long settled, was reported before.
  const reloaded = createGoalWatch();
  const one = at((w) => {
    point(w, 0, false, 300);
    resetPoint(w);
  });
  assert.deepEqual(reloaded(one, "a"), [], "not reported again");
  assert.deepEqual(reloaded(one, "a"), []);
  const two = at((w) => {
    point(w, 0);
    point(w, 0, false, GOAL_SETTLE_STEPS);
  });
  assert.deepEqual(reloaded(two, "a"), [
    { mapId: "gridlock", ownGoal: false, suddenDeath: false, mine: true },
  ]);
  // Loading in mid-celebration does not report that goal either: the page that saw it scored did.
  assert.deepEqual(createGoalWatch()(two, "a"), []);

  // Frames arrive before the page knows who it is: a point scored then waits, and is reported once it does.
  const early = createGoalWatch();
  assert.deepEqual(
    early(
      at(() => {}),
      "",
    ),
    [],
  );
  const scored = at((w) => point(w, 0, false, GOAL_SETTLE_STEPS));
  assert.deepEqual(early(scored, ""), [], "nobody to report it as yet");
  assert.deepEqual(early(scored, "a"), [
    { mapId: "gridlock", ownGoal: false, suddenDeath: false, mine: true },
  ]);
  assert.deepEqual(early(scored, "a"), []);
});

test("a match counts as started only while its first countdown runs", () => {
  const started: string[] = [];
  const metrics = (frames: View[]) => {
    const report = createPlayMetrics(
      (name) => void started.push(name),
      () => 0,
    );
    for (const view of frames)
      report({
        matchId: view.matchId,
        active: view.stage === "running",
        ended: view.stage === "over",
        round: playRound(view),
        playerCount: 2,
        botCount: 0,
        seated: false,
        mode: "online",
      });
  };
  const countdown = room("running"),
    playing = room("running", (_r, w) => {
      w!.phase = "play";
      w!.phaseSteps = 0;
    }),
    second = room("running", (_r, w) => {
      point(w!, 0);
      resetPoint(w!);
    }),
    over = room("over", (_r, w) => (w!.phase = "over"));
  assert.equal(playRound(room("lobby")), 2);
  assert.equal(playRound(countdown), 1);
  assert.equal(playRound(playing), 2);
  assert.equal(playRound(second), 2, "a later countdown is not the first");
  // There from the start: one start and one end.
  metrics([countdown, playing, second, over]);
  assert.deepEqual(started, ["Match Started", "Match Ended"]);
  // Joining or reloading mid-match: the end is seen, a second start is not invented.
  started.length = 0;
  metrics([playing, second, over]);
  assert.deepEqual(started, ["Match Ended"]);
});

test("sessions: solo, landing, a joiner's kept token, the creator's token and a fresh one for the TV", () => {
  const memory = new Map<string, string>();
  const store = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  const valid = (code: string) => /^[A-Z0-9]{4}$/.test(code);
  let made = 0;
  const secret = () => `token-${++made}`;
  const names = keys("fuseball");
  assert.equal(names.name, "fuseball-player-name");
  assert.equal(names.shared, "fuseball-shared-screen");
  const of = (search: string) =>
    sessionFor(search, store, "fuseball", valid, secret);
  assert.deepEqual(of("?solo=1"), { kind: "solo" });
  assert.deepEqual(of(""), { kind: "landing" });
  assert.deepEqual(of("?room=nope!"), { kind: "invalid", code: "NOPE!" });
  assert.deepEqual(of("?room=abcd"), {
    kind: "room",
    code: "ABCD",
    role: "joiner",
    token: "token-1",
  });
  assert.equal(of("?room=ABCD").kind === "room" && made, 1, "kept on refresh");
  memory.set(names.host("WXYZ"), "creator");
  assert.deepEqual(of("?room=WXYZ"), {
    kind: "room",
    code: "WXYZ",
    role: "host",
    token: "creator",
  });
  assert.deepEqual(of("?room=WXYZ&display=1"), {
    kind: "room",
    code: "WXYZ",
    role: "display",
    token: "token-2",
  });
  // Only `display=1` is the TV, as the analytics read it: anything else is the rider it would otherwise be.
  for (const query of [
    "?room=WXYZ&display=0",
    "?room=WXYZ&display",
    "?room=WXYZ&display=true",
  ])
    assert.deepEqual(of(query), {
      kind: "room",
      code: "WXYZ",
      role: "host",
      token: "creator",
    });

  const working = safeStore(() => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: () => null,
      length: 0,
    };
  });
  working.setItem("x", "1");
  assert.equal(working.getItem("x"), "1");
  working.removeItem("x");
  assert.equal(working.getItem("x"), null);
  const refused = safeStore(() => {
    throw new Error("blocked");
  });
  refused.setItem("x", "1");
  assert.equal(refused.getItem("x"), "1");
  refused.removeItem("x");
  assert.equal(refused.getItem("x"), null);
  const flaky = safeStore(() => ({
    getItem: (key: string) => {
      if (key === "probe") return null;
      throw new Error("quota");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("quota");
    },
    clear() {},
    key: () => null,
    length: 0,
  }));
  flaky.setItem("x", "1");
  assert.equal(flaky.getItem("x"), "1");
  flaky.removeItem("x");
  assert.equal(flaky.getItem("x"), null);

  assert.equal(roomFailure("unknown game fuseball"), NOT_OPEN);
  assert.match(roomFailure("room is for another game"), /another game/);
  assert.equal(roomFailure("full"), "full");
});

test("a report is retried on a lost race, a reconnecting socket and a dropped connection; other refusals are final", async () => {
  const report: DueReport = {
    key: "m1:match",
    path: "results",
    result: {
      matchId: "m1",
      length: 1,
      winnerId: "a",
      finishers: ["a"],
      players: [],
    },
  };
  const waits: number[] = [];
  const transport = (answers: (Response | Error)[]) => {
    const seen: RequestInit[] = [];
    return {
      seen,
      roomToken: "secret",
      wait: async (ms: number) => void waits.push(ms),
      fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init ?? {});
        const answer = answers.shift() ?? new Error("no answer");
        if (answer instanceof Error) throw answer;
        return answer;
      }) as typeof fetch,
    };
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status });

  const confirmed = transport([json(200, { status: "confirmed" })]);
  assert.equal(await sendReport("/r", report, confirmed), "confirmed");
  assert.equal(confirmed.seen.length, 1);
  assert.equal(
    new Headers(confirmed.seen[0]!.headers).get("Authorization"),
    "Bearer secret",
  );
  assert.deepEqual(JSON.parse(String(confirmed.seen[0]!.body)), {
    result: report.result,
  });
  const retried = transport([
    json(503, {}),
    new Error("offline"),
    json(200, { status: "pending" }),
  ]);
  assert.equal(await sendReport("/r", report, retried), "pending");
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(
    await sendReport("/r", report, transport([json(403, {}), json(400, {})])),
    "failed",
  );
  assert.equal(
    await sendReport("/r", report, transport([json(404, {})])),
    "failed",
  );
  assert.equal(
    await sendReport("/r", report, transport([json(500, {})]), 1),
    "failed",
  );
});

test("sounds: silent when muted or before the page may play, then a voice per cue and jingle notes later", () => {
  const started: string[] = [];
  const param = {
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    value: 0,
  };
  const node = (kind: string) => ({
    connect: (next: unknown) => next,
    start: () => void started.push(kind),
    stop() {},
    frequency: param,
    gain: param,
    type: "",
    buffer: null,
  });
  let state = "suspended",
    opened = 0;
  const audio = {
    get state() {
      return state;
    },
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    createOscillator: () => node("tone"),
    createGain: () => node("gain"),
    createBiquadFilter: () => node("filter"),
    createBufferSource: () => node("noise"),
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    resume: async () => {
      state = "running";
    },
  };
  const later: (() => void)[] = [];
  const deps: SfxDependencies = {
    open: () => {
      opened++;
      return audio as unknown as AudioContext;
    },
    later: (run) => void later.push(run),
    random: () => 0.5,
  };
  const at = { slot: 0, x: 1, y: 2 } as const;
  const cues: Cue[] = [
    { kind: "jump", ...at, grounded: true },
    { kind: "jump", ...at, grounded: false },
    { kind: "bubble", ...at },
    { kind: "trail", ...at },
    { kind: "pop", ...at },
    { kind: "harden", ...at },
    { kind: "bounce", x: 1, y: 2, speed: 2, touch: 0 },
    { kind: "goal", team: 0, x: 1, y: 2, suddenDeath: false },
    { kind: "goal", team: 1, x: 1, y: 2, suddenDeath: true },
    { kind: "zap", ...at, fromX: 0, fromY: 0 },
    { kind: "count", count: 3 },
    { kind: "go" },
    { kind: "over", winner: 0 },
  ];
  const muted = createSfx(true, deps);
  muted.resume();
  for (const cue of cues) muted.play(cue);
  assert.equal(opened, 0, "a muted page never opens audio");
  const sfx = createSfx(false, deps);
  sfx.play(cues[0]!);
  assert.equal(started.length, 0, "nothing before the page may play");
  sfx.resume();
  for (const cue of cues) sfx.play(cue);
  assert.ok(started.includes("tone") && started.includes("noise"));
  const before = started.length;
  sfx.play({ kind: "trail", ...at });
  sfx.play({ kind: "bounce", x: 1, y: 2, speed: 0.1, touch: -1 });
  assert.equal(started.length, before, "a trail and a soft tap are silent");
  for (const run of later) run();
  assert.ok(started.length > before, "the jingles' later notes play");
  assert.equal(opened, 1, "one audio context for the page");
  // A browser without audio stays quiet rather than throwing.
  const none = createSfx(false, { ...deps, open: () => undefined });
  none.resume();
  none.play({ kind: "go" });
});
