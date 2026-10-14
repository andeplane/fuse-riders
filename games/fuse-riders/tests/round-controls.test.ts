import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  createRiderRoundControls,
  type RiderRoundControlsState,
} from "../src/online/round-controls.js";

function setup() {
  const { document } = parseHTML("<html><body></body></html>");
  const controls = createRiderRoundControls(document);
  document.body.append(controls.element);
  const frame: RiderRoundControlsState = {
    state: { round: 1, phase: "countdown" },
    scope: "match-one:1",
    joined: true,
    displayOnly: false,
    spectator: false,
    touch: false,
    ended: false,
  };
  return { controls, frame };
}

test("keyboard guidance appears each round and rematch, then leaves during play", () => {
  const { controls, frame } = setup();
  for (const [matchId, round] of [
    ["match-one", 1],
    ["match-one", 2],
    ["match-two", 1],
  ] as const) {
    const state = { round, phase: "countdown" } as const;
    controls.update({ ...frame, state, scope: `${matchId}:${round}` });
    assert.equal(controls.element.hidden, false);
    assert.equal(controls.element.dataset.round, `${matchId}:${round}`);
    assert.match(controls.element.textContent!, /← \/ A/);
    assert.match(controls.element.textContent!, /→ \/ D/);
    assert.match(controls.element.textContent!, /Space/);
    assert.match(controls.element.textContent!, /release to fire/);
    assert.equal(controls.element.getAttribute("aria-live"), "polite");
    controls.update({ ...frame, state: { ...state, phase: "playing" } });
    assert.equal(controls.element.hidden, true);
  }
});

test("phone controls teach hold and release without presenting keyboard keys", () => {
  const { controls, frame } = setup();
  controls.update({ ...frame, touch: true });
  assert.equal(controls.element.hidden, false);
  assert.match(controls.element.textContent!, /◀ zone/);
  assert.match(controls.element.textContent!, /▶ zone/);
  assert.match(controls.element.textContent!, /Fire zone/);
  assert.match(
    controls.element.textContent!,
    /Hold to charge, release to fire/,
  );
  assert.doesNotMatch(controls.element.textContent!, /Space/);
});

test("watching screens get guidance, arrivals and closed rooms do not", () => {
  const { controls, frame } = setup();
  controls.update({ ...frame, joined: false, spectator: true });
  assert.equal(controls.element.hidden, false);
  assert.match(controls.element.textContent!, /WATCHING THIS ROUND/);
  assert.doesNotMatch(controls.element.textContent!, /YOUR CONTROLS/);
  controls.update({ ...frame, joined: false });
  assert.equal(controls.element.hidden, true);
  controls.update({ ...frame, ended: true });
  assert.equal(controls.element.hidden, true);
  controls.update({ ...frame, state: undefined });
  assert.equal(controls.element.hidden, true);
});

test("shared TV shows the phone controls without asking viewers to take a seat", () => {
  const { controls, frame } = setup();
  controls.update({ ...frame, joined: false, displayOnly: true });
  assert.equal(controls.element.hidden, false);
  assert.match(controls.element.textContent!, /PHONE CONTROLS/);
  assert.match(controls.element.textContent!, /◀ zone/);
  assert.match(controls.element.textContent!, /Fire zone/);
  assert.doesNotMatch(controls.element.textContent!, /Space|YOUR CONTROLS/);
});
