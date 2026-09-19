import test from "node:test";
import assert from "node:assert/strict";
import {
  endedScreen,
  roomScreen,
  screenClasses,
  type RoomDevice,
  type RoomScreen,
  type RoomScreenInput,
} from "../src/online/room-screen.js";

const DESKTOP: RoomDevice = {
  touch: false,
  width: 1440,
  height: 900,
  desktopPointer: true,
};
/** A laptop window under the compact desktop bar's 1000px. */
const SMALL_WINDOW: RoomDevice = {
  touch: false,
  width: 960,
  height: 700,
  desktopPointer: false,
};
const TV: RoomDevice = {
  touch: false,
  width: 1920,
  height: 1080,
  desktopPointer: true,
};
const PHONE_PORTRAIT: RoomDevice = {
  touch: true,
  width: 390,
  height: 844,
  desktopPointer: false,
};
const PHONE_LANDSCAPE: RoomDevice = {
  touch: true,
  width: 844,
  height: 390,
  desktopPointer: false,
};
/** The smokes' smallest phone. */
const SMALL_PHONE: RoomDevice = {
  touch: true,
  width: 320,
  height: 568,
  desktopPointer: false,
};

const input = (over: Partial<RoomScreenInput>): RoomScreenInput => ({
  role: "host",
  booted: true,
  joined: false,
  watching: false,
  phase: "lobby",
  recapReady: false,
  shared: false,
  device: DESKTOP,
  ...over,
});

/** The classes a screen turns on, in a stable order. */
const on = (screen: RoomScreen) =>
  Object.entries(screenClasses(screen))
    .filter(([, value]) => value)
    .map(([name]) => name)
    .sort();

interface Row {
  name: string;
  input: Partial<RoomScreenInput>;
  kind: RoomScreen["kind"];
  classes: string[];
  arenaHidden: boolean;
  lobbyCard: boolean;
  /** Defaults to false. */
  arenaController?: boolean;
}

const PLAY = { phase: "playing", joined: true } as const;
const RECAP = { phase: "matchOver", recapReady: true } as const;

