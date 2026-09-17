import {
  createGame,
  addPlayer,
  startMatch,
  toSnapshot,
  MATCH_WINNER_TICKS,
  ROUND_OVER_TICKS,
  SLOT_COLORS,
} from "../src/engine/game.js";
import { snapshotMatchStats } from "../src/engine/match-stats.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  announcementFor,
  eliminationLine,
  matchWinnerName,
  roundClock,
  roundWinnerName,
  showsRoundResult,
  type Announcement,
} from "../src/client/arena-announcer.js";
import type { WorldView } from "../src/engine/view.js";
type ScoredView = WorldView;
const field = (announcement: Announcement, key: string) =>
  (announcement as unknown as Record<string, unknown>)[key];

const view = (overrides: Partial<ScoredView>): ScoredView => {
  const game = createGame("announcer");
  for (const [slot, id, name] of [
    [0, "me", "Anders"],
    [1, "ai", "AI Ada"],
  ] as const)
    addPlayer(game, { id, name, slot, color: SLOT_COLORS[slot] });
  startMatch(game);
  return {
    ...toSnapshot(game),
    phase: "playing",
    tick: 100,
    round: 2,
    matchStats: snapshotMatchStats(game.matchStats),
    ...overrides,
  };
};

test("countdown shows the seconds, then GO, with a steering hint for the input in use", () => {
  const state = view({ phase: "countdown", tick: 100, phaseEndsAtTick: 141 });
  assert.deepEqual(announcementFor(state, "me", false), {
    kind: "countdown",
    round: 2,
    count: "3",
    hint: "← → OR A / D TO STEER · HOLD SPACE TO CHARGE, RELEASE TO FIRE",
  });
  assert.equal(
    field(
      announcementFor(
        view({ phase: "countdown", tick: 141, phaseEndsAtTick: 141 }),
        "me",
        true,
      ),
      "count",
    ),
    "GO!",
  );
  assert.match(
    String(field(announcementFor(state, "me", true), "hint")),
    /HOLD LEFT/,
  );
});

test("round result names the winner, calls the local rider YOU and counts down to the next round", () => {
  const state = view({
    phase: "roundOver",
    tick: 500,
    phaseEndsAtTick: 560,
    roundWinnerId: "me",
    roundPlacements: [
      { playerId: "me", name: "Anders", place: 1, scoreUnits: 300 },
      { playerId: "ai", name: "AI Ada", place: 2, scoreUnits: 150 },
    ],
  });
  assert.deepEqual(announcementFor(state, "me", false), {
    kind: "round",
    round: 2,
    last: false,
    title: "YOU WIN THE ROUND",
    placements: ["#1 YOU  +5", "#2 AI Ada  +2.5"],
    next: "NEXT ROUND IN 3",
  });
  assert.equal(
    field(
      announcementFor({ ...state, roundWinnerId: "ai" }, "me", false),
      "title",
    ),
    "AI Ada WINS THE ROUND",
  );
  assert.equal(
    field(
      announcementFor({ ...state, roundWinnerId: undefined }, "me", false),
      "title",
    ),
    "DRAW",
  );
});

