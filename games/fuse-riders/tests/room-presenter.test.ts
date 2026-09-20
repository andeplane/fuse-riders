import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  createGame,
  SLOT_COLORS,
  startMatch,
  toView,
  MATCH_WINNER_TICKS,
} from "../src/engine/game.js";
import { snapshotMatchStats } from "../src/engine/match-stats.js";
import type { RiderView, WorldView } from "../src/engine/view.js";
import {
  MAX_RIDERS,
  presentRoom,
  presentStatus,
  recapReady,
  type RoomPresenterInput,
} from "../src/online/room-presenter.js";
import { classicSettings } from "./fixtures/classic-settings.js";

/** A room of `me` (the creator), `ada` and one AI rider, mid-match unless overridden. */
const frame = (
  over: Partial<WorldView> = {},
  riders: Record<string, Partial<RiderView>> = {},
): WorldView => {
  const game = createGame("presenter", classicSettings());
  for (const [slot, id, name] of [
    [0, "me", "Anders"],
    [1, "ada", "Ada"],
    [2, "bot:1", "AI Bo"],
  ] as const)
    addPlayer(game, { id, name, slot, color: SLOT_COLORS[slot] });
  startMatch(game);
  const view = toView(game);
  return {
    ...view,
    phase: "playing",
    tick: 100,
    matchStats: snapshotMatchStats(game.matchStats),
    ...over,
    players: (over.players ?? view.players).map((p) => ({
      ...p,
      connected: true,
      alive: true,
      bombReadyAtTick: 0,
      ...riders[p.id],
    })),
  };
};

const present = (
  state: WorldView,
  over: Partial<Omit<RoomPresenterInput, "state">> = {},
) =>
  presentRoom({
    state,
    playerId: "me",
    manages: true,
    managerId: "me",
    replacedHost: false,
    creator: true,
    hostPresent: true,
    solo: false,
    displayOnly: false,
    lobbyCard: false,
    joining: false,
    phoneLobby: false,
    mobileActive: false,
    bombHeld: false,
    spectators: [],
    ...over,
  });

test("the recap is ready only once the final-round pause has run out", () => {
  assert.equal(recapReady({ phase: "playing", tick: 900 }), false);
  assert.equal(
    recapReady({ phase: "matchOver", tick: 99, phaseEndsAtTick: 100 }),
    false,
  );
  assert.equal(
    recapReady({ phase: "matchOver", tick: 100, phaseEndsAtTick: 100 }),
    true,
  );
  assert.equal(recapReady({ phase: "matchOver", tick: 0 }), true);
});

test("lobby: who is ready, what the host may do, and what a guest waits for", () => {
  const lobby = frame({ phase: "lobby" });
  const host = present(lobby, { lobbyCard: true });
  assert.equal(host.lobby.count, "3 riders");
  assert.equal(host.lobby.empty, false);
  assert.deepEqual(
    host.lobby.riders.map((r) => [r.id, r.name, r.status]),
    [
      ["me", "Anders", "NOT READY"],
      ["ada", "Ada", "NOT READY"],
      ["bot:1", "AI Bo", "READY"],
    ],
  );
  assert.equal(
    host.notice,
    "Ready up — the race starts when everyone is ready",
  );
  assert.equal(host.avatarHidden, false);
  assert.equal(host.roundClock, "");
  assert.equal(host.roundChipHidden, true);
  assert.equal(host.announcerVisible, false);
  assert.deepEqual(host.actions, {
    hidden: false,
    ready: { hidden: false, pressed: false, label: "READY" },
    start: { label: "START RACE", disabled: false },
    reset: { disabled: true, hidden: false },
    shareHidden: false,
    addAIDisabled: false,
  });
  assert.equal(host.power.hidden, true);

  const guest = present(lobby, { playerId: "ada", manages: false });
  assert.equal(
    guest.notice,
    "Ready up — the race starts when everyone is ready",
  );
  assert.equal(guest.actions.hidden, false);

  const unseated = present(lobby, { playerId: "new", manages: false });
  assert.equal(unseated.joined, false);
  assert.equal(unseated.notice, "Join your friends, then start the race");
  assert.equal(unseated.avatarHidden, true);
  assert.equal(unseated.joinPanelHidden, false);
  assert.equal(unseated.controlsHidden, true);
  assert.equal(unseated.fire.label, undefined, "keeps the label it had");
  assert.equal(unseated.hud, undefined);
  assert.equal(unseated.hudHidden, true);
  assert.equal(unseated.playerColor, undefined);
});

