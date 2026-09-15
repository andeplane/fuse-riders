/**
 * Landing-page music smoke: the soundtrack plays on the landing page itself, alt-tabbing away never
 * restarts it, and the top-bar toggle turns it off in a way that survives the page load into a room.
 *
 * Music is a plain media element (so a phone's silent switch and volume keys reach it), so "is it
 * playing" is read off that element rather than inferred from network traffic.
 *
 * Run against a dev server: LANDING_URL=http://127.0.0.1:5173/ npx tsx scripts/landing-music-smoke.ts
 */
import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const url = process.env.LANDING_URL ?? 'http://127.0.0.1:5173/';
const KEY = 'fuse-riders-audio';
// CHROMIUM_PATH lets a sandbox with a mismatched Playwright download point at its own build.
const binary = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' };
const browser = await chromium.launch({ headless: true, ...binary });
const errors: string[] = [];

/** The one <audio> element the page owns, or undefined before music has been asked for. */
const track = (page: Page) => page.evaluate(() => {
  const element = document.querySelector('audio') ?? undefined;
  return element && { src: new URL(element.src, location.href).pathname, paused: element.paused, volume: element.volume, time: element.currentTime };
});

try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.stack ?? e.message));
  const settle = () => page.waitForTimeout(700);
  const label = () => page.locator('.landing-audio').textContent();
  const stored = async () => JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY) ?? 'null');

  await page.goto(url); await page.waitForSelector('.landing-audio'); await settle();
  // Headless Chromium's autoplay verdict is not stable run to run, so a click stands in for the first
  // gesture a real visitor makes; either way the landing page itself must be playing after it.
  await page.mouse.click(720, 700); await settle();
  const playing = await track(page);
  assert.ok(playing, 'the landing page owns a music element');
  assert.ok(/^\/music\/.+\.m4a$/.test(playing.src), playing.src);
  assert.equal(playing.paused, false, 'music plays on the landing page, with no room and no match');
  assert.ok(playing.volume > 0 && playing.volume <= 1, `music has a real volume, got ${playing.volume}`);

  // The toggle sits in the landing top bar, on the same side as the room header's audio button.
  const bar = (await page.locator('.landing-top').boundingBox())!;
  const button = (await page.locator('.landing-audio').boundingBox())!;
  assert.ok(button.y >= bar.y - 1 && button.y + button.height <= bar.y + bar.height + 1, 'the toggle sits inside the top bar');
  assert.ok(button.x > bar.x + bar.width / 2, 'the toggle sits on the right, like the room header audio button');
  assert.ok(button.height >= 40, `the toggle is a real touch target, got ${button.height}px`);
  assert.equal(await label(), '♫ MUSIC ON');
  await page.screenshot({ path: 'artifacts/landing-music.png' });

  // Alt-tabbing away and back must not restart the track: it keeps playing and keeps its position.
  const before = (await track(page))!;
  // String form on purpose: tsx compiles a closure with esbuild helpers the page does not have.
  const setHidden = (hidden: boolean) => page.evaluate(
    `Object.defineProperty(document,'hidden',{configurable:true,get:function(){return ${hidden}}});`
    + `document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await setHidden(true); await settle();
  await setHidden(false); await settle();
  const after = (await track(page))!;
  assert.equal(after.paused, false, 'alt-tabbing back leaves music playing');
  assert.equal(after.src, before.src, 'alt-tabbing does not change the track');
  assert.ok(after.time >= before.time, `alt-tabbing never rewinds the track: ${before.time} -> ${after.time}`);

  // Off and on again is a volume change on the same element, not a restart.
  await page.locator('.landing-audio').click(); await settle();
  assert.equal(await label(), '♫ MUSIC OFF');
  assert.equal(await page.locator('.landing-audio').getAttribute('aria-pressed'), 'true');
  assert.equal((await track(page))!.volume, 0, 'music off silences the element');
  assert.deepEqual((await stored()).muted, { music: true, effects: false });
  const off = (await track(page))!;
  await page.locator('.landing-audio').click(); await settle();
  assert.equal(await label(), '♫ MUSIC ON');
  assert.ok((await track(page))!.volume > 0, 'music on restores the volume');
  assert.equal((await track(page))!.src, off.src, 'toggling never swaps the track');

  // Settings have to survive the full page load between the landing page and a room.
  await page.locator('.landing-audio').click(); await settle();
  await page.reload(); await page.waitForSelector('.landing-audio'); await settle();
  assert.equal(await label(), '♫ MUSIC OFF', 'mute survives the page load');
  assert.deepEqual((await stored()).muted, { music: true, effects: false });

  assert.deepEqual(errors, [], `no page errors: ${errors.join('\n')}`);
  console.log('landing music smoke passed');
} finally {
  await browser.close();
}
