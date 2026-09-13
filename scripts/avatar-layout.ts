import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createGameServer } from '../src/server/index.ts';
const app = await createGameServer({ port: 0, hostname: '127.0.0.1', lanAddress: '127.0.0.1', manualTicks: true, buildDirectory: process.env.BUILD_DIRECTORY });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:${app.port}/controller`);
    await page.getByRole('button', { name: 'Slime', exact: true }).waitFor();
    const bounds = await page.getByRole('button', { name: 'JOIN THE GRID' }).boundingBox();
    assert.ok(bounds && bounds.y + bounds.height <= height, `join reachable at ${width}x${height}: ${JSON.stringify(bounds)}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: `artifacts/avatar-picker-${width}x${height}.png` });
  }
  console.log('Avatar picker fits 320x568,390x844,844x390; join reachable.');
} finally { await browser.close(); await app.close(); }