test("lobby count: waiting for a second rider, and offline riders do not count", () => {
  const one = frame({ phase: "lobby" }, { ada: { connected: false } });
  const alone = present({ ...one, players: one.players.slice(0, 1) });
  assert.equal(alone.lobby.count, "1 rider · Waiting for at least 2 riders");
  assert.equal(alone.actions.start.disabled, true);
  const none = present({
    ...one,
    players: one.players.map((p) => ({ ...p, connected: false })),
  });
  assert.equal(none.lobby.count, "Waiting for at least 2 riders");
  assert.deepEqual(
    none.lobby.riders.map((r) => r.status),
    ["OFFLINE", "OFFLINE", "OFFLINE"],
  );
  const empty = present({ ...one, players: [] });
  assert.equal(empty.lobby.empty, true);
  assert.equal(empty.standings.length, 0);
});

test("the phone lobby drops BACK TO LOBBY and TV VIEW, solo has no TV VIEW, and a full room cannot add AI", () => {
  const lobby = frame({ phase: "lobby" });
  const phone = present(lobby, { phoneLobby: true, lobbyCard: true });
  assert.equal(phone.actions.reset.hidden, true);
  assert.equal(phone.actions.shareHidden, true);
  assert.equal(present(lobby, { solo: true }).actions.shareHidden, true);
  const five = frame({ phase: "lobby" });
  const full = {
    ...five,
    players: [
      ...five.players,
      { ...five.players[2]!, id: "bot:2" },
      { ...five.players[2]!, id: "bot:3" },
    ],
  };
  assert.equal(full.players.length, MAX_RIDERS);
  assert.equal(present(full).actions.addAIDisabled, true);
});

test("a tab replaced as host loses its host actions", () => {
  assert.equal(
    present(frame({ phase: "lobby" }), { replacedHost: true }).actions.hidden,
    true,
  );
});

test("countdown: the seconds to go, and the power chip", () => {
  const view = present(
    frame({ phase: "countdown", tick: 100, phaseEndsAtTick: 141 }),
  );
  assert.equal(view.notice, "READY · 3");
  assert.equal(view.power.hidden, false);
  assert.equal(view.power.text.startsWith("◆"), true);
  assert.equal(view.actions.start.disabled, true);
  assert.equal(view.actions.reset.disabled, false);
  assert.equal(present(frame({ phase: "countdown" })).notice, "READY · 0");
});

test("the fire button says what a press would do", () => {
  const label = (rider: Partial<RiderView>, bombHeld = false) =>
    present(frame({}, { me: rider }), { bombHeld }).fire;
  assert.equal(label({}).label, "HOLD TO FIRE");
  assert.equal(label({}, true).label, "RELEASE!");
  assert.equal(label({ bombReadyAtTick: 121 }).label, "2s RECHARGE");
  assert.equal(label({ shellArmed: true }).label, "FIRE SHELL");
  const gun = label({ gunArmed: true });
  assert.deepEqual(gun, {
    weapon: "gun",
    gunReady: true,
    title: "Tap to fire Gun, or hold and steer to aim (Space)",
    label: "HOLD TO AIM GUN",
  });
  assert.equal(
    label({ gunArmed: true, gunAim: 0.2 }).label,
    "STEER TO AIM · RELEASE!",
  );
  assert.equal(label({ gunArmed: true, alive: false }).gunReady, false);
  assert.equal(label({}).title, "Hold to charge, release to fire (Space)");
  assert.equal(
    present(frame({ phase: "countdown" }, { me: { gunArmed: true } })).fire
      .gunReady,
    false,
  );
});

test("playing: the phone HUD, and the notice for a rider out of this round", () => {
  const live = present(frame({}, { me: { matchScoreUnits: 120 } }), {
    mobileActive: true,
  });
  assert.equal(live.notice, "");
  assert.equal(live.hudHidden, false);
  assert.equal(live.hud?.fire, "HOLD TO FIRE");
  assert.equal(live.hud?.wins, "2 PTS · +0");
  assert.equal(live.hud?.clock, live.roundClock);
  assert.equal(live.roundChipHidden, live.roundClock === "");
  assert.equal(live.announcerVisible, true);

  const out = present(frame({}, { me: { alive: false } }), {
    mobileActive: true,
  });
  assert.equal(out.notice, "Eliminated — next round soon");
  assert.equal(out.hud?.fire, "WIPED OUT");

  const waiting = present(frame({}, { me: { waitingForNextRound: true } }));
  assert.equal(waiting.notice, "You’re in — joining next round");

  // The HUD text is kept current off the phone too, so it is right the moment the phone layout shows it.
  const desktop = present(frame());
  assert.equal(desktop.hudHidden, true);
  assert.equal(desktop.hud?.fire, "HOLD TO FIRE");
  assert.equal(present(frame({ phase: "roundOver" })).hud?.fire, "");
});

