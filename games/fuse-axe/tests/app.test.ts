import test from "node:test";
import assert from "node:assert/strict";
import type { SeatRecord, Stage } from "fuse-netcode";
import {
  HeldControls,
  KEY_HELP,
  KEYS,
  type KeyPress,
} from "../src/app/controls.js";
import {
  HEROES,
  STAGE_NAMES,
  TEXT,
  partyLabel,
  pixelScale,
  present,
  type Viewer,
} from "../src/app/presenter.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "../src/app/session.js";
import {
  ATTACK,
  DOWN,
  JUMP,
  LEFT,
  MAGIC,
  RIGHT,
  UP,
  createWorld,
} from "../src/engine/index.js";
import {
  CLEAR_TICKS,
  CONTINUE_TICKS,
  DEFAULT_SETTINGS,
  LAST_STAGE,
  createRoom,
  view,
  type Room,
  type View,
} from "../src/online/game.js";
import { SEAT_COLORS } from "../src/render/seat-colors.js";

const host: Viewer = {
  me: "a",
  host: true,
  solo: false,
  display: false,
  touch: false,
};
const guest: Viewer = { ...host, me: "b", host: false };
const tv: Viewer = { ...host, me: "tv", host: false, display: true };

const seat = (
  id: string,
  slot: number,
  avatarId: string,
  extra: Partial<SeatRecord> = {},
): [string, SeatRecord] => [
  id,
  {
    id,
    name: id.toUpperCase(),
    slot,
    avatarId,
    connected: true,
    bot: false,
    generation: 1,
    ...extra,
  },
];

/** Ada (P1, Rhea) and Bo (P2, Gorm) seated, Wes watching; in a run only Ada's and Bo's heroes are in the world. */
function frame(stage: Stage, extra: Partial<Room> = {}): View {
  const seats = new Map([
    seat("a", 0, "rhea"),
    seat("b", 1, "gorm"),
    seat("w", -1, "", { watcher: true }),
  ]);
  return view({
    ...createRoom("m1", DEFAULT_SETTINGS),
    stage,
    round: stage === "lobby" ? 0 : 1,
    seats,
    world:
      stage === "lobby"
        ? null
        : createWorld({
            seed: 1,
            heroes: [
              { seat: 0, kind: "rhea" },
              { seat: 1, kind: "gorm" },
            ],
          }),
    ...extra,
  });
}

test("the lobby: each seat's hero from the room, the host starts, a guest waits, a stranger names itself", () => {
  const lobby = frame("lobby");
  const mine = present(lobby, host);
  assert.equal(mine.screen, "lobby");
  assert.deepEqual(
    mine.members.map((m) => [m.name, m.tag, m.hero, m.status]),
    [
      ["A (you)", "P1", "rhea", "P1 · RHEA"],
      ["B", "P2", "gorm", "P2 · GORM"],
    ],
  );
  assert.equal(mine.watchers, 1);
  assert.equal(mine.hero, "rhea");
  assert.ok(mine.seated && mine.canPick && !mine.playing);
  assert.ok(mine.showStart && mine.canStart && !mine.canReturn);
  assert.equal(mine.note, "Pick your hero, then START");
  const theirs = present(lobby, guest);
  assert.equal(theirs.hero, "gorm");
  assert.equal(theirs.showStart, false);
  assert.equal(theirs.note, "Pick your hero; the host starts the run");
  const stranger = present(lobby, { ...guest, me: "zed" });
  assert.ok(stranger.askName && !stranger.seated && !stranger.canPick);
  assert.equal(stranger.hero, null);
  const watcher = present(lobby, { ...guest, me: "w" });
  assert.ok(!watcher.askName && !watcher.canPick && watcher.hero === null);
  const screen = present(lobby, tv);
  assert.ok(!screen.askName && !screen.canPick && !screen.showStart);
  assert.match(screen.note, /watches/);
  assert.equal(
    present(view(createRoom("m1", DEFAULT_SETTINGS)), host).note,
    "Pick a name to take a seat",
  );
  assert.equal(
    present(lobby, { ...host, solo: true, me: "zed" }).askName,
    false,
    "solo seats its player itself",
  );
});

