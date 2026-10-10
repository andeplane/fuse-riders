import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeDependencies } from "fuse-netcode";
import { PendingPick, SoloOpening } from "../src/app/flow.js";
import { DEFAULT_SETTINGS, type View } from "../src/online/game.js";
import { AxeRuntime } from "../src/online/runtime.js";

/** A solo runtime on a clock the test turns, whose frames go through `opening` as the page's `state` callback does. */
function solo(opening: SoloOpening) {
  let now = 0,
    tokens = 0,
    loop: (() => void) | undefined;
  const dependencies: RuntimeDependencies = {
    now: () => now,
    hidden: () => false,
    token: () => `token-${tokens++}`,
    generation: () => 1,
    schedule: (callback) => {
      loop = callback;
      return () => {
        loop = undefined;
      };
    },
    onVisibilityChange: () => () => {},
  };
  const seen: View[] = [],
    shown: View[] = [];
  let returns = 0;
  const runtime: AxeRuntime = new AxeRuntime(
    "SOLO",
    DEFAULT_SETTINGS,
    {
      state(frame) {
        seen.push(frame);
        const held = opening.holds(frame, () => {
          returns++;
          return runtime.command({ type: "action", action: "lobby" });
        });
        if (!held) shown.push(frame);
      },
      event() {},
      status() {},
      ready() {},
    },
    { dependencies, humanName: "Ada" },
  );
  runtime.start();
  return {
    runtime,
    seen,
    shown,
    returns: () => returns,
    run(ms: number) {
      for (const end = now + ms; now < end;) {
        now += 10;
        loop?.();
      }
    },
  };
}

test("solo opens on the lobby: the run it starts with never shows, a run the player starts does and stays", () => {
  const page = solo(new SoloOpening());
  assert.equal(page.seen[0]!.stage, "running", "the netcode starts a solo run");
  assert.equal(page.shown.length, 0, "and the page shows none of it");
  page.run(500);
  assert.equal(
    page.shown[0]!.stage,
    "lobby",
    "the first frame shown is the lobby",
  );
  assert.ok(page.shown.every((frame) => frame.stage === "lobby"));
  assert.equal(page.returns(), 1, "one return to the lobby was logged");
  assert.ok(page.runtime.command({ type: "action", action: "start" }));
  page.run(1_000);
  assert.equal(page.shown.at(-1)!.stage, "running", "START sets out");
  assert.ok(page.shown.some((frame) => frame.world?.heroes.length === 1));
  assert.equal(
    page.returns(),
    1,
    "and nothing takes the run back to the lobby",
  );
  const stages = page.shown.map((frame) => frame.stage),
    firstRun = stages.indexOf("running");
  assert.ok(
    stages.slice(firstRun).every((stage) => stage === "running"),
    "no frame of the run is the lobby again",
  );
});

test("the opening lets frames through when the return is refused, when the lobby never lands and when it starts in the lobby", () => {
  const frame = (stage: View["stage"], logTick: number) => ({
    stage,
    logTick,
  });
  const refused = new SoloOpening();
  assert.equal(
    refused.holds(frame("running", 1), () => true),
    true,
  );
  assert.equal(
    refused.holds(frame("running", 1), () => true),
    true,
    "same tick",
  );
  assert.equal(
    refused.holds(frame("running", 2), () => false),
    false,
  );
  assert.equal(
    refused.holds(frame("running", 3), () => assert.fail("asked again")),
    false,
    "once over, it stays over",
  );

  let asked = 0;
  const logged = () => {
    asked++;
    return true;
  };
  const stuck = new SoloOpening(10);
  stuck.holds(frame("running", 1), logged);
  assert.equal(stuck.holds(frame("running", 2), logged), true);
  assert.equal(
    stuck.holds(frame("running", 12), logged),
    true,
    "within the wait",
  );
  assert.equal(stuck.holds(frame("running", 13), logged), false, "past it");
  assert.equal(asked, 1, "the return is logged once");

  const lobby = new SoloOpening();
  assert.equal(
    lobby.holds(frame("lobby", 1), () => assert.fail("no return needed")),
    false,
  );
  assert.equal(
    lobby.holds(frame("running", 2), () => assert.fail("a started run stays")),
    false,
    "a run started after the lobby is never held",
  );
});

test("a pick stands in for the seat's hero until the room answers, and the room's hero wins from then on", () => {
  const pending = new PendingPick(20);
  assert.equal(pending.shown("brakka", true, 1), "brakka", "nothing picked");
  pending.pick("gorm", 10);
  assert.equal(
    pending.shown("brakka", true, 11),
    "gorm",
    "the old hero is in flight",
  );
  assert.equal(pending.shown("brakka", true, 12), "gorm");
  assert.equal(pending.shown("gorm", true, 13), "gorm", "the room agrees");
  assert.equal(
    pending.shown("rhea", true, 14),
    "rhea",
    "then the room is the truth",
  );
});

test("a pick the room drops shows the seat's hero again: after the wait, or once picks no longer apply", () => {
  const late = new PendingPick(20);
  late.pick("gorm", 10);
  assert.equal(late.shown("brakka", true, 30), "gorm");
  assert.equal(late.shown("brakka", true, 31), "brakka", "the wait is over");
  assert.equal(late.shown("brakka", true, 32), "brakka");
  const started = new PendingPick(20);
  started.pick("gorm", 10);
  assert.equal(
    started.shown("brakka", false, 12),
    "brakka",
    "a run began first, so the pick was dropped",
  );
  const unseated = new PendingPick(20);
  unseated.pick("gorm", 10);
  assert.equal(unseated.shown(null, false, 11), null, "no seat, no hero");
  const again = new PendingPick(20);
  again.pick("gorm", 10);
  again.pick("rhea", 11);
  assert.equal(
    again.shown("gorm", true, 12),
    "rhea",
    "the latest pick stands over an earlier answer",
  );
  assert.equal(again.shown("rhea", true, 13), "rhea");
  assert.equal(again.shown("rhea", true, 14), "rhea");
});