test("standings: ranked by match score, round points breaking ties, the leader marked once anybody scored", () => {
  const start = present(frame({ phase: "roundOver" }));
  assert.deepEqual(
    start.standings.map((s) => [s.id, s.rank, s.leader, s.lead]),
    [
      ["me", 1, false, "0"],
      ["ada", 2, false, "0"],
      ["bot:1", 3, false, "0"],
    ],
  );
  const scored = present(
    frame(
      { phase: "roundOver" },
      {
        me: { matchScoreUnits: 60, roundScoreUnits: 0, alive: false },
        ada: { matchScoreUnits: 120, roundScoreUnits: 60 },
        "bot:1": {
          matchScoreUnits: 60,
          roundScoreUnits: 30,
          connected: false,
        },
      },
    ),
  );
  assert.deepEqual(
    scored.standings.map((s) => [s.id, s.rank, s.leader, s.lead, s.out]),
    [
      ["me", 3, false, "0.5", true],
      ["ada", 1, true, "1", false],
      ["bot:1", 2, false, "0.5", false],
    ],
  );
  const bot = scored.standings[2]!;
  assert.equal(bot.name, "AI Bo · offline");
  assert.equal(bot.points, "1 PTS · +0.5");
  assert.equal(bot.title, "AI Bo · 1 PTS · +0.5 this round");
  assert.deepEqual(bot.remove, {
    hidden: false,
    disabled: false,
    title: "Remove AI rider",
    label: "Remove AI Bo",
    confirms: false,
  });
  assert.deepEqual(
    scored.standings[1]!.remove,
    {
      hidden: false,
      disabled: false,
      title: "Remove Ada from the room",
      label: "Remove Ada from the room",
      confirms: true,
    },
    "a friend goes the same way as an AI rider, but is asked about twice",
  );
  assert.equal(
    scored.standings[0]!.remove.hidden,
    true,
    "never the manager's own row",
  );
  assert.equal(
    present(frame({ phase: "roundOver" }), { manages: false }).standings[2]!
      .remove.hidden,
    true,
    "only the host",
  );
  const midRound = present(frame()).standings[2]!.remove;
  assert.equal(midRound.disabled, true);
  assert.equal(midRound.title, "Remove AI between rounds or return to menu");
  assert.equal(
    present(frame({}, { ada: { waitingForNextRound: true } })).standings[1]!
      .name,
    "Ada · next round",
  );
  assert.equal(
    present(frame({ phase: "countdown" }, { me: { alive: false } }))
      .standings[0]!.out,
    false,
    "nobody is out before play",
  );
});

test("round over: who took the round", () => {
  assert.equal(
    present(frame({ phase: "roundOver", roundWinnerId: "me" })).notice,
    "You win this round",
  );
  assert.equal(
    present(frame({ phase: "roundOver", roundWinnerId: "ada" })).notice,
    "Ada wins this round",
  );
  assert.equal(
    present(frame({ phase: "roundOver" })).notice,
    "Nobody wins this round",
  );
});

test("match over: the winner's beat, then MATCH COMPLETE and REMATCH once the recap is ready", () => {
  const ends = 1000;
  const matchOver = (tick: number, winner?: string) => {
    const state = frame({ phase: "matchOver", tick, phaseEndsAtTick: ends });
    const stats = state.matchStats.map((s) => ({ ...s }));
    return {
      ...state,
      matchStats: stats,
      ...(winner === undefined ? {} : { matchWinnerId: winner }),
    };
  };
  // Past the round-result beat, before the recap.
  const beat = ends - MATCH_WINNER_TICKS;
  assert.equal(present(matchOver(beat, "me")).notice, "You win the match");
  assert.equal(present(matchOver(beat, "ada")).notice, "Ada wins the match");
  assert.equal(present(matchOver(beat)).notice, "Shared victory");
  const pause = present(matchOver(beat, "me"));
  assert.equal(pause.recapReady, false);
  assert.equal(pause.resultsHidden, true);
  assert.deepEqual(pause.actions.start, { label: "REMATCH", disabled: true });

  const ready = present(matchOver(ends, "ada"));
  assert.equal(ready.recapReady, true);
  assert.equal(ready.resultsHidden, false);
  assert.equal(ready.notice, "Ada · MATCH COMPLETE");
  assert.deepEqual(ready.actions.start, { label: "REMATCH", disabled: false });
  assert.equal(
    present(matchOver(ends)).notice,
    "Shared victory · MATCH COMPLETE",
  );
});