test("the host seats bot companions from the lobby while a seat is free, and removes them there", () => {
  const bot = seat("bot:1", 2, "bot", { bot: true, generation: undefined });
  const lobby = frame("lobby", {
    seats: new Map([seat("a", 0, "rhea"), seat("b", 1, "gorm"), bot]),
  });
  const mine = present(lobby, host);
  assert.ok(mine.canAddBot);
  assert.deepEqual(mine.removable, ["bot:1"]);
  assert.equal(mine.members[2]!.status, "P3 · BOT · GORM");
  assert.ok(!present(lobby, guest).canAddBot);
  assert.deepEqual(present(lobby, guest).removable, []);
  assert.ok(!present(lobby, tv).canAddBot, "not from the shared screen");
  assert.ok(present(lobby, { ...host, solo: true }).canAddBot, "solo too");
  const full = frame("lobby", {
    seats: new Map(
      [0, 1, 2, 3, 4].map((slot) => seat(`p${slot}`, slot, "gorm")),
    ),
  });
  assert.ok(!present(full, host).canAddBot, "every seat taken");
  const running = present(frame("running"), host);
  assert.ok(!running.canAddBot);
  assert.deepEqual(running.removable, []);
});

test("a seat's hero changes only when the room's does; an away or offline seat cannot pick", () => {
  const picked = frame("lobby", {
    seats: new Map([seat("a", 0, "gorm"), seat("b", 1, "gorm")]),
  });
  assert.equal(present(picked, host).hero, "gorm", "duplicates are allowed");
  assert.equal(present(picked, guest).hero, "gorm");
  const away = frame("lobby", {
    seats: new Map([
      seat("a", 0, "rhea", { away: true, connected: false }),
      seat("b", 1, "gorm", { connected: false }),
    ]),
  });
  assert.equal(present(away, host).canPick, false);
  assert.equal(present(away, guest).canPick, false);
  assert.deepEqual(
    present(away, host).members.map((m) => m.status),
    ["AWAY", "OFFLINE"],
  );
});

test("in a run: the game for every page, keys for a hero in the world, notes for the rest", () => {
  const running = frame("running");
  const mine = present(running, host);
  assert.equal(mine.screen, "play");
  assert.ok(mine.playing && !mine.canPick && mine.canReturn);
  assert.equal(mine.note, "");
  assert.equal(present(running, guest).canReturn, false);
  assert.equal(present(running, tv).screen, "play");
  assert.equal(present(running, tv).playing, false);
  assert.equal(present(running, tv).note, "");
  const late = frame("running", {
    seats: new Map([seat("a", 0, "rhea"), seat("c", 2, "brakka")]),
  });
  assert.equal(present(late, { ...guest, me: "c" }).playing, false);
  assert.equal(
    present(late, { ...guest, me: "c" }).note,
    "You join the next run",
  );
  assert.equal(present(running, { ...guest, me: "w" }).note, "Watching");
  assert.equal(
    present(running, { ...guest, me: "zed" }).note,
    "Pick a name to play from the next run",
  );
  const over = present(frame("over"), host);
  assert.ok(over.canPick && !over.playing);
  assert.equal(over.note, "The run is over");
});

