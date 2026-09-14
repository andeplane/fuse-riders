import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';

// Isolated offline solo game: never joins or disturbs an occupied online room.
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.BROWSER === 'webkit' ? {} : { channel: 'chrome' }) });
try {
  const page = await browser.newPage({ viewport: { width: 1723, height: 997 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.ONLINE_URL ?? 'http://127.0.0.1:5179/';
  await page.goto(`${base}?solo=1`);
  const left = page.locator('[aria-keyshortcuts="ArrowLeft"]');
  const right = page.locator('[aria-keyshortcuts="ArrowRight"]');
  const fire = page.locator('[aria-keyshortcuts="Space"]');
  await left.waitFor({ state: 'visible' });
  // Lobby gives deterministic time for hold/cancel checks without AI round changes.
  await page.getByRole('button', { name: 'MAIN MENU', exact: true }).click();
  for (const [code, button] of [['ArrowLeft', left], ['ArrowRight', right], ['Space', fire]] as const) {
    await page.keyboard.down(code);
    assert.match(await button.getAttribute('class') ?? '', /active/);
    await page.keyboard.up(code);
    assert.doesNotMatch(await button.getAttribute('class') ?? '', /active/);
  }
  await page.keyboard.down('Space');
  await page.getByRole('button', { name: 'ROOM SETTINGS', exact: true }).click();
  assert.doesNotMatch(await fire.getAttribute('class') ?? '', /active/);
  await page.keyboard.up('Space');
  await page.getByLabel('Match length').fill('2');
  await page.keyboard.press('ArrowLeft');
  assert.doesNotMatch(await left.getAttribute('class') ?? '', /active/);
  await page.getByRole('button', { name: 'CLOSE', exact: true }).click();
  await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.doesNotMatch(await fire.getAttribute('class') ?? '', /active/);
  await page.keyboard.down('Space'); // OS repeat after cancellation must stay cancelled.
  assert.doesNotMatch(await fire.getAttribute('class') ?? '', /active/);
  await page.keyboard.up('Space');
  const arena = await page.locator('.online-arena').boundingBox();
  const pads = await page.locator('.online-controls').boundingBox();
  assert.ok(arena && arena.height > 997 * .8, 'desktop arena should use over 80% of viewport height');
  assert.ok(pads && pads.height < 60, 'desktop pads should be compact');
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
  // Check the real playing path too: steering must change the rendered rider
  // heading, and Space must be accepted by the ordinary weapon input path.
  await page.goto(`${base}?solo=1&benchmark=1`);
  await left.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.online-notice')?.textContent === '');
  // A browser-side string keeps tsx's function-name helper out of the page.
  const heading = () => page.evaluate<number>(`new Promise(resolve => {
    window.addEventListener('fuse-benchmark', function listener(event) {
      const sample = event.detail;
      if (sample.kind !== 'prediction' || !sample.pose) return;
      window.removeEventListener('fuse-benchmark', listener);
      resolve(sample.pose.angle);
    });
  })`);
  const before = await heading();
  await page.keyboard.down('ArrowLeft');
  await heading();
  const after = await heading();
  await page.keyboard.up('ArrowLeft');
  assert.notEqual(after, before, 'arrow input must steer the rider during gameplay');
  await page.keyboard.down('Space');
  assert.match(await fire.getAttribute('class') ?? '', /active/);
  await heading();
  await page.keyboard.up('Space');
  await page.waitForFunction(() => document.querySelector('[aria-keyshortcuts="Space"]')?.textContent !== 'RELEASE!');
  assert.equal(await page.locator('.online-shot-error').isVisible(), false);
  await page.screenshot({ path: 'artifacts/desktop-controls.png' });
  const phone = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(`${base}?solo=1`);
  await phone.locator('.online-controls').waitFor({ state: 'visible' });
  const phonePads = await phone.locator('.online-controls').boundingBox();
  assert.ok(phonePads && phonePads.height >= 64, 'phone retains large touch pads');
  await phone.waitForFunction(() => document.querySelector('.online-notice')?.textContent === '');
  await phone.screenshot({ path: 'artifacts/desktop-controls-phone.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: process.env.BROWSER ?? 'chromium', desktopArena: arena, desktopPads: pads, phonePads, errors }));
} finally {
  await browser.close();
}