test("the final round shows its own result first, and only then names the match winner", () => {
  // The rider who died in the final round can still take the match: the two names must never share a card.
  const state = view({
    phase: "matchOver",
    tick: 500,
    phaseEndsAtTick: 500 + ROUND_OVER_TICKS + MATCH_WINNER_TICKS,
    roundWinnerId: "ai",
    matchWinnerId: "me",
    roundPlacements: [
      { playerId: "ai", name: "AI Ada", place: 1, scoreUnits: 300 },
      { playerId: "me", name: "Anders", place: 2, scoreUnits: 150 },
    ],
  });
  assert.equal(showsRoundResult(state), true);
  assert.deepEqual(announcementFor(state, "me", false), {
    kind: "round",
    round: 2,
    last: true,
    title: "AI Ada WINS THE ROUND",
    placements: ["#1 AI Ada  +5", "#2 YOU  +2.5"],
    next: "MATCH RESULT IN 3",
  });
  const lastRoundFrame = { ...state, tick: 500 + ROUND_OVER_TICKS - 1 };
  assert.equal(
    field(announcementFor(lastRoundFrame, "me", false), "next"),
    "MATCH RESULT IN 1",
  );
  const crowned = { ...state, tick: 500 + ROUND_OVER_TICKS };
  assert.equal(showsRoundResult(crowned), false);
  assert.deepEqual(announcementFor(crowned, "me", false), {
    kind: "final",
    title: "YOU WIN THE MATCH",
    subtitle: "MATCH WINNER",
  });
  assert.deepEqual(announcementFor(crowned, "ai", false), {
    kind: "final",
    title: "Anders WINS THE MATCH",
    subtitle: "MATCH WINNER",
  });
  // The host can remove a rider during the pause: the round's winner keeps its name from the placements.
  const removed = {
    ...state,
    players: state.players.filter((player) => player.id !== "ai"),
  };
  assert.equal(roundWinnerName(removed), "AI Ada");
  assert.equal(
    field(announcementFor(removed, "me", false), "title"),
    "AI Ada WINS THE ROUND",
  );
  assert.equal(matchWinnerName(crowned), "Anders");
  assert.deepEqual(
    announcementFor({ ...crowned, matchWinnerId: undefined }, "me", false),
    { kind: "final", title: "SHARED VICTORY", subtitle: "MATCH RESULT" },
  );
});

test("overtime and the final result surface on the arena; ordinary play is silent", () => {
  assert.equal(
    announcementFor(
      view({ phase: "playing", tick: 100, roundStartedTick: 0 }),
      "me",
      false,
    ).kind,
    "hidden",
  );
  assert.deepEqual(
    announcementFor(
      view({ phase: "playing", tick: 1300, roundStartedTick: 0 }),
      "me",
      false,
    ),
    { kind: "overtime", text: "OVERTIME // WALLS CLOSING · DRAW IN 25s" },
  );
  assert.deepEqual(
    announcementFor(
      view({
        phase: "matchOver",
        tick: 80,
        phaseEndsAtTick: 70,
        matchWinnerId: "me",
      }),
      "me",
      false,
    ),
    { kind: "final", title: "YOU WIN THE MATCH", subtitle: "MATCH COMPLETE" },
  );
  assert.equal(
    announcementFor(view({ phase: "lobby" }), "me", false).kind,
    "hidden",
  );
});

test("the round clock counts down to the draw and is empty in the lobby", () => {
  assert.equal(roundClock(view({ phase: "lobby" })), "");
  assert.equal(
    roundClock(view({ phase: "playing", tick: 200, roundStartedTick: 0 })),
    "ROUND 2/5 · 01:20",
  );
  assert.equal(
    roundClock(view({ phase: "countdown", tick: 100, phaseEndsAtTick: 141 })),
    "ROUND 2/5 · 00:03",
  );
  assert.equal(
    roundClock(view({ phase: "roundOver", tick: 100 })),
    "ROUND 2/5",
  );
});

test("eliminations become one readable feed line", () => {
  const players = [
    { id: "me", name: "Anders" },
    { id: "ai", name: "AI Ada" },
  ];
  assert.equal(
    eliminationLine(
      { type: "playerEliminated", playerId: "ai", cause: "wall" },
      players,
      "me",
    ),
    "AI Ada hit the wall",
  );
  // A board with scenery reports crashes under the same cause, so the line stops naming the wall.
  assert.equal(
    eliminationLine(
      { type: "playerEliminated", playerId: "ai", cause: "wall" },
      players,
      "me",
      "desert",
    ),
    "AI Ada crashed",
  );
  assert.equal(
    eliminationLine(
      { type: "playerEliminated", playerId: "me", cause: "trail" },
      players,
      "me",
      "city",
    ),
    "YOU clipped a trail",
  );
  assert.equal(
    eliminationLine(
      { type: "playerEliminated", playerId: "me", cause: "explosion" },
      players,
      "me",
    ),
    "YOU caught a blast",
  );
  assert.equal(
    eliminationLine({ type: "explosion", bombId: 1 }, players, "me"),
    undefined,
  );
});
