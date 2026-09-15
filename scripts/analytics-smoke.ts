import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { defaultRoomSettings, SETTINGS_KEY } from '../src/shared/room-settings.js';
/**
 * Analytics evidence: a one-round solo match plays to completion with Mixpanel intercepted, and the events it
 * reported are checked against what they are supposed to carry.
 *
 * This exists because the failure mode is silent by construction. Mixpanel answers `200` to a request whose
 * properties it dropped, so a bad payload looks exactly like a good one from inside the game — a property named
 * `length` once erased every property on `Match Started`, including the super properties, and nothing noticed.
 * HOME_URL is the served app; BROWSER=webkit selects WebKit.
 */
const base = process.env.HOME_URL ?? 'http://127.0.0.1:4188/';
const browserName = process.env.BROWSER === 'webkit' ? 'webkit' : 'chrome';
const oneRound = { ...defaultRoomSettings(), match: 'rounds' as const, length: 1 };
interface Reported { event: string; properties: Record<string, unknown> }

await mkdir('artifacts', { recursive: true });
const browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const reported: Reported[] = [];
// Intercepted, never delivered: a smoke must not write into the production project.
await page.route('**/*mixpanel.com/**', async (route) => {
  try { for (const event of JSON.parse(new URLSearchParams(route.request().postData() ?? '').get('data')!)) reported.push(event); } catch { /* not a track payload */ }
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{"error":null,"status":1}' });
});
await page.addInitScript(([key, settings]) => localStorage.setItem(key as string, JSON.stringify(settings)), [SETTINGS_KEY, oneRound]);
await page.goto(`${base}?solo=1&analytics=1`);
await page.getByRole('dialog').waitFor({ timeout: 180000 });
await page.getByRole('button', { name: /^(CLOSE|BACK TO LOBBY)$/ }).first().click();
await page.getByRole('button', { name: 'RESULTS', exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length > 0);
await page.waitForTimeout(6000);
await browser.close();

const named = (name: string) => reported.filter((event) => event.event === `FlowRiders.${name}`);
const only = (name: string) => { const found = named(name); assert.equal(found.length, 1, `expected exactly one ${name}, got ${found.length}`); return found[0]!.properties; };

const opened = only('App Opened');
assert.equal(opened.role, 'solo');
// Solo starts its match before the first snapshot reaches the UI, so a gate keyed on leaving the lobby misses it.
const started = only('Match Started');
for (const key of ['matchNumber', 'playerCount', 'botCount', 'matchLength', 'powerupTypes', 'host', 'role']) {
  assert.ok(started[key] !== undefined, `Match Started lost its properties — is one of them named 'length'? missing: ${key}`);
}
assert.equal(started.botCount, 4, 'solo seats four AI riders');
const ended = only('Match Ended');
for (const key of ['playerCount', 'botCount', 'humanCount', 'rounds', 'played', 'placement', 'durationSeconds']) {
  assert.ok(ended[key] !== undefined, `Match Ended is missing ${key}`);
}
assert.equal(ended.played, true, 'the solo rider held a seat');
only('Seat Taken');
only('Recap Reopened');

// A room page is `?room=CODE` and that code is the join credential: no event may carry a page URL.
const payload = JSON.stringify(reported);
for (const forbidden of ['$current_url', '$referrer', '$initial_referrer']) {
  assert.ok(!payload.includes(forbidden), `${forbidden} would ship the room invite link to Mixpanel`);
}
assert.ok(!payload.includes('solo=1'), 'no event may carry the page query string');

const identity = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), date: new Date().toISOString(), base, browser: browserName };
const summary = { ...identity, events: reported.map((event) => event.event), started, ended };
await writeFile(`artifacts/analytics-${browserName}.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