test("the stage flow's cards: a stage's tally, the countdown and its key, then victory or game over with REMATCH for the host", () => {
  const world = createWorld({
    seed: 1,
    heroes: [
      { seat: 0, kind: "rhea" },
      { seat: 1, kind: "gorm" },
    ],
  });
  const fought = {
    ...world,
    heroes: world.heroes.map((hero, index) => ({
      ...hero,
      damage: 12 + index,
      knockdowns: index + 1,
    })),
  };
  const tally = [
    { seat: 0, kind: "rhea" as const, damage: 40, knockdowns: 3 },
    { seat: 1, kind: "gorm" as const, damage: 50, knockdowns: 4 },
  ];
  assert.equal(present(frame("lobby"), host).card, null);
  assert.equal(present(frame("running"), host).card, null, "a fight");
  // A cleared stage: its own numbers, and the clock in whole seconds.
  const clear = present(
    frame("between", { world: fought, until: 120, tally }),
    host,
  ).card!;
  assert.deepEqual(
    [clear.kind, clear.title, clear.line, clear.seconds, clear.hint],
    ["clear", "STAGE 1 CLEAR", "ASHEN VILLAGE", 6, TEXT.onward],
  );
  assert.deepEqual(
    clear.rows.map((row) => [row.tag, row.name, row.hero, row.damage]),
    [
      ["P1", "A", "rhea", 12],
      ["P2", "B", "gorm", 13],
    ],
  );
  assert.deepEqual(clear.rows[0]!.color, SEAT_COLORS[0]);
  assert.ok(!clear.canContinue && !clear.canRematch);
  // The last stage cleared: the run is won once its tally has shown.
  const last = present(
    frame("between", { world: fought, round: 4, until: 1, tally }),
    host,
  ).card!;
  assert.deepEqual(
    [last.title, last.line, last.hint, last.seconds],
    ["STAGE 4 CLEAR", "VORHAL'S KEEP", TEXT.won, 1],
  );
  // Every hero out: a hero of the run presses Attack, everyone else waits on them.
  const out = frame("running", { until: 199, tally });
  const vote = present(out, host).card!;
  assert.deepEqual(
    [vote.kind, vote.title, vote.seconds, vote.hint, vote.canContinue],
    ["continue", "CONTINUE?", 10, "Press ATTACK (J / Z) to fight on", true],
  );
  assert.equal(present(out, host).playing, true, "J reaches the controls");
  assert.ok(present(out, guest).card!.canContinue);
  for (const [who, viewer] of [
    ["a watcher", { ...guest, me: "w" }],
    ["the shared screen", tv],
    ["a stranger", { ...guest, me: "zed" }],
  ] as const) {
    const waits = present(out, viewer).card!;
    assert.deepEqual(
      [waits.canContinue, waits.hint],
      [false, TEXT.waitHeroes],
      who,
    );
  }
  const away = frame("running", {
    until: 100,
    tally,
    seats: new Map([
      seat("a", 0, "rhea", { away: true, connected: false }),
      seat("b", 1, "gorm"),
    ]),
  });
  assert.equal(present(away, host).card!.canContinue, false, "stepped away");
  // The run's end: the run's numbers, Vorhal fallen and the Ember Axe whole (or the stage reached), and REMATCH or the
  // lobby for the host alone.
  const won = present(
    frame("over", { world: fought, round: 4, outcome: "victory", tally }),
    host,
  ).card!;
  assert.deepEqual(
    [won.kind, won.title, won.line, won.seconds, won.hint, won.canRematch],
    ["victory", "VICTORY", TEXT.restored, null, TEXT.hostChoice, true],
  );
  assert.match(won.line, /Vorhal has fallen\. The Ember Axe is whole again/);
  assert.deepEqual(
    won.rows.map((row) => [row.damage, row.knockdowns]),
    [
      [40, 3],
      [50, 4],
    ],
  );
  const lost = frame("over", {
    outcome: "defeat",
    tally,
    seats: new Map([seat("b", 1, "gorm")]),
  });
  const theirs = present(lost, guest).card!;
  assert.deepEqual(
    [theirs.kind, theirs.title, theirs.hint, theirs.canRematch],
    ["defeat", "GAME OVER", TEXT.waitHost, false],
  );
  assert.equal(
    present(frame("over", { round: 4, outcome: "defeat", tally }), guest).card!
      .line,
    "STAGE 4 OF 4 · VORHAL'S KEEP",
  );
  assert.equal(theirs.rows[0]!.name, "P1", "a seat that left shows its tag");
  assert.equal(present(lost, tv).card!.canRematch, false);
  assert.equal(present(frame("lobby"), host).card, null);
});