test("a TV has no seat, no controls and no power chip", () => {
  const view = present(frame(), {
    playerId: "",
    manages: false,
    displayOnly: true,
  });
  assert.equal(view.joinPanelHidden, true);
  assert.equal(view.controlsHidden, true);
  assert.equal(view.power.hidden, true);
  assert.equal(view.power.text, "");
  // A display that somehow holds a rider still hides them.
  const seated = present(frame(), { displayOnly: true });
  assert.equal(seated.joinPanelHidden, true);
  assert.equal(seated.controlsHidden, true);
  assert.equal(seated.power.hidden, true);
  assert.equal(seated.playerColor, SLOT_COLORS[0]);
});

test("behind the join card the announcer stays down", () => {
  assert.equal(
    present(frame(), { joining: true, playerId: "new" }).announcerVisible,
    false,
  );
});

test("status: three plain states for players, the runtime's wording kept, and the action a player can take", () => {
  assert.deepEqual(presentStatus("connected · 3 riders"), {
    text: "Connected",
    raw: "connected · 3 riders",
    tone: "ok",
    action: undefined,
    replaced: false,
  });
  assert.deepEqual(presentStatus("ICE failed — retrying"), {
    text: "Connection trouble — retrying",
    raw: "ICE failed — retrying",
    tone: "bad",
    action: "RETRY",
    replaced: false,
  });
  const replaced = presentStatus("Host session replaced by a newer tab");
  assert.equal(replaced.action, "TAKE OVER HOSTING");
  assert.equal(replaced.replaced, true);
  assert.equal(presentStatus("Connecting…").action, undefined);
});

test("the watching list is its own block: no colour, no READY, and a footer that counts the two apart", () => {
  const lobby = frame({ phase: "lobby", tick: 0 });
  const watchers = [
    { id: "w1", name: "Watcher", connected: true },
    { id: "w2", name: "Away", connected: false },
  ];
  const view = present(lobby, {
    spectators: watchers,
    playerId: "ada",
    manages: false,
  });
  assert.equal(view.lobby.watchersHidden, false);
  assert.deepEqual(
    view.lobby.watchers.map((seat) => [seat.id, seat.name, seat.status]),
    [
      ["w1", "Watcher", "WATCHING"],
      ["w2", "Away", "OFFLINE"],
    ],
  );
  assert.deepEqual(
    view.lobby.watchers.map((seat) => seat.remove.hidden),
    [true, true],
    "a guest cannot send a watcher home",
  );
  assert.equal(
    view.lobby.count,
    "3 riders · 1 watching",
    "the footer counts the seats and the watchers apart, and only the present ones",
  );
  assert.deepEqual(
    view.lobby.riders.map((rider) => rider.id),
    ["me", "ada", "bot:1"],
    "the watchers are not riders",
  );
  const empty = present(lobby);
  assert.equal(empty.lobby.watchersHidden, true);
  assert.deepEqual(empty.lobby.watchers, []);
  assert.equal(
    empty.lobby.count,
    "3 riders",
    "a room nobody watches says exactly what it always said",
  );
});

