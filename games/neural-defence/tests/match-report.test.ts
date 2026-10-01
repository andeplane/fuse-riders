import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMatch,
  dominanceCells,
  loadMap,
  type MatchEvent,
  type PlayerSample,
  type World,
} from "../src/engine/index.ts";
import {
  chartMarkup,
  clock,
  eventText,
  findings,
  keyMoments,
  reportMarkup,
  reportPlayers,
  scoreboardMarkup,
  series,
  TEAM_NAMES,
} from "../src/app/match-report.ts";

test("clock formats ticks as minutes and seconds", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(20 * 75), "1:15");
  assert.equal(clock(20 * 600), "10:00");
});

test("players are named from the room, then You, then team colour", () => {
  const w = world();
  const named = reportPlayers(w, "a", (id) => (id === "b" ? "Ada" : undefined));
  assert.deepEqual(
    named.map((p) => [p.name, p.local, p.winner]),
    [
      ["You", true, true],
      ["Ada", false, false],
    ],
  );
  assert.deepEqual(
    reportPlayers(w, null).map((p) => p.name),
    [TEAM_NAMES[0], TEAM_NAMES[1]],
  );
  assert.notEqual(named[0]!.color, named[1]!.color);
});

test("series follow the timeline for each metric", () => {
  const w = world();
  assert.deepEqual(series(w, "territory").get("a"), [
    [0, 7],
    [200, 10],
    [400, 30],
    [600, 60],
  ]);
  assert.deepEqual(
    series(w, "economy")
      .get("b")!
      .map(([, v]) => v),
    [0, 5, 8, 10],
  );
  assert.deepEqual(
    series(w, "army")
      .get("b")!
      .map(([, v]) => v),
    [0, 0, 0, 0],
  );
});

test("charts draw a line per player and the dominance threshold for territory only", () => {
  const w = world();
  const players = reportPlayers(w, "a");
  const territory = chartMarkup(w, "territory", players);
  assert.equal(territory.match(/class="report-line/g)?.length, 2);
  assert.match(territory, /class="report-line winner"/);
  assert.doesNotMatch(
    territory,
    /report-threshold/,
    "far below dominance, the line would flatten the chart",
  );
  w.timeline.at(-1)!.players[0]!.territory = dominanceCells(w);
  assert.match(
    chartMarkup(w, "territory", players),
    new RegExp(`dominance ${dominanceCells(w)}`),
  );
  assert.match(
    territory,
    /aria-label="Territory over time\. Final: You 60, Red 20"/,
  );
  assert.match(territory, /class="report-moment"/, "moments are marked");
  assert.doesNotMatch(chartMarkup(w, "economy", players), /report-threshold/);
});

test("findings explain a dominance defeat from the loser's side", () => {
  const w = world();
  const players = reportPlayers(w, "b");
  const text = findings(w, players, "b").map((f) => `${f.tone}: ${f.text}`);
  assert.match(
    text[0]!,
    /^bad: Blue held 60 of \d+ cells needed for dominance/,
  );
  assert.ok(
    text.some((t) =>
      /^bad: Blue out-expanded You from 0:20: 30 cells to 18/.test(t),
    ),
  );
  assert.ok(text.some((t) => /Blue earned 50% more biomass than You/.test(t)));
  assert.ok(
    text.some((t) =>
      /You never fielded a weapon; Blue had one by 0:10/.test(t),
    ),
  );
  assert.ok(text.some((t) => /Powerups claimed: Blue 1, You 0/.test(t)));
});

test("findings are good news for the winner and explain eliminations", () => {
  const w = world();
  w.victory = "elimination";
  w.events.push({ tick: 500, playerId: "a", type: "brainHit", detail: "b" });
  const found = findings(w, reportPlayers(w, "a"), "a");
  assert.equal(found[0]!.tone, "good");
  assert.match(
    found[0]!.text,
    /You first reached a rival brain at 0:25 and destroyed the last one at 0:30/,
  );
});

test("a draw and an empty timeline say so plainly", () => {
  const w = world();
  w.winnerId = null;
  w.victory = null;
  assert.deepEqual(findings(w, reportPlayers(w, null), null), [
    { tone: "neutral", text: "Every brain fell on the same tick: a draw." },
  ]);
  w.winnerId = "a";
  w.timeline = [];
  assert.deepEqual(findings(w, reportPlayers(w, null), null), []);
});

test("events read as sentences and key moments come in order", () => {
  const players = reportPlayers(world(), "a");
  const text = (e: Omit<MatchEvent, "tick">) =>
    eventText({ tick: 0, ...e }, players);
  assert.equal(
    text({ playerId: "a", type: "researched", detail: "growth" }),
    "You researched Growth",
  );
  assert.equal(
    text({ playerId: "b", type: "claimed", detail: "surge" }),
    "Red claimed Growth surge",
  );
  assert.equal(
    text({ playerId: "b", type: "eliminated" }),
    "Red was eliminated",
  );
  assert.equal(
    text({ playerId: "a", type: "dominating" }),
    "You reached a dominant share",
  );
  assert.equal(
    text({ playerId: "a", type: "dominanceBroken" }),
    "You lost the dominant share",
  );
  assert.equal(
    text({ playerId: "b", type: "firstBlood" }),
    "Red drew first blood",
  );
  assert.equal(
    text({ playerId: "a", type: "brainHit", detail: "b" }),
    "You struck Red's brain",
  );
  const w = world();
  assert.deepEqual(
    keyMoments(w).map((e) => e.tick),
    [...w.events.map((e) => e.tick)].sort((x, y) => x - y),
  );
});

test("the scoreboard and full report carry every player", () => {
  const w = world();
  const players = reportPlayers(w, "a", (id) =>
    id === "b" ? "<Ada>" : undefined,
  );
  const board = scoreboardMarkup(w, players);
  assert.match(board, /You <em>winner<\/em>/);
  assert.match(board, /&lt;Ada&gt;/, "names are escaped");
  assert.doesNotMatch(board, /<Ada>/);
  const report = reportMarkup(w, players, "a", "army");
  assert.match(report, /aria-selected="true" class="report-tab active">Army/);
  assert.match(report, /What decided it/);
  assert.match(report, /Key moments/);
});

function world(): World {
  const map = loadMap(
    JSON.parse(
      readFileSync(
        new URL("../maps/close-quarters.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const w = createMatch(map, { matchId: "report" }, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  const sample = (
    id: string,
    territory: number,
    weapons: number,
    biomass: number,
  ): PlayerSample => ({
    id,
    territory,
    structures: territory / 3,
    weapons,
    biomassEarned: biomass * 1000,
    insightEarned: 0,
    damage: 0,
    lost: 0,
    biomass: 0,
  });
  w.tick = 600;
  w.finished = true;
  w.winnerId = "a";
  w.victory = "dominance";
  w.timeline = [
    { tick: 200, players: [sample("a", 10, 1, 6), sample("b", 10, 0, 5)] },
    { tick: 400, players: [sample("a", 30, 2, 12), sample("b", 18, 0, 8)] },
    { tick: 600, players: [sample("a", 60, 3, 15), sample("b", 20, 0, 10)] },
  ];
  w.players[0]!.territory = 60;
  w.players[1]!.territory = 20;
  w.events = [
    { tick: 300, playerId: "a", type: "dominating" },
    { tick: 120, playerId: "a", type: "claimed", detail: "cache" },
    { tick: 80, playerId: "b", type: "researched", detail: "growth" },
  ];
  return w;
}