test("a shared screen: the host switches it on in the lobby, the TV shows the game and its QR code, each seat's page is a controller", () => {
  const shared = { ...DEFAULT_SETTINGS, display: true };
  // The lobby: the host's switch and TV link, and what the TV and the phones are told.
  const lobby = present(frame("lobby"), host);
  assert.deepEqual(
    [lobby.shared, lobby.canShare, lobby.showTv, lobby.note],
    [false, true, false, "Pick your hero, then START"],
  );
  const lobbyShared = frame("lobby", { settings: shared });
  const hostShared = present(lobbyShared, host);
  assert.deepEqual(
    [hostShared.shared, hostShared.canShare, hostShared.showTv],
    [true, true, true],
  );
  assert.equal(
    hostShared.note,
    "Open the TV screen, pick your hero, then START",
  );
  for (const [who, viewer] of [
    ["a guest", guest],
    ["the TV", tv],
    ["solo", { ...host, solo: true }],
  ] as const) {
    const theirs = present(lobbyShared, viewer);
    assert.ok(!theirs.canShare && !theirs.showTv, who);
  }
  assert.equal(
    present(lobbyShared, guest).screen,
    "lobby",
    "a phone picks its hero in the lobby",
  );
  assert.ok(present(lobbyShared, guest).canPick);
  assert.equal(
    present(lobbyShared, tv).note,
    "Join on your phone; the host starts the run",
  );
  assert.equal(
    present(view(createRoom("m1", shared)), tv).note,
    "Scan the code to join on your phone",
  );
  assert.ok(!present(lobbyShared, tv).invite, "the lobby has its own invite");
  // In a run: the TV draws the game with the QR code; every seat, the host's too, is a controller with no canvas.
  const running = frame("running", { settings: shared });
  const screen = present(running, tv);
  assert.deepEqual(
    [screen.screen, screen.invite, screen.pads, screen.controller],
    ["play", true, false, null],
  );
  assert.deepEqual(screen.hud.you, null, "the TV plays no seat");
  const mine = present(running, host);
  assert.deepEqual(
    [mine.screen, mine.pads, mine.playing, mine.canShare, mine.invite],
    ["controller", true, true, false, false],
  );
  assert.deepEqual(mine.controller, {
    title: "P1 · A",
    color: SEAT_COLORS[0],
    hero: "rhea",
  });
  assert.deepEqual(
    [mine.canReturn, present(running, guest).canReturn, screen.canReturn],
    [true, false, false],
    "the host can still call the room back to the lobby from its controller; no one else, nor the TV, can",
  );
  assert.deepEqual(present(running, guest).controller, {
    title: "P2 · B",
    color: SEAT_COLORS[1],
    hero: "gorm",
  });
  assert.equal(mine.phone, false, "a laptop's controller keeps its header");
  assert.equal(present(running, { ...host, touch: true }).phone, true);
  // A controller stays one between stages and at the run's end, where the card shows on it.
  const tally = [{ seat: 0, kind: "rhea" as const, damage: 1, knockdowns: 0 }];
  for (const stage of ["between", "over"] as const) {
    const later = present(
      frame(stage, { settings: shared, until: 10, tally }),
      guest,
    );
    assert.deepEqual([later.screen, later.pads], ["controller", true], stage);
    assert.ok(later.card, stage);
  }
  // A seat that joins mid-run holds a controller too; a watcher and a stranger see the game.
  const late = frame("running", {
    settings: shared,
    seats: new Map([seat("a", 0, "rhea"), seat("c", 2, "brakka")]),
  });
  const joining = present(late, { ...guest, me: "c" });
  assert.deepEqual(
    [joining.screen, joining.playing, joining.note],
    ["controller", false, "You join the next run"],
  );
  assert.equal(present(running, { ...guest, me: "w" }).screen, "play");
  assert.equal(present(running, { ...guest, me: "zed" }).screen, "play");
});

