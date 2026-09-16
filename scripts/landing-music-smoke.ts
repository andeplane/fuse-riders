/**
 * Landing-page music smoke: the soundtrack plays on the landing page itself, alt-tabbing away never
 * restarts it, and the top-bar toggle turns it off in a way that survives the page load into a room.
 *
 * Music is a plain media element (so a phone's volume keys reach it), so "is it playing" is read off
 * that element rather than inferred from network traffic. The toggle labels the setting, not the speaker:
 * a page the browser has not let play yet still reads ON, because the first gesture anywhere starts it.
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
// Autoplay is blocked deterministically, as on a phone: nothing sounds until a gesture, so the toggle's first click is a real test.
const browser = await chromium.launch({ headless: true, ...binary, ignoreDefaultArgs: ['--autoplay-policy=no-user-gesture-required'], args: ['--autoplay-policy=user-gesture-required'] });
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
  // Whatever this browser's autoplay policy does, music IS on, and the label says so rather than reporting the
  // browser's silence as a setting the visitor never chose.
  assert.equal(await label(), '♫ MUSIC ON', 'an untapped page reads the setting, which is on');
  assert.equal(await stored(), null, 'nothing is stored before the visitor chooses');
  // Any first gesture starts it, toggle or not.
  await page.mouse.click(720, 700); await settle();
  assert.equal(await label(), '♫ MUSIC ON');
  const playing = await track(page);
  assert.ok(playing, 'the landing page owns a music element');
  assert.ok(/^\/music\/.+\.m4a$/.test(playing.src), playing.src);
  assert.equal(playing.paused, false, 'music plays on the landing page, with no room and no match');
  assert.ok(playing.volume > 0 && playing.volume <= 1, `music has a real volume, got ${playing.volume}`);

  // The toggle sits in the landing top bar, on the same side as the room header's SETTINGS button.
  const bar = (await page.locator('.landing-top').boundingBox())!;
  const button = (await page.locator('.landing-audio').boundingBox())!;
  assert.ok(button.y >= bar.y - 1 && button.y + button.height <= bar.y + bar.height + 1, 'the toggle sits inside the top bar');
  assert.ok(button.x > bar.x + bar.width / 2, 'the toggle sits on the right, like the room header SETTINGS button');
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

  // Off pauses rather than playing on at zero volume, so silence never streams the playlist; on
  // resumes the same track from where it stopped instead of restarting it.
  await page.locator('.landing-audio').click(); await settle();
  assert.equal(await label(), '♫ MUSIC OFF');
  assert.equal(await page.locator('.landing-audio').getAttribute('data-muted'), 'true');
  assert.equal(await page.locator('.landing-audio').getAttribute('aria-pressed'), null, 'the label states the state, so aria-pressed would contradict it');
  const off = (await track(page))!;
  assert.equal(off.volume, 0, 'music off silences the element');
  assert.equal(off.paused, true, 'music off stops streaming');
  assert.deepEqual((await stored()).muted, { music: true, effects: false });
  await page.locator('.landing-audio').click(); await settle();
  assert.equal(await label(), '♫ MUSIC ON');
  const back = (await track(page))!;
  assert.ok(back.volume > 0, 'music on restores the volume');
  assert.equal(back.paused, false, 'music on resumes playing');
  assert.equal(back.src, off.src, 'toggling never swaps the track');
  assert.ok(back.time >= off.time, `toggling never rewinds the track: ${off.time} -> ${back.time}`);

  // SOUND OFF mutes both channels (what Ctrl+M does), so MUSIC reads OFF too; SOUND ON brings both back and resumes the track.
  const mute = () => page.locator('.landing-mute').textContent();
  assert.equal(await mute(), '🔊 SOUND ON');
  await page.locator('.landing-mute').click(); await settle();
  assert.equal(await mute(), '🔇 SOUND OFF'); assert.equal(await label(), '♫ MUSIC OFF');
  assert.deepEqual((await stored()).muted, { music: true, effects: true });
  assert.equal((await track(page))!.paused, true, 'sound off stops streaming');
  await page.locator('.landing-mute').click(); await settle();
  assert.equal(await mute(), '🔊 SOUND ON'); assert.equal(await label(), '♫ MUSIC ON');
  assert.deepEqual((await stored()).muted, { music: false, effects: false });
  assert.equal((await track(page))!.paused, false, 'sound on resumes playing');

  // Settings have to survive the full page load between the landing page and a room.
  await page.locator('.landing-audio').click(); await settle();
  const muted: string[] = [];
  page.on('request', request => { if (/\/music\/.*\.m4a$/.test(request.url())) muted.push(new URL(request.url()).pathname); });
  await page.reload(); await page.waitForSelector('.landing-audio'); await settle();
  assert.equal(await label(), '♫ MUSIC OFF', 'a reload keeps the choice, and the label reports it before any gesture');
  assert.deepEqual((await stored()).muted, { music: true, effects: false });
  await page.mouse.click(720, 700); await settle();
  // A page loaded with music off downloads no music at all rather than streaming it silently.
  assert.deepEqual(muted, [], `a muted page fetches no track, got ${JSON.stringify(muted)}`);

  assert.deepEqual(errors, [], `no page errors: ${errors.join('\n')}`);
  console.log('landing music smoke passed');
} finally {
  await browser.close();
}
