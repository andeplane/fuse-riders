import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import type { Model, Row } from "../src/app/presenter.js";
import { resultBar, resultReport } from "../src/app/result-report.js";

type Result = NonNullable<Model["result"]>;
const document = parseHTML("<!doctype html><html><body></body></html>")
  .document as unknown as Document;
const COLORS = ["#ff2e9d", "#16e7ff", "#b6ff4d"];
const row = (fields: Partial<Row>): Row => ({
  id: "a",
  bot: false,
  place: 1,
  slot: 0,
  name: "Ada",
  you: false,
  chart: "HARD 9",
  accuracy: "94.2%",
  maxCombo: "212",
  judgments: ["120", "64", "10", "2", "0", "1"],
  grade: "AA",
  score: "942,000",
  detail: "HARD 9 · 94.2%",
  combo: "MAX COMBO 212",
  ...fields,
});
const result = (fields: Partial<Result> = {}): Result => ({
  title: "YOU WIN!",
  song: "GRID",
  rows: [
    row({ you: true }),
    row({
      id: "b",
      place: 2,
      slot: 1,
      name: "Bo",
      grade: "B",
      score: "700,000",
      accuracy: "70.0%",
      maxCombo: "250",
      judgments: ["40", "90", "40", "10", "5", "12"],
    }),
    row({ id: "c", place: 3, slot: 2, name: "Bot", bot: true, maxCombo: "9" }),
  ],
  own: {
    grade: "AA",
    score: "942,000",
    detail: "HARD 9 · 94.2% · MAX COMBO 212",
    badge: "",
  },
  counts: [],
  lines: ["NEW BEST! +400,000 (WAS 50.0%)"],
  host: true,
  waiting: "",
  solo: false,
  session: null,
  final: false,
  primary: { text: "PLAY AGAIN", action: "rematch" },
  secondary: { text: "SONG SELECT", action: "lobby" },
  ...fields,
});
const parts = (run: Node[] = []) => ({
  color: (slot: number) => COLORS[slot]!,
  friend: (id: string) => {
    const button = document.createElement("button");
    button.textContent = `+ ADD FRIEND ${id}`;
    return button;
  },
  run,
  document,
});

test("a battle's result: the winner, every player's grade, score, accuracy and combo, and a friend button per other human", () => {
  const run = document.createElement("div");
  const report = resultReport(result(), parts([run]));
  assert.equal(report.game, "FUSEMANIA");
  assert.equal(report.kicker, "SONG COMPLETE");
  assert.equal(report.context, "GRID · 3 players");
  assert.equal(report.headline, "YOU WIN!");
  assert.equal(report.emblem, undefined);
  assert.equal(report.accent, COLORS[0]);
  assert.deepEqual(report.standings!.columns, [
    "GRADE",
    "SCORE",
    "ACCURACY",
    "MAX COMBO",
  ]);
  assert.deepEqual(
    report.standings!.rows.map((entry) => [
      entry.placement,
      entry.name,
      entry.you,
      entry.tag,
      entry.friend?.textContent,
      entry.values,
    ]),
    [
      [1, "Ada", true, undefined, undefined, ["AA", "942,000", "94.2%", "212"]],
      [
        2,
        "Bo",
        false,
        undefined,
        "+ ADD FRIEND b",
        ["B", "700,000", "70.0%", "250"],
      ],
      [3, "Bot", false, "AI", undefined, ["AA", "942,000", "94.2%", "9"]],
    ],
  );
  // This device's new best, then the match's: the longest combo and the most Marvelous steps.
  assert.deepEqual(
    report.highlights!.cards.map((card) => [
      card.title,
      card.winners.map((winner) => winner.name),
    ]),
    [
      ["New best", ["Ada"]],
      ["Combo king", ["Bo"]],
      ["Sharpshooter", ["Ada", "Bot"]],
    ],
  );
  // The timing graph and the judgments stay on the page, under the standings.
  assert.deepEqual(
    report.sections!.map((section) => [section.title, section.content[0]]),
    [["YOUR RUN", run]],
  );
  // Full stats: every player's judgments.
  const table = report.details!.content[0] as HTMLElement;
  assert.deepEqual(
    [...table.querySelectorAll("tbody tr")].map((line) =>
      [...line.children].map((cell) => cell.textContent),
    )[1],
    ["Bo", "HARD 9", "40", "90", "40", "10", "5", "12"],
  );
});

test("a solo run leads with its grade and has no full stats; a watcher has no run section", () => {
  const solo = resultReport(
    result({
      title: "GRID · AA",
      rows: [row({ you: true })],
      solo: true,
      own: {
        grade: "AA",
        score: "942,000",
        detail: "",
        badge: "FULL GREAT COMBO",
      },
    }),
    parts([document.createElement("div")]),
  );
  assert.equal(solo.headline, "GRID");
  assert.equal(solo.emblem, "AA");
  assert.equal(solo.summary, "942,000 · 94.2% · HARD 9");
  assert.equal(solo.context, "GRID · 1 player");
  assert.equal(solo.details, undefined);
  assert.equal(solo.standings!.rows[0]!.friend, undefined);
  assert.deepEqual(
    solo.highlights!.cards.map((card) => card.title),
    ["FULL GREAT COMBO", "New best"],
  );
  const watcher = resultReport(result({ own: null, lines: [] }), parts());
  assert.deepEqual(watcher.sections, []);
});

test("a session: its standings under each song, and leading the report once it is over", () => {
  const session = {
    title: "SESSION · AFTER SONG 1 OF 3",
    rows: [
      {
        place: 1,
        name: "Bo",
        you: false,
        slot: 1,
        points: "1,900,000",
        wins: "2 WINS",
      },
      {
        place: 2,
        name: "Ada",
        you: true,
        slot: 0,
        points: "900,000",
        wins: "",
      },
    ],
  };
  const between = resultReport(result({ session }), parts());
  assert.equal(between.sections!.at(-1)!.title, "SESSION · AFTER SONG 1 OF 3");
  assert.equal(between.standings!.columns[0], "GRADE");
  const over = resultReport(
    result({
      title: "BO WINS THE SESSION",
      final: true,
      session: { ...session, title: "FINAL STANDINGS" },
    }),
    parts(),
  );
  assert.equal(over.kicker, "SESSION COMPLETE");
  assert.equal(over.headline, "BO WINS THE SESSION");
  assert.equal(over.accent, COLORS[1]);
  assert.equal(over.summary, "1,900,000 points · 2 wins");
  assert.deepEqual(over.standings!.columns, ["POINTS", "WINS"]);
  assert.deepEqual(
    over.standings!.rows.map((entry) => [entry.name, entry.you, entry.values]),
    [
      ["Bo", false, ["1,900,000", "2"]],
      ["Ada", true, ["900,000", "0"]],
    ],
  );
  assert.equal(over.sections![0]!.title, "LAST SONG · GRID");
});

test("the bar: the host's next steps, MENU alone, and for a guest what the room waits for", () => {
  assert.deepEqual(resultBar(result()), {
    actions: [
      { id: "secondary", label: "Song select" },
      { id: "primary", label: "PLAY AGAIN", primary: true },
    ],
  });
  assert.deepEqual(
    resultBar(result({ solo: true })).actions.map((action) => action.id),
    ["menu", "secondary", "primary"],
  );
  assert.deepEqual(
    resultBar(
      result({
        host: false,
        waiting: "Waiting for the host to pick the next song",
      }),
    ),
    { status: "Waiting for the host to pick the next song", actions: [] },
  );
});