test("touch screens: the pads over the game while this device's hero fights, and the continue hint names the button", () => {
  const phone = { ...host, touch: true };
  const running = present(frame("running"), phone);
  assert.deepEqual(
    [running.screen, running.pads, running.phone, running.controller],
    ["play", true, true, null],
  );
  assert.deepEqual(
    [
      present(frame("running"), host).pads,
      present(frame("running"), host).phone,
    ],
    [false, false],
    "a keyboard needs no pads",
  );
  for (const [who, model] of [
    ["the lobby", present(frame("lobby"), phone)],
    ["between stages", present(frame("between", { until: 10 }), phone)],
    ["the run's end", present(frame("over"), phone)],
    ["a watcher", present(frame("running"), { ...phone, me: "w" })],
    ["the TV", present(frame("running"), { ...tv, touch: true })],
  ] as const)
    assert.deepEqual([model.pads, model.phone], [false, false], who);
  const tally = [{ seat: 0, kind: "rhea" as const, damage: 1, knockdowns: 0 }];
  const out = frame("running", { until: 100, tally });
  assert.equal(present(out, phone).card!.hint, TEXT.tapAttack);
  assert.equal(present(out, host).card!.hint, TEXT.pressAttack);
  assert.equal(
    present(out, { ...tv, touch: true }).card!.hint,
    TEXT.waitHeroes,
  );
});

test("the cards follow the game: the clocks in the game's log ticks, a name for every stage, the real key in the hint", () => {
  // The room's clocks are log ticks; the cards show whole seconds of them (the README's six and ten).
  const tally = [{ seat: 0, kind: "rhea" as const, damage: 1, knockdowns: 0 }];
  assert.equal(
    present(frame("between", { until: CLEAR_TICKS, tally }), host).card!
      .seconds,
    6,
  );
  assert.equal(
    present(frame("running", { until: CONTINUE_TICKS, tally }), host).card!
      .seconds,
    10,
  );
  // A stage the game has gets its name on the card (`LAST_STAGE` grows with the game).
  for (let round = 1; round <= LAST_STAGE; round++)
    assert.ok(STAGE_NAMES[round], `stage ${round} is named`);
  // The hint names the keys that attack, as the lobby lists them and the controls bind them.
  const [attackKeys] = KEY_HELP.find(([, does]) => does === "Attack")!;
  assert.ok(TEXT.pressAttack.includes(attackKeys), attackKeys);
  for (const letter of attackKeys.split(" / "))
    assert.equal(KEYS[`Key${letter}`], ATTACK, `${letter} attacks`);
});

test("the HUD names each seat's player by slot, watchers left out, and knows this device's seat", () => {
  const running = frame("running");
  const names = ["A", "B", null, null, null];
  assert.deepEqual(present(running, host).hud, { names, you: 0, open: true });
  assert.deepEqual(present(running, guest).hud, { names, you: 1, open: true });
  assert.deepEqual(present(running, tv).hud, { names, you: null, open: true });
  assert.equal(present(running, { ...guest, me: "w" }).hud.you, null);
  // Nobody joins a solo game: its empty seats do not call for a player.
  assert.equal(present(running, { ...host, solo: true }).hud.open, false);
});

test("the canvas is labelled with the party the HUD draws in pixels: tag, player in full, hero", () => {
  const { members } = present(frame("running"), guest);
  assert.equal(partyLabel(members), "Fuse Axe: P1 A, RHEA; P2 B (you), GORM");
  assert.equal(
    partyLabel([{ ...members[0]!, name: "Дмитрий 🔥", hero: null }]),
    "Fuse Axe: P1 Дмитрий 🔥",
    "a name the pixel font cannot write is whole here",
  );
  assert.equal(partyLabel([]), "Fuse Axe: nobody is seated");
});

test("the screen scales by the largest whole number that fits, never below 1", () => {
  assert.equal(pixelScale(1920, 1080), 6);
  assert.equal(pixelScale(1280, 720), 4);
  assert.equal(pixelScale(1279, 900), 3);
  assert.equal(pixelScale(2000, 539), 2);
  assert.equal(pixelScale(100, 50), 1);
});

