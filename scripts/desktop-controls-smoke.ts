import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { smokeTimeout } from './smoke-timeout.js';
import { keyboardShortcuts } from '../src/online/keyboard-shortcuts.js';

// Isolated offline solo game: never joins or disturbs an occupied online room.
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.BROWSER === 'webkit' ? {} : { channel: 'chrome' }) });
try {
  const page = await browser.newPage({ viewport: { width: 1723, height: 997 } });
  page.setDefaultTimeout(smokeTimeout(30000));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.ONLINE_URL ?? 'http://127.0.0.1:5179/';
  await page.goto(`${base}?solo=1`);
  const left = page.locator('[aria-keyshortcuts~="ArrowLeft"]');
  const right = page.locator('[aria-keyshortcuts~="ArrowRight"]');
  const fire = page.locator('[aria-keyshortcuts="Space"]');
  await page.locator('.desktop-game').waitFor();
  // Lobby gives deterministic time for hold/cancel checks without AI round changes.
  await page.getByRole('button', { name: 'BACK TO LOBBY', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.online-notice')?.textContent === 'Join your friends, then start the race');
  for (const [code, button] of [['ArrowLeft', left], ['ArrowRight', right], ['KeyA', left], ['KeyD', right], ['Space', fire]] as const) {
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
  assert.equal(pads, null, 'desktop pads are hidden behind keyboard help');
  await page.getByRole('button', { name: 'Keyboard controls', exact: true }).click();
  // Assert the rendered help against the module that owns the copy, so a wording change cannot rot this smoke again (#169).
  const shortcuts = page.getByRole('dialog');
  // Ask the module for the same platform the page renders, or a mac-only driving key would pass on CI and fail on a Mac.
  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  const driving = keyboardShortcuts({ mac, canConfigure: true, solo: true }).find(group => group.title === 'Driving')!;
  await shortcuts.getByText('Driving', { exact: true }).waitFor();
  for (const [keys, action] of driving.entries) {
    await shortcuts.getByText(keys, { exact: true }).waitFor();
    await shortcuts.getByText(action, { exact: true }).waitFor();
  }
  await page.getByRole('button', { name: 'CLOSE', exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
  // Check the real playing path too: steering must change the rendered rider
  // heading, and Space must be accepted by the ordinary weapon input path.
  await page.goto(`${base}?solo=1&benchmark=1`);
  await page.locator('.desktop-game').waitFor();
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
  // Check actual fitted pixels, rather than the canvas's letterboxed element alone.
  const layouts = [];
  for (const viewport of [{ width: 2048, height: 1178 }, { width: 1723, height: 997 }, { width: 1280, height: 900 }, { width: 2560, height: 1080 }]) {
    await page.setViewportSize(viewport);
    // Blasts shake the canvas and replays zoom it. Their transformed bounds are not
    // layout bounds; sample the complete geometry together once the effect settles.
    const layout = await (await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.online-arena')!;
      if (getComputedStyle(canvas).transform !== 'none') return;
      const r = canvas.getBoundingClientRect(), bar = document.querySelector('.online-header')!.getBoundingClientRect();
      const scale = Math.min(r.width / canvas.width, r.height / canvas.height);
      const roster = document.querySelector('.online-roster')!.getBoundingClientRect();
      const actions = document.querySelector('.online-host')!.getBoundingClientRect();
      return { ui: parseFloat(getComputedStyle(document.documentElement).fontSize) / 16, viewport: { width: innerWidth, height: innerHeight }, arena: { width: r.width, height: r.height, y: r.y }, fitted: { width: canvas.width * scale, height: canvas.height * scale }, bar: { height: bar.height, bottom: bar.bottom }, rosterX: roster.x, rosterWidth: roster.width, arenaRight: r.right, actionsY: actions.y, overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
    })).jsonValue();
    assert.ok(layout);
    assert.equal(layout.overflow, false);
    const scores = await page.locator('.online-score-points').evaluateAll(elements => elements.map(element => {
      const score = element.getBoundingClientRect(), label = element.parentElement!.getBoundingClientRect();
      return { text: element.textContent, fits: score.left >= label.left && score.right <= label.right + 1 };
    }));
    assert.equal(scores.length, 5);
    assert.ok(scores.every(score => score.fits && /\d+ PTS · \+\d+/.test(score.text ?? '')), 'long rider names must not truncate match points or the round award');
    assert.ok(layout.arena.y >= layout.bar.bottom && layout.arena.y <= layout.bar.bottom + 5 * layout.ui, `Arena/bar placement: ${JSON.stringify(layout)}`);
    // The UI scales with the viewport above 1920x1080, so the bar's padding and gap allowances scale with it.
    assert.ok(layout.arena.height >= viewport.height - layout.bar.height - 13 * layout.ui);
    if (viewport.width === 2048) {
      assert.ok(layout.fitted.width > (viewport.width - layout.rosterWidth) * .97, 'reference screen uses at least 97% of the space left of the standings');
      assert.ok(layout.rosterX >= layout.arenaRight - 1, 'standings sit in their own column right of the arena');
      await page.screenshot({ path: 'artifacts/desktop-controls.png' });
    }
    layouts.push(layout);
  }
  // A resize restores the original compact-screen layout and can return to the game bar.
  await page.setViewportSize({ width: 900, height: 700 });
  await page.locator('.online-controls').waitFor({ state: 'visible' });
  await page.setViewportSize({ width: 1723, height: 997 });
  await page.locator('.desktop-game').waitFor();
  assert.equal(await page.locator('.online-controls').isVisible(), false);
  const phone = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  phone.setDefaultTimeout(smokeTimeout(30000));
  phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(`${base}?solo=1`);
  await phone.locator('.online-controls').waitFor({ state: 'visible' });
  const phonePads = await phone.locator('.online-controls').boundingBox();
  assert.ok(phonePads && phonePads.height >= 64, 'phone retains large touch pads');
  await phone.waitForFunction(() => document.querySelector('.online-notice')?.textContent === '');
  await phone.screenshot({ path: 'artifacts/desktop-controls-phone.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: process.env.BROWSER ?? 'chromium', desktopArena: arena, desktopPads: pads, layouts, phonePads, errors }));
} finally {
  await browser.close();
}