test("a watcher is in the room: no join card, no controls, no avatar and its own notice", () => {
  const lobby = frame({ phase: "lobby", tick: 0 });
  const watcher = present(lobby, {
    playerId: "w1",
    manages: false,
    spectators: [{ id: "w1", name: "Watcher", connected: true }],
  });
  assert.equal(watcher.joined, false);
  assert.equal(
    watcher.joinPanelHidden,
    true,
    "it is in, so the join card goes",
  );
  assert.equal(watcher.controlsHidden, true, "it steers nothing");
  assert.equal(watcher.avatarHidden, true, "and picks no avatar");
  assert.equal(watcher.hudHidden, true);
  assert.equal(watcher.power.hidden, true);
  assert.equal(watcher.playerColor, undefined);
  assert.equal(watcher.notice, "Watching · waiting for the race to start");
  assert.deepEqual(
    watcher.lobby.watchers.map((seat) => seat.status),
    ["YOU · WATCHING"],
    "its own row says which one it is",
  );
  assert.deepEqual(
    present(lobby, {
      playerId: "w1",
      manages: true,
      managerId: "w1",
      spectators: [{ id: "w1", name: "Watcher", connected: true }],
    }).lobby.watchers.map((seat) => [
      seat.status,
      seat.host,
      seat.remove.hidden,
    ]),
    [["YOU · WATCHING", true, true]],
    "a host watching from the list wears the badge and cannot remove itself",
  );
  assert.deepEqual(
    present(lobby, {
      playerId: "me",
      manages: true,
      managerId: "me",
      spectators: [{ id: "w1", name: "Watcher", connected: true }],
    }).lobby.watchers.map((seat) => seat.remove),
    [
      {
        hidden: false,
        disabled: false,
        title: "Remove Watcher from the room",
        label: "Remove Watcher from the room",
        confirms: true,
      },
    ],
    "and a watcher holds no seat, so the manager may send it home in any phase",
  );
  assert.equal(
    present(lobby, { playerId: "ada", manages: false }).notice,
    "Ready up — the race starts when everyone is ready",
    "a seated rider's notice is unchanged",
  );
});

test("the host badge follows the fold, and the delegate gets the host's controls", () => {
  const lobby = frame({ phase: "lobby" });
  // On the host's own screen and on everyone else's: one row wears the badge, and it is the same row.
  for (const playerId of ["me", "ada", "new"])
    assert.deepEqual(
      present(lobby, {
        playerId,
        manages: playerId === "me",
        managerId: "me",
      }).lobby.riders.map((rider) => rider.host),
      [true, false, false],
      `${playerId} sees the badge on the host's row`,
    );
  // The creator dropped: the fold hands the room to the rider in the next seat, and its controls with it.
  const delegate = present(lobby, {
    playerId: "ada",
    manages: true,
    managerId: "ada",
  });
  assert.deepEqual(
    delegate.lobby.riders.map((rider) => rider.host),
    [false, true, false],
  );
  assert.equal(delegate.actions.hidden, false);
  assert.deepEqual(
    delegate.standings.map((p) => p.remove.hidden),
    [false, true, false],
    "and holds the remove buttons the creator held, except over its own seat",
  );
  // The creator is back on the page but the fold still names Ada: its controls are Ada's until the crown moves back.
  const guest = present(lobby, {
    playerId: "me",
    manages: false,
    managerId: "ada",
  });
  assert.deepEqual(
    guest.lobby.riders.map((rider) => rider.host),
    [false, true, false],
  );
  assert.deepEqual(
    guest.standings.map((p) => p.remove.hidden),
    [true, true, true],
    "and holds no remove button either",
  );
});

test("a tab replaced as host keeps neither its controls nor its remove buttons", () => {
  const view = present(frame({ phase: "lobby" }), { replacedHost: true });
  assert.equal(view.actions.hidden, true);
  assert.deepEqual(
    view.standings.map((p) => p.remove.hidden),
    [true, true, true],
  );
});

test("ready controls belong to riders, including guests; votes are reflected and spectators cannot vote", () => {
  const lobby = frame({ phase: "lobby" });
  assert.deepEqual(
    present(lobby, { manages: false, readyPlayers: ["me"] }).actions.ready,
    { hidden: false, pressed: true, label: "NOT READY" },
  );
  assert.equal(
    present(lobby, { displayOnly: true }).actions.ready.hidden,
    true,
  );
  assert.equal(
    present(lobby, { playerId: "watcher" }).actions.ready.hidden,
    true,
  );
  assert.equal(present(lobby, { solo: true }).actions.ready.hidden, true);
  assert.equal(
    present(frame({ phase: "matchOver", tick: 1, phaseEndsAtTick: 2 })).actions
      .ready.hidden,
    true,
  );
  assert.deepEqual(
    present(frame({ phase: "matchOver", tick: 2, phaseEndsAtTick: 2 }), {
      manages: false,
    }).actions.ready,
    { hidden: false, pressed: false, label: "READY FOR REMATCH" },
  );
});