test("keys: ours are cancelled, shortcuts and typing are left alone, Cmd lets go, and a closed room takes nothing more", () => {
  const key = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  });
  const seen: number[] = [];
  const controls = new HeldControls((bits) => seen.push(bits));
  assert.equal(controls.down(key("ArrowRight"), false), true);
  assert.equal(controls.down(key("ArrowRight"), false), true, "key repeat");
  assert.deepEqual(seen, [RIGHT], "a repeat logs nothing");
  assert.equal(controls.down(key("KeyQ"), false), false, "not ours");
  assert.equal(controls.down(key("KeyJ"), true), false, "typed into a field");
  assert.equal(controls.down(key("KeyK", { ctrlKey: true }), false), false);
  assert.equal(controls.down(key("KeyK", { altKey: true }), false), false);
  assert.equal(controls.bits, RIGHT, "a shortcut holds nothing");
  assert.equal(controls.up("ArrowRight"), true, "its keyup is ours to cancel");
  assert.equal(controls.up("ArrowRight"), false, "once");
  assert.equal(controls.up("KeyJ"), false, "a key pressed in a field is not");
  assert.deepEqual(seen, [RIGHT, 0]);
  controls.down(key("ArrowLeft"), false);
  controls.down(key("KeyD"), false);
  assert.equal(
    controls.bits,
    LEFT | RIGHT,
    "opposite directions are held as both",
  );
  controls.down(key("KeyJ"), false);
  assert.equal(
    controls.down(key("MetaLeft", { metaKey: true }), false),
    false,
    "Cmd is not ours",
  );
  assert.equal(
    controls.bits,
    0,
    "the browser sends no keyup under Cmd, so Cmd lets go",
  );
  assert.equal(controls.up("KeyJ"), false, "nothing left to cancel");
  controls.down(key("KeyD"), false);
  controls.hold("pad", ATTACK);
  const before = seen.length;
  controls.close();
  assert.equal(controls.bits, 0);
  assert.equal(seen.at(-1), 0, "closing lets go");
  assert.equal(controls.down(key("KeyD"), false), false);
  assert.equal(controls.press("KeyD"), false);
  controls.hold("pad", ATTACK);
  assert.equal(controls.bits, 0);
  assert.equal(seen.length, before + 1, "and nothing is logged after it");
});

test("a seat has one colour on the page, from the list its hero's marker uses in the game", () => {
  const colors = present(frame("lobby"), host).members.map((m) => m.color);
  assert.deepEqual(colors, SEAT_COLORS.slice(0, 2));
});

test("held controls: arrows or WASD walk, J/Z attack, K/X jump, L/C magic, one change at a time", () => {
  const seen: number[] = [];
  const controls = new HeldControls((bits) => seen.push(bits));
  assert.equal(controls.press("ArrowRight"), true);
  assert.equal(controls.press("KeyD"), true);
  assert.equal(controls.press("KeyQ"), false, "not ours");
  assert.deepEqual(seen, [RIGHT], "a second right key changes nothing");
  controls.press("KeyW");
  controls.press("KeyJ");
  assert.equal(controls.bits, RIGHT | UP | ATTACK);
  controls.release("ArrowRight");
  assert.equal(controls.bits, RIGHT | UP | ATTACK, "D still holds right");
  controls.release("KeyD");
  controls.release("KeyW");
  controls.release("KeyJ");
  assert.equal(controls.release("KeyQ"), false);
  assert.equal(controls.bits, 0);
  controls.hold("pad", LEFT | DOWN);
  controls.press("KeyX");
  controls.press("KeyC");
  assert.equal(controls.bits, LEFT | DOWN | JUMP | MAGIC);
  controls.hold("pad", 0);
  assert.equal(controls.bits, JUMP | MAGIC);
  controls.clear();
  assert.equal(controls.bits, 0);
  assert.equal(seen.at(-1), 0);
  assert.deepEqual(
    [KEYS.KeyZ, KEYS.KeyK, KEYS.KeyL, KEYS.KeyA, KEYS.ArrowDown],
    [ATTACK, JUMP, MAGIC, LEFT, DOWN],
  );
  assert.deepEqual(
    KEY_HELP.map(([key]) => key),
    ["ARROWS / WASD", "J / Z", "K / X", "L / C"],
  );
  assert.deepEqual(
    Object.values(HEROES).map((hero) => hero.name),
    ["BRAKKA", "RHEA", "GORM"],
  );
});

