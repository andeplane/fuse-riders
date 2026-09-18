import test from "node:test";
import assert from "node:assert/strict";
// CSS-free policy is imported from the dedicated policy boundary.
import { mobilePlayPolicy } from "../src/online/mobile-play-policy.js";
const PLAY_PHASES = ["countdown", "playing", "roundOver", "matchOver"];
const PHASES = ["lobby", ...PLAY_PHASES];
test("a joined phone is the same controller in both orientations in every play phase (#13)", () => {
  for (const phase of PLAY_PHASES) {
    const state = { joined: true, phase, displayOnly: false };
    assert.deepEqual(
      mobilePlayPolicy(state, true, 390, 844),
      { phone: true, lobby: false, active: true, portrait: true },
      phase,
    );
    assert.deepEqual(
      mobilePlayPolicy(state, true, 844, 390),
      { phone: true, lobby: false, active: true, portrait: false },
      phase,
    );
    assert.deepEqual(
      mobilePlayPolicy(state, true, 320, 568),
      { phone: true, lobby: false, active: true, portrait: true },
      phase,
    );
  }
});
// #134: the lobby is a phone screen in either orientation — no controller, no rotate gate — for a joined rider and for a host who has not taken a seat yet.
test("a phone in the lobby gets the lobby screen, never the controller", () => {
  for (const joined of [true, false])
    for (const [width, height] of [
      [390, 844],
      [844, 390],
      [320, 568],
    ] as const)
      assert.deepEqual(
        mobilePlayPolicy(
          { joined, phase: "lobby", displayOnly: false },
          true,
          width,
          height,
        ),
        { phone: true, lobby: true, active: false, portrait: false },
        `joined=${joined} ${width}x${height}`,
      );
});
test("once the report is ready an unjoined phone is back on the lobby screen and a joined phone stays the controller", () => {
  const state = { phase: "matchOver", displayOnly: false, recapReady: true };
  assert.deepEqual(
    mobilePlayPolicy({ ...state, joined: false }, true, 390, 844),
    { phone: true, lobby: true, active: false, portrait: false },
  );
  assert.deepEqual(
    mobilePlayPolicy({ ...state, joined: true }, true, 844, 390),
    { phone: true, lobby: false, active: true, portrait: false },
  );
  assert.equal(
    mobilePlayPolicy(
      { ...state, joined: false, recapReady: false },
      true,
      390,
      844,
    ).lobby,
    false,
    "the final-round pause keeps the arena",
  );
});
test("unjoined, display-only and wide desktop views keep the normal layout", () => {
  for (const phase of PHASES) {
    const state = { joined: true, phase, displayOnly: false };
    assert.equal(
      mobilePlayPolicy({ ...state, joined: false }, true, 390, 844).active,
      false,
      phase,
    );
    assert.deepEqual(
      mobilePlayPolicy({ ...state, displayOnly: true }, true, 390, 844),
      { phone: false, lobby: false, active: false, portrait: false },
      phase,
    );
    assert.equal(mobilePlayPolicy(state, false, 844, 390).phone, false, phase);
    assert.equal(mobilePlayPolicy(state, true, 1366, 1024).phone, false, phase);
    assert.equal(mobilePlayPolicy(state, true, 1025, 1366).phone, false, phase);
  }
});
// #44: a terminal room close leaves the controller so the header status ("Room ended — return to menu to start again") and MENU are reachable without ☰ MENU.
test("an ended room is not joined play on any phone size or phase", () => {
  for (const phase of PHASES) {
    const ended = { joined: true, phase, displayOnly: false, ended: true };
    for (const [width, height] of [
      [390, 844],
      [844, 390],
      [320, 568],
    ] as const)
      assert.deepEqual(
        mobilePlayPolicy(ended, true, width, height),
        { phone: false, lobby: false, active: false, portrait: false },
        `${phase} ${width}x${height}`,
      );
    assert.equal(
      mobilePlayPolicy(
        { ...ended, ended: false, phase: "playing" },
        true,
        844,
        390,
      ).active,
      true,
      phase,
    );
  }
});

test("portrait tablets and narrow mouse windows get compact play without a rotation gate", () => {
  for (const touch of [false, true])
    for (const [width, height] of [
      [390, 844],
      [768, 1024],
      [1024, 1366],
    ] as const) {
      assert.deepEqual(
        mobilePlayPolicy(
          { joined: true, phase: "playing", displayOnly: false },
          touch,
          width,
          height,
        ),
        { phone: true, lobby: false, active: true, portrait: true },
      );
    }
});
