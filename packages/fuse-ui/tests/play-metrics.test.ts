import assert from "node:assert/strict";
import test from "node:test";
import type { Analytics, AnalyticsStatus } from "../src/analytics.js";
import { pageRole, startGameAnalytics } from "../src/play-metrics.js";

type Call = { event: string; properties: Record<string, unknown> | undefined };

/** Records what a page reports; the rest of the interface is never reached by `startGameAnalytics`. */
function recordingAnalytics(
  calls: Call[],
  registered: Record<string, unknown>[],
) {
  const analytics: Analytics = {
    start: (properties) => {
      registered.push(properties);
    },
    track: (event, properties) => {
      calls.push({ event, properties });
    },
    status: (): AnalyticsStatus => "on",
    setOptOut: () => undefined,
    onChange: () => () => undefined,
    reportBootFailure: () => undefined,
    reportGraphics: () => undefined,
  };
  return analytics;
}

test("pageRole: solo wins, then a room's display or joiner, else the landing page", () => {
  assert.equal(pageRole(""), "landing");
  assert.equal(pageRole("?mute"), "landing");
  assert.equal(pageRole("?solo"), "solo");
  assert.equal(pageRole("?room=AB42&solo"), "solo");
  assert.equal(pageRole("?room=AB42"), "joiner");
  assert.equal(pageRole("?room=AB42&display=1"), "display");
  assert.equal(pageRole("?room=AB42&display=0"), "joiner");
});

test("startGameAnalytics: registers the role, then reports App Opened with whether the page is embedded", () => {
  const calls: Call[] = [];
  const registered: Record<string, unknown>[] = [];
  const created: string[] = [];
  const create = (gameId: string) => {
    created.push(gameId);
    return recordingAnalytics(calls, registered);
  };
  const inWindow = startGameAnalytics(
    "fuseball",
    { search: "?room=AB42&mute", embedded: true },
    create,
  );
  assert.deepEqual(created, ["fuseball"]);
  assert.deepEqual(registered, [{ role: "joiner" }]);
  assert.deepEqual(calls, [
    { event: "App Opened", properties: { embedded: true } },
  ]);
  // The instance handed back is the one that reports, so the page can keep tracking through it.
  inWindow.track("Match Ended", { played: true });
  assert.equal(calls.at(-1)?.event, "Match Ended");

  calls.length = 0;
  startGameAnalytics("fuse-riders", { search: "", embedded: false }, create);
  assert.deepEqual(registered.at(-1), { role: "landing" });
  assert.deepEqual(calls, [
    { event: "App Opened", properties: { embedded: false } },
  ]);
  // Nothing from the address — no room code — travels on the event; the shared boundary adds `gameId`.
  assert.equal(JSON.stringify(calls).includes("AB42"), false);
});
