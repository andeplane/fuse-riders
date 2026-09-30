import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMatch,
  loadMap,
  neighbors,
  AI_STRATEGIES,
  type World,
} from "../src/engine/index.ts";
import {
  TUTORIAL_MAP,
  TUTORIAL_STEPS,
  nextStep,
  type TutorialContext,
} from "../src/app/tutorial.ts";
import {
  GUIDE_SECTIONS,
  OPENINGS,
  guideMarkup,
  isGuideSection,
} from "../src/app/guide.ts";

test("the tutorial map exists and every step reads as a sentence", () => {
  assert.ok(world());
  const ids = TUTORIAL_STEPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const step of TUTORIAL_STEPS) {
    assert.ok(step.title.length > 3);
    assert.match(step.text, /\.$/);
  }
  assert.equal(TUTORIAL_STEPS.at(-1)!.done, undefined, "the end waits");
});

test("manual steps wait for Next; done steps skip ahead", () => {
  const w = world();
  const context = (selectedCell: number | null = null): TutorialContext => ({
    world: w,
    playerId: "you",
    selectedCell,
  });
  assert.equal(nextStep(0, context()), 0, "the welcome waits");
  assert.equal(nextStep(1, context()), 1, "nothing selected yet");
  const brain = w.structures.find((s) => s.kind === "brain")!.cell;
  assert.equal(nextStep(1, context(brain)), 2);
  // Grow a connected neuron beside a deposit: two steps at once.
  const deposit = w.map.cells.findIndex((c) => c.terrain === "deposit");
  const beside = neighbors(w.map, deposit).find(
    (n) => w.map.cells[n]!.terrain === "open",
  )!;
  w.structures.push({
    id: w.nextEntityId++,
    cell: beside,
    ownerId: "you",
    kind: "neuron",
    hp: 60,
    connected: true,
  });
  assert.equal(TUTORIAL_STEPS[nextStep(2, context(brain))]!.id, "auto-expand");
  const p = w.players[0]!;
  p.autoExpand = true;
  p.research = ["growth"];
  p.territory = 30;
  p.priorities = { [beside]: 3 };
  w.structures.at(-1)!.kind = "tower";
  assert.equal(
    TUTORIAL_STEPS[nextStep(4, context(brain))]!.id,
    "done",
    "everything done reaches the end",
  );
  assert.equal(nextStep(TUTORIAL_STEPS.length - 1, context(brain)), 9);
});

test("the guide covers every section with live numbers and every opening", () => {
  for (const { id } of GUIDE_SECTIONS) {
    assert.ok(isGuideSection(id));
    const html = guideMarkup(id);
    assert.match(
      html,
      new RegExp(`aria-selected="true" class="guide-tab active">`),
    );
    assert.ok(html.length > 400, id);
  }
  assert.equal(isGuideSection("secrets"), false);
  assert.match(
    guideMarkup("goal"),
    /Hold 40% of the map in a duel \(30% with four players\) for 60 seconds/,
  );
  assert.match(guideMarkup("structures"), /Spore tower/);
  assert.match(guideMarkup("economy"), /A Neuron costs 20 biomass/);
  const strategies = guideMarkup("strategies");
  for (const s of AI_STRATEGIES) {
    const o = OPENINGS[s];
    assert.match(strategies, new RegExp(o.name));
    assert.ok(o.beats.length && o.losesTo.length, `${s} has a counter`);
    assert.ok(!o.beats.includes(s) && !o.losesTo.includes(s));
  }
  // Every opening is beaten by at least one other: no dominant strategy.
  for (const s of AI_STRATEGIES)
    assert.ok(
      AI_STRATEGIES.some((t) => OPENINGS[t].beats.includes(s)),
      `${s} is countered`,
    );
});

function world(): World {
  const map = loadMap(
    JSON.parse(
      readFileSync(
        new URL(`../maps/${TUTORIAL_MAP}.json`, import.meta.url),
        "utf8",
      ),
    ),
  );
  return createMatch(map, {}, [{ id: "you", slot: map.spawns[0]!.slot }]);
}
