import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  defaultRoomSettings,
  SETTINGS_KEY,
} from "../src/engine/room-settings.js";
/**
 * Analytics evidence: a one-round solo match plays to completion with Mixpanel intercepted, and the events it
 * reported are checked against what they are supposed to carry.
 *
 * This exists because the failure mode is silent by construction. Mixpanel answers `200` to a request whose
 * properties it dropped, so a bad payload looks exactly like a good one from inside the game — a property named
 * `length` once erased every property on `Match Started`, including the super properties, and nothing noticed.
 * HOME_URL is the served app; BROWSER=webkit selects WebKit.
 */
const base = process.env.HOME_URL ?? "http://127.0.0.1:4188/";
const browserName = process.env.BROWSER === "webkit" ? "webkit" : "chrome";
const oneRound = {
  ...defaultRoomSettings(),
  match: "rounds" as const,
  length: 1,
};
interface Reported {
  event: string;
  properties: Record<string, unknown>;
}

await mkdir("artifacts", { recursive: true });
const browser = await (browserName === "webkit"
  ? webkit.launch({ headless: true })
  : // Headless Chromium still plays the soundtrack through the machine's speakers.
    chromium.launch({ headless: true, args: ["--mute-audio"] }));
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
const reported: Reported[] = [];
const requestUrls: string[] = [];
// Intercepted, never delivered: a smoke must not write into the production project.
await context.route("**/*mixpanel.com/**", async (route) => {
  requestUrls.push(route.request().url());
  try {
    for (const event of JSON.parse(
      new URLSearchParams(route.request().postData() ?? "").get("data")!,
    ))
      reported.push(event);
  } catch {
    /* not a track payload */
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: '{"error":null,"status":1}',
  });
});
await page.addInitScript(
  ([key, settings]) =>
    localStorage.setItem(key as string, JSON.stringify(settings)),
  [SETTINGS_KEY, oneRound],
);
await page.goto(`${base}?solo=1&analytics=1`);
// Tap fire through the countdown and the first seconds of play, so the rider pulls the trigger at least once before
// it rides into a wall: a tap during the countdown is dropped, and one mid-reload is simply refused.
for (let tap = 0; tap < 16; tap += 1) {
  await page.keyboard.down("Space");
  await page.waitForTimeout(150);
  await page.keyboard.up("Space");
  await page.waitForTimeout(350);
}
await page.getByRole("dialog").waitFor({ timeout: 180000 });
await page
  .getByRole("dialog")
  .getByRole("button", { name: /^(CLOSE|BACK TO LOBBY)$/ })
  .first()
  .click();
await page.getByRole("button", { name: "RESULTS", exact: true }).click();
await page.waitForFunction(
  () => document.querySelectorAll("dialog[open]").length > 0,
);
await page.waitForTimeout(6000);

// What the solo match reported, before the second tab below adds an App Opened of its own.
const soloReported = [...reported];

// Switching analytics off stops every request at once — in EVERY tab, the SDK's queued batch and its unload flush
// included — and the choice survives a reload, where the SDK is not even downloaded.
const closeDialog = () =>
  page
    .getByRole("dialog")
    .getByRole("button", { name: /^(CLOSE|BACK TO LOBBY)$/ })
    .first()
    .click();
await closeDialog();
// Tab B: the landing page in the same browser, analytics on (the `?analytics=1` override is sticky).
const other = await context.newPage();
await other.goto(base);
for (let waited = 0; waited < 15000; waited += 250) {
  if (reported.filter((e) => e.event === "FlowRiders.App Opened").length > 1)
    break;
  await other.waitForTimeout(250);
}
assert.equal(
  reported.filter((e) => e.event === "FlowRiders.App Opened").length,
  2,
  "tab B is reporting too",
);
await other
  .getByRole("button", { name: /SETTINGS/ })
  .first()
  .click();