// Every screen the browser smokes walk through (online, shared-room, match-recap, mobile-landscape, mobile-phase,
// home-mobile, desktop-controls), with the classes and visibility the page had for it before the derivation moved here.
const rows: Row[] = [
  // Boot: before the first frame only the boot or join card is decided.
  {
    name: "creator on a desktop, before the first frame",
    input: { booted: false },
    kind: "boot",
    classes: ["booting", "mobile-lobby"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "creator on a phone, before the first frame: already the phone lobby's shape (#134)",
    input: { booted: false, device: SMALL_PHONE },
    kind: "boot",
    classes: ["booting", "mobile-lobby", "phone-lobby"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "shared TV, before the first frame",
    input: { booted: false, role: "display", device: TV },
    kind: "boot",
    classes: ["booting", "mobile-lobby"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "solo, before the first frame",
    input: { booted: false, role: "solo" },
    kind: "boot",
    classes: ["booting", "mobile-lobby"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "invited phone, before the first frame: the join card",
    input: { booted: false, role: "joiner", device: PHONE_PORTRAIT },
    kind: "join",
    classes: ["joining", "mobile-lobby", "phone-lobby"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "reload mid-round: a joined rider's page boots again before the room re-seats it",
    input: {
      booted: false,
      role: "joiner",
      phase: "playing",
      device: PHONE_LANDSCAPE,
    },
    kind: "join",
    classes: ["joining", "mobile-lobby", "phone-lobby"],
    arenaHidden: false,
    lobbyCard: false,
  },
  // Join: an invited device without a seat, whatever the phase.
  {
    name: "invited desktop without a seat, in the lobby",
    input: { role: "joiner" },
    kind: "join",
    classes: ["joining", "mobile-lobby", "scene-background"],
    arenaHidden: true,
    lobbyCard: false,
  },
  {
    name: "invited phone without a seat, mid-round",
    input: { role: "joiner", phase: "playing", device: PHONE_PORTRAIT },
    kind: "join",
    classes: ["joining"],
    arenaHidden: true,
    lobbyCard: false,
  },
  {
    name: "invited device without a seat once the recap is ready",
    input: { role: "joiner", ...RECAP },
    kind: "join",
    classes: ["joining", "scene-background"],
    arenaHidden: true,
    lobbyCard: false,
  },
  // Lobby.
  {
    name: "creator on a desktop, lobby, before taking a seat",
    input: {},
    kind: "lobby",
    classes: ["mobile-lobby", "room-waiting", "scene-background"],
    arenaHidden: false,
    lobbyCard: true,
  },
  {
    name: "creator on a desktop, lobby, seated",
    input: { joined: true },
    kind: "lobby",
    classes: ["mobile-lobby", "room-waiting", "scene-background"],
    arenaHidden: false,
    lobbyCard: true,
  },
  {
    name: "guest seated on a desktop, lobby",
    input: { role: "joiner", joined: true },
    kind: "lobby",
    classes: ["mobile-lobby", "room-waiting", "scene-background"],
    arenaHidden: false,
    lobbyCard: true,
  },
  {
    name: "creator on a phone, lobby, before taking a seat (#134)",
    input: { device: SMALL_PHONE },
    kind: "lobby",
    classes: [
      "mobile-lobby",
      "phone-lobby",
      "room-waiting",
      "scene-background",
    ],
    arenaHidden: false,
    lobbyCard: true,
  },
  {
    name: "seated phone in landscape, lobby: the phone lobby, never the controller",
    input: { role: "joiner", joined: true, device: PHONE_LANDSCAPE },
    kind: "lobby",
    classes: [
      "mobile-lobby",
      "phone-lobby",
      "room-waiting",
      "scene-background",
    ],
    arenaHidden: false,
    lobbyCard: true,
  },
  {
    name: "shared TV, lobby",
    input: { role: "display", shared: true, device: TV },
    kind: "lobby",
    classes: ["mobile-lobby", "room-waiting", "scene-background"],
    arenaHidden: false,
    lobbyCard: true,
  },
  {
    name: "shared-TV rider on a phone, lobby: the phone lobby, and no arena behind it",
    input: {
      role: "joiner",
      joined: true,
      shared: true,
      device: PHONE_PORTRAIT,
    },
    kind: "lobby",
    classes: ["mobile-lobby", "phone-lobby", "room-waiting"],
    arenaHidden: true,
    lobbyCard: true,
    arenaController: true,
  },
  {
    name: "creator driving a TV from a phone, lobby: host actions on the phone lobby",
    input: { shared: true, device: SMALL_PHONE },
    kind: "lobby",
    classes: [
      "mobile-lobby",
      "phone-lobby",
      "room-waiting",
      "scene-background",
    ],
    arenaHidden: false,
    lobbyCard: true,
  },
  // Controller: a shared-TV rider off the phone lobby.
  {
    name: "shared-TV rider on a desktop, lobby: the controller, not the lobby card",
    input: { role: "joiner", joined: true, shared: true },
    kind: "controller",
    classes: ["controller-only", "mobile-lobby"],
    arenaHidden: true,
    lobbyCard: false,
    arenaController: true,
  },
  {
    name: "shared-TV rider on a desktop, playing",
    input: { role: "joiner", shared: true, ...PLAY },
    kind: "controller",
    classes: ["controller-only"],
    arenaHidden: true,
    lobbyCard: false,
    arenaController: true,
  },
  {
    name: "shared-TV rider on a phone in landscape, playing",
    input: {
      role: "joiner",
      shared: true,
      device: PHONE_LANDSCAPE,
      ...PLAY,
    },
    kind: "controller",
    classes: ["controller-only", "mobile-play"],
    arenaHidden: true,
    lobbyCard: false,
    arenaController: true,
  },
  {
    name: "shared-TV rider on a phone held upright, playing",
    input: {
      role: "joiner",
      shared: true,
      device: PHONE_PORTRAIT,
      ...PLAY,
    },
    kind: "controller",
    classes: ["controller-only", "mobile-play", "mobile-portrait"],
    arenaHidden: true,
    lobbyCard: false,
    arenaController: true,
  },
  {
    name: "shared-TV creator seated on the phone that made the room, countdown",
    input: {
      shared: true,
      joined: true,
      phase: "countdown",
      device: SMALL_PHONE,
    },
    kind: "controller",
    classes: ["controller-only", "mobile-play", "mobile-portrait"],
    arenaHidden: true,
    lobbyCard: false,
    arenaController: true,
  },
  // Arena.
  {
    name: "creator on a desktop, countdown",
    input: { phase: "countdown", joined: true },
    kind: "arena",
    classes: ["desktop-game", "side-standings"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "creator on a desktop, playing",
    input: PLAY,
    kind: "arena",
    classes: ["desktop-game", "side-standings"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "creator not seated on a desktop, round over: still the arena",
    input: { phase: "roundOver" },
    kind: "arena",
    classes: ["desktop-game", "side-standings"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "a window under the desktop bar's width, playing: no desktop bar",
    input: { ...PLAY, device: SMALL_WINDOW },
    kind: "arena",
    classes: [],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "final-round pause before the recap: the arena, no backdrop",
    input: { phase: "matchOver", joined: true },
    kind: "arena",
    classes: ["desktop-game", "side-standings"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "shared TV, playing",
    input: { role: "display", shared: true, phase: "playing", device: TV },
    kind: "arena",
    classes: ["desktop-game", "side-standings"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "a phone in landscape, playing: the thirds controller over its own arena (#13)",
    input: { role: "joiner", device: PHONE_LANDSCAPE, ...PLAY },
    kind: "arena",
    classes: ["mobile-play"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "a phone held upright, playing: the portrait controller",
    input: { role: "joiner", device: PHONE_PORTRAIT, ...PLAY },
    kind: "arena",
    classes: ["mobile-play", "mobile-portrait"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "a phone in landscape, final-round pause",
    input: {
      role: "joiner",
      joined: true,
      phase: "matchOver",
      device: PHONE_LANDSCAPE,
    },
    kind: "arena",
    classes: ["mobile-play"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "creator on a phone without a seat, playing: watches the arena, no controller",
    input: { phase: "playing", device: PHONE_LANDSCAPE },
    kind: "arena",
    classes: [],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "solo on a desktop, lobby: the arena behind, no lobby card",
    input: { role: "solo", joined: true },
    kind: "arena",
    classes: ["desktop-game", "mobile-lobby", "scene-background"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "solo on a desktop, playing",
    input: { role: "solo", ...PLAY },
    kind: "arena",
    classes: ["desktop-game", "side-standings"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "solo on a phone in landscape, playing",
    input: { role: "solo", device: PHONE_LANDSCAPE, ...PLAY },
    kind: "arena",
    classes: ["mobile-play"],
    arenaHidden: false,
    lobbyCard: false,
  },
  // Recap: the report is ready, over whatever the device shows at the end of a match.
  {
    name: "creator on a desktop, recap: the lobby card over the blurred arena",
    input: { joined: true, ...RECAP },
    kind: "recap",
    classes: ["room-waiting", "scene-background"],
    arenaHidden: false,
    lobbyCard: true,
  },
  {
    name: "shared TV, recap",
    input: { role: "display", shared: true, device: TV, ...RECAP },
    kind: "recap",
    classes: ["room-waiting", "scene-background"],
    arenaHidden: false,
    lobbyCard: true,
  },
  {
    name: "unseated creator's phone, recap: back on the phone lobby",
    input: { device: SMALL_PHONE, ...RECAP },
    kind: "recap",
    classes: ["phone-lobby", "room-waiting", "scene-background"],
    arenaHidden: false,
    lobbyCard: true,
  },
  {
    name: "seated phone, recap: stays the controller",
    input: {
      role: "joiner",
      joined: true,
      device: PHONE_LANDSCAPE,
      ...RECAP,
    },
    kind: "recap",
    classes: ["mobile-play", "scene-background"],
    arenaHidden: false,
    lobbyCard: false,
  },
  {
    name: "shared-TV rider on a desktop, recap: the controller",
    input: { role: "joiner", joined: true, shared: true, ...RECAP },
    kind: "recap",
    classes: ["controller-only"],
    arenaHidden: true,
    lobbyCard: false,
    arenaController: true,
  },
  {
    name: "solo on a desktop, recap: the arena behind the results",
    input: { role: "solo", joined: true, ...RECAP },
    kind: "recap",
    classes: ["desktop-game", "scene-background"],
    arenaHidden: false,
    lobbyCard: false,
  },
];

for (const row of rows)
  test(`room screen: ${row.name}`, () => {
    const screen = roomScreen(input(row.input));
    assert.equal(screen.kind, row.kind, "kind");
    assert.deepEqual(on(screen), [...row.classes].sort(), "classes");
    assert.equal(screen.arenaHidden, row.arenaHidden, "arena hidden");
    assert.equal(screen.lobbyCard, row.lobbyCard, "lobby card");
    assert.equal(
      screen.arenaController,
      row.arenaController ?? false,
      "arena controller",
    );
  });

test("the desktop bar and the side standings never show over a lobby card, a join card or a controller", () => {
  for (const row of rows) {
    const screen = roomScreen(input(row.input));
    if (screen.lobbyCard || screen.joining || screen.controllerOnly) {
      assert.equal(screen.desktop, false, row.name);
      assert.equal(screen.sideStandings, false, row.name);
    }
    if (screen.sideStandings) assert.equal(screen.desktop, true, row.name);
  }
});

test("screenClasses names every class the page sets, on or off", () => {
  assert.deepEqual(Object.keys(screenClasses(roomScreen(input({})))).sort(), [
    "booting",
    "controller-only",
    "desktop-game",
    "joining",
    "mobile-lobby",
    "mobile-play",
    "mobile-portrait",
    "phone-lobby",
    "room-over",
    "room-waiting",
    "scene-background",
    "side-standings",
  ]);
});

/** A sequence of frames through one device's life, as the smokes drive it. */
const walk = (device: RoomDevice, steps: Partial<RoomScreenInput>[]) =>
  steps.map((step) => roomScreen(input({ device, ...step })).kind);

test("a creator's desktop: boot, lobby, a match, the recap, a rematch and back to the lobby", () => {
  assert.deepEqual(
    walk(DESKTOP, [
      { booted: false },
      {},
      { joined: true },
      { joined: true, phase: "countdown" },
      { joined: true, phase: "playing" },
      { joined: true, phase: "roundOver" },
      { joined: true, phase: "matchOver" },
      { joined: true, ...RECAP },
      // REMATCH: the next match's countdown.
      { joined: true, phase: "countdown" },
      { joined: true, phase: "playing" },
      // BACK TO LOBBY.
      { joined: true },
    ]),
    [
      "boot",
      "lobby",
      "lobby",
      "arena",
      "arena",
      "arena",
      "arena",
      "recap",
      "arena",
      "arena",
      "lobby",
    ],
  );
});

test("an invited phone in a shared-TV room: join card, phone lobby, controller, recap", () => {
  assert.deepEqual(
    walk(PHONE_PORTRAIT, [
      { role: "joiner", booted: false, shared: true },
      { role: "joiner", shared: true },
      { role: "joiner", shared: true, joined: true },
      { role: "joiner", shared: true, joined: true, phase: "countdown" },
      { role: "joiner", shared: true, ...PLAY },
      { role: "joiner", shared: true, joined: true, ...RECAP },
      { role: "joiner", shared: true, joined: true },
    ]),
    ["join", "join", "lobby", "controller", "controller", "recap", "lobby"],
  );
});

test("rotating a phone mid-round keeps it the controller and only flips the portrait layout", () => {
  const landscape = roomScreen(
    input({ role: "joiner", device: PHONE_LANDSCAPE, ...PLAY }),
  );
  const portrait = roomScreen(
    input({ role: "joiner", device: PHONE_PORTRAIT, ...PLAY }),
  );
  assert.equal(landscape.kind, portrait.kind);
  assert.equal(landscape.mobile.active && portrait.mobile.active, true);
  assert.deepEqual(
    [landscape.mobile.portrait, portrait.mobile.portrait],
    [false, true],
  );
});

test("a reloaded rider boots again, then lands back on its screen once the room re-seats it", () => {
  const device = PHONE_LANDSCAPE;
  assert.deepEqual(
    walk(device, [
      { role: "joiner", ...PLAY },
      { role: "joiner", booted: false, phase: "playing" },
      { role: "joiner", phase: "playing" },
      { role: "joiner", ...PLAY },
    ]),
    ["arena", "join", "join", "arena"],
  );
});

test("a room that closes is frozen as it was, minus the boot card, the controller and the phone layout (#44)", () => {
  const controller = roomScreen(
    input({ role: "joiner", shared: true, device: PHONE_LANDSCAPE, ...PLAY }),
  );
  const ended = endedScreen(controller);
  assert.equal(ended.kind, "ended");
  assert.equal(ended.kind === "ended" && ended.closedOn, "controller");
  assert.deepEqual(on(ended), ["room-over"]);
  assert.equal(ended.arenaHidden, controller.arenaHidden);
  assert.equal(ended.lobbyCard, controller.lobbyCard);

  const lobby = roomScreen(input({ device: SMALL_PHONE }));
  assert.deepEqual(on(endedScreen(lobby)), [
    "mobile-lobby",
    "room-over",
    "room-waiting",
    "scene-background",
  ]);

  // A room that never delivered a frame: the boot card goes, the arena stays as it was (the ROOM CLOSED card covers it).
  const boot = roomScreen(input({ booted: false }));
  const closedBooting = endedScreen(boot);
  assert.deepEqual(on(closedBooting), ["mobile-lobby", "room-over"]);
  assert.equal(
    closedBooting.kind === "ended" && closedBooting.closedOn,
    "boot",
  );

  // An invited device that never took a seat keeps its join card's shape.
  const join = roomScreen(input({ role: "joiner", booted: false }));
  assert.deepEqual(on(endedScreen(join)), [
    "joining",
    "mobile-lobby",
    "room-over",
  ]);
});

test("after the room closed a resize only moves the desktop bar, and the standings column stays down", () => {
  const playing = roomScreen(input(PLAY));
  assert.deepEqual(on(playing), ["desktop-game", "side-standings"]);
  const ended = endedScreen(playing);
  // At the moment it closes, nothing is recomputed.
  assert.deepEqual(on(ended), ["desktop-game", "room-over", "side-standings"]);
  assert.deepEqual(on(endedScreen(ended, SMALL_WINDOW)), ["room-over"]);
  assert.deepEqual(on(endedScreen(ended, DESKTOP)), [
    "desktop-game",
    "room-over",
  ]);
  // Ending twice keeps what it closed on.
  const again = endedScreen(ended, DESKTOP);
  assert.equal(again.kind === "ended" && again.closedOn, "arena");
  // A closed lobby card keeps the desktop bar off.
  assert.equal(
    endedScreen(endedScreen(roomScreen(input({}))), DESKTOP).desktop,
    false,
  );
});

test("a watcher is in the room, so an invited page that watches stops being a join card", () => {
  const joiner = input({ role: "joiner", joined: false });
  assert.equal(roomScreen(joiner).kind, "join");
  const watcher = roomScreen({ ...joiner, watching: true });
  assert.equal(
    watcher.kind,
    "lobby",
    "it gets the lobby card like anyone in the room",
  );
  assert.equal(watcher.joining, false);
  assert.deepEqual(
    roomScreen({ ...joiner, watching: true, phase: "playing" }).kind,
    "arena",
    "and the arena once the race starts",
  );
  const phone = roomScreen({
    ...joiner,
    watching: true,
    phase: "playing",
    device: PHONE_LANDSCAPE,
  });
  assert.equal(
    phone.mobile.active,
    false,
    "a watching phone is never the thirds controller: it holds no seat",
  );
  assert.equal(phone.arenaHidden, false, "it watches the arena instead");
  const sharedWatcher = roomScreen({
    ...joiner,
    watching: true,
    shared: true,
    phase: "playing",
  });
  assert.equal(
    sharedWatcher.controllerOnly,
    false,
    "and in a shared-TV room it watches rather than becoming a controller",
  );
});