test("controller artwork follows the local rider’s next weapon and resets after spending it", () => {
  const weapons: Partial<RiderView> = {
    gunArmed: true,
    shellArmed: true,
    fiveShotArmed: true,
    tripleShotArmed: true,
  };
  const icon = () =>
    present(frame({}, { me: weapons, ada: { gunArmed: true } })).fire.weapon;
  assert.equal(icon(), "gun");
  weapons.gunArmed = false;
  assert.equal(icon(), "shell");
  weapons.shellArmed = false;
  assert.equal(icon(), "five");
  weapons.fiveShotArmed = false;
  assert.equal(icon(), "triple");
  weapons.tripleShotArmed = false;
  assert.equal(icon(), "bomb");
  assert.equal(present(frame(), { playerId: "missing" }).fire.weapon, "bomb");
});

test("changing sides is offered on this device's own row only, and says why when it cannot", () => {
  const lobby = frame({ phase: "lobby", tick: 0 });
  const watchers = [
    { id: "w1", name: "Watcher", connected: true },
    { id: "w2", name: "Other", connected: true },
  ];
  const mine = present(lobby, { spectators: watchers });
  assert.deepEqual(
    mine.lobby.riders.map((rider) => [rider.id, rider.switchSide.hidden]),
    [
      ["me", false],
      ["ada", true],
      ["bot:1", true],
    ],
    "only this device's seat carries WATCH; an AI rider has no device to watch from",
  );
  assert.deepEqual(
    mine.lobby.riders.find((rider) => rider.id === "me")!.switchSide,
    {
      hidden: false,
      disabled: false,
      label: "WATCH",
      title: "Give your seat up and watch instead",
    },
  );
  assert.deepEqual(
    mine.lobby.watchers.map((seat) => seat.switchSide.hidden),
    [true, true],
    "and none of the watchers is this device",
  );

  const watching = present(lobby, { spectators: watchers, playerId: "w1" });
  assert.deepEqual(
    watching.lobby.watchers.map((seat) => [seat.id, seat.switchSide.hidden]),
    [
      ["w1", false],
      ["w2", true],
    ],
  );
  assert.equal(
    watching.lobby.watchers[0]!.switchSide.label,
    "TAKE A SEAT",
    "the watcher's own row takes the other direction",
  );

  // Mid-round both directions say when to try again rather than going away.
  const running = present(frame({ phase: "playing" }), {
    spectators: watchers,
    playerId: "w1",
  });
  assert.deepEqual(
    [
      running.lobby.watchers[0]!.switchSide.disabled,
      running.lobby.watchers[0]!.switchSide.title,
    ],
    [true, "Take a seat between rounds — try again at the pause"],
  );
  assert.equal(
    present(frame({ phase: "playing" })).lobby.riders[0]!.switchSide.title,
    "Start watching between rounds — try again at the pause",
  );

  // A manager that did not open the room hands the pair to the creator's page, so it changes sides like anyone else
  // while that page is here — which is every shared-screen room, where the first rider wears the crown throughout.
  assert.equal(
    present(lobby, { spectators: watchers, managerId: "me", creator: false })
      .lobby.riders[0]!.switchSide.disabled,
    false,
    "a stand-in host with the creator's page in the room still switches",
  );
  const standIn = present(lobby, {
    spectators: watchers,
    managerId: "me",
    creator: false,
    hostPresent: false,
  });
  assert.deepEqual(
    [
      standIn.lobby.riders[0]!.switchSide.disabled,
      standIn.lobby.riders[0]!.switchSide.title,
    ],
    [true, "You are standing in as host — switch sides once the host is back"],
    "only a room whose creator's page has gone has nobody left to write the pair",
  );

  // A full watching list and a full room are the runtime's own refusals, said before the tap.
  const full = present(lobby, {
    spectators: ["w1", "w2", "w3", "w4", "w5"].map((id) => ({
      id,
      name: id,
      connected: true,
    })),
  });
  assert.equal(
    full.lobby.riders[0]!.switchSide.title,
    "Room is full (5 spectators watching)",
  );
  const fullRoom = present(
    frame({
      phase: "lobby",
      tick: 0,
      players: [0, 1, 2, 3, 4].map((slot) => ({
        ...frame().players[0]!,
        id: `p${slot}`,
        slot,
      })),
    }),
    { spectators: watchers, playerId: "w1" },
  );
  assert.equal(
    fullRoom.lobby.watchers[0]!.switchSide.title,
    "Room is full (5 players)",
  );

  // Solo is one device and four AI, and a display is not a member: neither has a side to change.
  assert.equal(
    present(lobby, { solo: true }).lobby.riders[0]!.switchSide.hidden,
    true,
  );
  assert.equal(
    present(lobby, { displayOnly: true }).lobby.riders[0]!.switchSide.hidden,
    true,
  );
});