await other.locator("details.settings-privacy > summary").click();
const otherToggle = other.locator("details.settings-privacy > button");
assert.equal(await otherToggle.textContent(), "ANALYTICS ON");
// Tab A queues an event in its own SDK batch, and tab B opts out before A's five-second flush.
await page.getByRole("button", { name: "RESULTS", exact: true }).click();
await otherToggle.focus();
await other.keyboard.press("Enter");
assert.equal(await otherToggle.textContent(), "ANALYTICS OFF");
const requestsAtOptOut = requestUrls.length;
await page.waitForTimeout(7000); // past A's flush timer
assert.equal(
  requestUrls.length,
  requestsAtOptOut,
  "tab A kept sending after tab B opted out",
);
await other.close();
// Tab A's own row heard about it, and works by keyboard in both directions without sending anything itself.
await closeDialog();
await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
const analyticsToggle = page.locator(".settings-privacy > button");
assert.equal(
  await analyticsToggle.textContent(),
  "ANALYTICS OFF",
  "tab A's SETTINGS row shows the choice made in tab B",
);
await analyticsToggle.focus();
await page.keyboard.press("Enter");
assert.equal(await analyticsToggle.textContent(), "ANALYTICS ON");
await page.keyboard.press("Enter");
assert.equal(await analyticsToggle.textContent(), "ANALYTICS OFF");
await closeDialog();
await page.getByRole("button", { name: "RESULTS", exact: true }).click(); // would be another Recap Reopened
await page.waitForTimeout(6000);
const sdkFetches: string[] = [];
page.on("request", (request) => {
  if (/mixpanel/i.test(request.url())) sdkFetches.push(request.url());
});
await page.reload();
await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
assert.equal(
  await page.locator(".settings-privacy > button").textContent(),
  "ANALYTICS OFF",
  "the opt-out survives a reload",
);
await page.waitForTimeout(6000);
assert.equal(
  requestUrls.length,
  requestsAtOptOut,
  "no request reaches Mixpanel after the opt-out, before or after a reload",
);
assert.deepEqual(sdkFetches, [], "an opted-out page never downloads the SDK");
await browser.close();

const named = (name: string) =>
  soloReported.filter((event) => event.event === `FlowRiders.${name}`);
const only = (name: string) => {
  const found = named(name);
  assert.equal(
    found.length,
    1,
    `expected exactly one ${name}, got ${found.length}`,
  );
  return found[0]!.properties;
};

const opened = only("App Opened");
assert.equal(opened.role, "solo");
// Solo starts its match before the first snapshot reaches the UI, so a gate keyed on leaving the lobby misses it.
const started = only("Match Started");
for (const key of [
  "matchNumber",
  "playerCount",
  "botCount",
  "matchLength",
  "powerupTypes",
  "host",
  "role",
]) {
  assert.ok(
    started[key] !== undefined,
    `Match Started lost its properties — is one of them named 'length'? missing: ${key}`,
  );
}
assert.equal(started.botCount, 4, "solo seats four AI riders");
const ended = only("Match Ended");
for (const key of [
  "playerCount",
  "botCount",
  "humanCount",
  "rounds",
  "played",
  "placement",
  "durationSeconds",
]) {
  assert.ok(ended[key] !== undefined, `Match Ended is missing ${key}`);
}
assert.equal(ended.played, true, "the solo rider held a seat");
// Weapons are one event per kill and per miss, never a per-match summary.
assert.equal(
  Object.keys(ended).some((key) => /^(shots|kills)[A-Z]/.test(key)),
  false,
  "Match Ended carries no weapon tallies",
);
const outcomes = [...named("Kill"), ...named("Miss")];
assert.ok(
  outcomes.length >= 1,
  "the rider fired, so its round reported at least one Kill or Miss",
);
for (const outcome of outcomes) {
  for (const key of [
    "weapon",
    "round",
    "secondsIntoRound",
    "bombs",
    "power",
    "extraBombs",
    "fuseLevel",
    "grip",
    "riders",
    "bots",
    "role",
  ])
    assert.ok(
      outcome.properties[key] !== undefined,
      `${outcome.event} lost ${key} — is a property named 'length'?`,
    );
}
for (const kill of named("Kill")) {
  for (const key of [
    "victimBot",
    "shotKills",
    "firstKillOfShot",
    "secondsToKill",
  ])
    assert.ok(kill.properties[key] !== undefined, `Kill is missing ${key}`);
}
only("Seat Taken");
only("Recap Reopened");

// `ip: false` at init becomes `ip=0` on every request: Mixpanel derives no city, region or country from it.
assert.ok(requestUrls.length > 0);
for (const url of requestUrls)
  assert.match(url, /[?&]ip=0(&|$)/, `geolocation is not switched off: ${url}`);

// A room page is `?room=CODE` and that code is the join credential: no event may carry a page URL.
const payload = JSON.stringify(reported);
for (const forbidden of ["$current_url", "$referrer", "$initial_referrer"]) {
  assert.ok(
    !payload.includes(forbidden),
    `${forbidden} would ship the room invite link to Mixpanel`,
  );
}
assert.ok(
  !payload.includes("solo=1"),
  "no event may carry the page query string",
);

const identity = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  date: new Date().toISOString(),
  base,
  browser: browserName,
};
const summary = {
  ...identity,
  events: reported.map((event) => event.event),
  started,
  ended,
  outcomes: outcomes.map((outcome) => ({
    event: outcome.event,
    ...outcome.properties,
  })),
};
await writeFile(
  `artifacts/analytics-${browserName}.json`,
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(JSON.stringify(summary, null, 2));