test("sessions: solo, landing, a joiner's kept token, the creator's token and a fresh one for a watching screen", () => {
  const memory = new Map<string, string>();
  const store = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
  const valid = (code: string) => /^[A-Z0-9]{4}$/.test(code);
  let n = 0;
  const secret = () => `s${++n}`;
  assert.deepEqual(sessionFor("?solo=1", store, "fa", valid, secret), {
    kind: "solo",
  });
  assert.deepEqual(sessionFor("", store, "fa", valid, secret), {
    kind: "landing",
  });
  assert.deepEqual(sessionFor("?room=bad!", store, "fa", valid, secret), {
    kind: "invalid",
    code: "BAD!",
  });
  const joiner = sessionFor("?room=abcd", store, "fa", valid, secret);
  assert.deepEqual(joiner, {
    kind: "room",
    code: "ABCD",
    role: "joiner",
    token: "s1",
  });
  assert.deepEqual(
    sessionFor("?room=ABCD", store, "fa", valid, secret),
    joiner,
    "a refresh is the same member",
  );
  store.setItem(keys("fa").host("ABCD"), "creator");
  assert.deepEqual(sessionFor("?room=ABCD", store, "fa", valid, secret), {
    kind: "room",
    code: "ABCD",
    role: "host",
    token: "creator",
  });
  assert.deepEqual(
    sessionFor("?room=ABCD&display=1", store, "fa", valid, secret),
    { kind: "room", code: "ABCD", role: "display", token: "s2" },
  );
  assert.equal(keys("fuse-axe").hero, "fuse-axe-hero");
  const broken = safeStore(() => {
    throw new Error("blocked");
  });
  broken.setItem("x", "1");
  assert.equal(broken.getItem("x"), "1");
  broken.removeItem("x");
  assert.equal(broken.getItem("x"), null);
  const refuse = (): never => {
    throw new Error("quota");
  };
  const refusing: Storage = {
    length: 0,
    clear: refuse,
    key: () => null,
    getItem: (key: string) => (key === "probe" ? null : refuse()),
    setItem: refuse,
    removeItem: refuse,
  };
  const flaky = safeStore(() => refusing);
  flaky.setItem("y", "2");
  assert.equal(flaky.getItem("y"), "2", "a refusing storage falls back");
  flaky.removeItem("y");
  assert.equal(flaky.getItem("y"), null);
  assert.equal(roomFailure("unknown game fuse-axe"), NOT_OPEN);
  assert.match(roomFailure("room is for another game"), /another game/);
  assert.equal(roomFailure("full"), "full");
});

test("camp is played: the hero's keys and pads are its own, and a small CAMP caption counts down to the road", () => {
  const camp = createWorld({
    seed: 1,
    camp: true,
    heroes: [
      { seat: 0, kind: "rhea" },
      { seat: 1, kind: "gorm" },
    ],
  });
  const shown = frame("between", { world: { ...camp, step: 300 } });
  const mine = present(shown, { ...host, touch: true });
  assert.ok(mine.playing && mine.pads, "a phone steers its hero at camp");
  assert.deepEqual(
    [mine.card!.kind, mine.card!.title, mine.card!.line, mine.card!.hint],
    ["camp", TEXT.camp, TEXT.campLine, TEXT.onward],
  );
  assert.deepEqual([mine.card!.seconds, mine.card!.rows], [15, []]);
  assert.ok(!mine.card!.canContinue && !mine.card!.canRematch);
  assert.equal(present(shown, tv).playing, false, "the TV plays no hero");
  // Over the tally before it the keys are nobody's.
  const tally = frame("between", { until: CLEAR_TICKS });
  assert.equal(present(tally, host).playing, false);
});
