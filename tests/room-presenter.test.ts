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
    host: true,
    replacedHost: false,
    solo: false,
    displayOnly: false,
    lobbyCard: false,
    joining: false,
    phoneLobby: false,
    mobileActive: false,
    bombHeld: false,
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
  assert.equal(host.lobby.count, "3 riders ready");
  assert.equal(host.lobby.empty, false);
  assert.deepEqual(
    host.lobby.riders.map((r) => [r.id, r.name, r.status]),
    [
      ["me", "Anders", "READY"],
      ["ada", "Ada", "READY"],
      ["bot:1", "AI Bo", "READY"],
    ],
  );
  assert.equal(host.notice, "Join your friends, then start the race");
  assert.equal(host.avatarHidden, false);
  assert.equal(host.roundClock, "");
  assert.equal(host.roundChipHidden, true);
  assert.equal(host.announcerVisible, false);
  assert.deepEqual(host.actions, {
    hidden: false,
    start: { label: "START RACE", disabled: false },
    reset: { disabled: true, hidden: false },
    shareHidden: false,
    addAIDisabled: false,
  });
  assert.equal(host.power.hidden, true);

  const guest = present(lobby, { playerId: "ada", host: false });
  assert.equal(guest.notice, "Waiting for the host to start");
  assert.equal(guest.actions.hidden, true);

  const unseated = present(lobby, { playerId: "new", host: false });
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
  assert.equal(
    alone.lobby.count,
    "1 rider ready · Waiting for at least 2 riders",
  );
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
  assert.equal(label({ targetBombArmed: true }).label, "SLIDE TO AIM");
  const gun = label({ gunArmed: true });
  assert.deepEqual(gun, {
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

test("a target bomb aims from the rider, as a fraction of the arena", () => {
  const state = frame({}, { me: { targetBombArmed: true, x: 50, y: 25 } });
  assert.deepEqual(present(state).targetAim, {
    x: 50 / state.width,
    y: 25 / state.height,
  });
  assert.equal(
    present(frame({}, { me: { targetBombArmed: true, gunArmed: true } }))
      .targetAim,
    undefined,
  );
  assert.equal(present(frame()).targetAim, undefined);
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
  });
  assert.equal(scored.standings[0]!.remove.hidden, true, "only AI riders");
  assert.equal(
    present(frame({ phase: "roundOver" }), { host: false }).standings[2]!.remove
      .hidden,
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
    host: false,
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
