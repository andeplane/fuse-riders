import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { renderMatchRecap } from "../src/online/match-recap-view.js";
import {
  beginMatchParticipant,
  snapshotMatchStats,
  type MatchStatsState,
} from "../src/engine/match-stats.js";
import { momentKey, type Moment } from "../src/engine/moments.js";

function match() {
  const state: MatchStatsState = new Map();
  for (const [slot, name] of ["<Byte & friends>", "Turing", "YOU"].entries()) {
    beginMatchParticipant(state, {
      id: String(slot),
      slot,
      name,
      color: ["#bc8cff", "#ff46ae", "#24dfff"][slot]!,
    });
    Object.assign(state.get(String(slot))!, {
      matchScoreUnits: slot < 2 ? 960 : 60,
      roundWins: slot < 2 ? 2 : 0,
      roundsPlayed: 5,
      distanceUnits: 24913,
    });
  }
  return state;
}
const moment: Moment = {
  kind: "directHit",
  round: 2,
  tick: 140,
  elapsed: 40,
  playerId: "0",
  targetIds: ["2"],
  value: 1,
};
function render(
  state: MatchStatsState,
  moments: Moment[] = [],
  watchable = false,
) {
  const { document } = parseHTML("<html><body></body></html>");
  const watched: string[] = [];
  const root = renderMatchRecap(
    snapshotMatchStats(state),
    moments,
    {
      playerId: "2",
      canWatch: () => watchable,
      watch: (key) => watched.push(key),
    },
    document,
  );
  document.body.append(root);
  return { root, watched };
}

test("recap preserves shared placements and renders names as text", () => {
  const { root } = render(match());
  assert.equal(root.querySelector("h2")?.textContent, "SHARED VICTORY");
  assert.equal(
    root.querySelector(".recap-victory p")?.textContent,
    "<Byte & friends> + Turing",
  );
  assert.deepEqual(
    [...root.querySelectorAll("tbody td:first-child")].map(
      (e) => e.textContent,
    ),
    ["01", "01", "03"],
  );
  assert.equal(root.querySelectorAll(".is-champion").length, 2);
  assert.equal(root.querySelector("byte"), null);
  assert.equal(
    root.querySelector(".recap-standings .is-you th")?.textContent,
    "YOU",
  );
  assert.match(
    root.querySelector(".recap-tie-note")!.textContent!,
    /shared victory/,
  );
  assert.equal(
    root.querySelector(".recap-details")?.hasAttribute("hidden"),
    true,
  );
  assert.equal(root.querySelectorAll(".recap-total").length, 8);
  assert.equal(
    root.querySelectorAll(".comparison-row:not(.comparison-header)").length,
    3,
  );
});

test("recap explains points tiebreak and keeps the local rider's name", () => {
  const state = match();
  state.get("1")!.roundWins = 1;
  state.get("2")!.name = "Local rider";
  const { root } = render(state);
  assert.equal(root.querySelector("h2")?.textContent, "<Byte & friends> WINS");
  assert.equal(
    root.querySelector(".recap-victory p")?.textContent,
    "16 points · 2 round wins",
  );
  assert.match(
    root.querySelector(".recap-tie-note")!.textContent!,
    /decided by round wins/,
  );
  assert.equal(
    root.querySelector(".recap-standings .is-you th")?.textContent,
    "Local riderYOU",
  );
});

test("recap keeps replay callbacks and all detailed awards", () => {
  const state = match();
  const { root, watched } = render(state, [moment], true);
  assert.equal(
    root.querySelector(".recap-feature h4")?.textContent,
    "BULLSEYE",
  );
  assert.equal(root.querySelectorAll(".recap-feature").length, 2);
  assert.equal(
    root.querySelectorAll(".recap-feature-names")[1]?.textContent,
    "<Byte & friends> + Turing + YOU",
  );
  root.querySelector<HTMLButtonElement>(".watch-again")!.click();
  assert.deepEqual(watched, [momentKey(moment)]);
  assert.equal(
    render(state, [moment]).root.querySelector(".watch-again"),
    null,
  );
});

test("recap handles no highlights, a fallback award and empty stats", () => {
  const state = match();
  for (const entry of state.values()) {
    entry.distanceUnits = 0;
    entry.matchScoreUnits = entry.playerId === "0" ? 300 : 0;
    entry.roundsPlayed = 1;
    entry.roundWins = entry.playerId === "0" ? 1 : 0;
  }
  const { root } = render(state);
  assert.match(
    root.querySelector(".recap-featured")!.textContent!,
    /standings tell the story/,
  );
  assert.equal(
    root.querySelector(".recap-victory p")?.textContent,
    "5 points · 1 round win",
  );
  assert.equal(
    root.querySelector(".recap-tie-note")?.textContent,
    "The standings tell the story this time.",
  );
  state.get("0")!.bombsExploded = 2;
  assert.equal(
    render(state).root.querySelector(".recap-feature h4")?.textContent,
    "DEMOLITION EXPERT",
  );
  const empty = render(new Map()).root;
  assert.ok(empty.querySelector(".recap-empty"));
  assert.equal(empty.querySelector("table"), null);
  const solo = render(new Map([["0", state.get("0")!]])).root;
  assert.equal(
    solo.querySelector(".recap-context small")?.textContent,
    "1 round / 1 rider",
  );
});
