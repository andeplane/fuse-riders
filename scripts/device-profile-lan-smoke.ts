import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { createGameServer } from '../src/server/index.js';

let now = 0;
const app = await createGameServer({ port: 0, hostname: '127.0.0.1', lanAddress: '127.0.0.1', manualTicks: true, dependencies: { now: () => now } });
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
const wait = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'LAN profile did not arrive'); await setTimeout(20); }
};
try {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${app.controllerUrl}`); await page.getByPlaceholder('Rider name').fill('LAN Phone');
  await page.getByRole('button', { name: 'JOIN THE GRID' }).click(); await page.locator('.controls:not(.hidden)').waitFor();
  await wait(() => app.game.players.size === 1); const player = [...app.game.players.values()][0]!;
  assert.deepEqual(player.deviceProfile, { device: 'phone', input: 'touch' });
  await page.keyboard.press('ArrowLeft'); await wait(() => player.deviceProfile.input === 'keyboard');
  assert.equal(player.deviceProfile.device, 'phone');
  // Closing the server's client socket models a dropped LAN connection. The same page must reconnect with keyboard use remembered.
  now += 6001; app.checkConnections(); assert.equal(player.connected, false);
  await wait(() => player.connected && player.deviceProfile.input === 'keyboard');
  assert.deepEqual(errors, []); console.log('LAN phone profile and keyboard override passed');
} finally { await browser.close(); await app.close(); }
