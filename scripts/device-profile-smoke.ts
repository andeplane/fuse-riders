import { chromium, webkit, devices, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Dedicated local room; never runs against an existing match. Real mobile user agents matter for device detection.
const browserName = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
const browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true });
const base = process.env.ONLINE_URL ?? 'http://127.0.0.1:8793/';
const errors: string[] = [];
const watch = (page: Page) => page.on('pageerror', error => errors.push(error.message));
const join = async (page: Page, name: string) => {
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByRole('button', { name: 'JOIN AS PLAYER', exact: true }).click();
};
const target = (page: Page) => page.locator('label').filter({ hasText: /^Target bomb/ }).locator('input');
const waitProfile = (page: Page, name: string, input: string) => page.waitForFunction(({ name, input }) =>
  [...document.querySelectorAll<HTMLElement>('.online-score-card')].some(row => row.textContent?.includes(name) && row.dataset.device === 'phone' && row.dataset.input === input), { name, input });
try {
  const phone = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
  const host = await phone.newPage(); watch(host); await host.goto(base);
  await host.getByRole('button', { name: 'CREATE ROOM', exact: true }).click(); await host.waitForURL(/room=/);
  const url = host.url(); await join(host, 'HostPhone'); await waitProfile(host, 'HostPhone', 'touch');
  const guestContext = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
  const guest = await guestContext.newPage(); watch(guest); await guest.goto(url); await join(guest, 'GuestPhone');
  await waitProfile(host, 'GuestPhone', 'touch');
  const tvContext = await browser.newContext(); const tv = await tvContext.newPage(); watch(tv); await tv.goto(`${url}&display=1`);
  await waitProfile(tv, 'GuestPhone', 'touch');
  await host.getByRole('button', { name: 'ADD AI', exact: true }).click();
  await host.getByRole('button', { name: 'ROOM SETTINGS', exact: true }).click();
  await host.getByRole('button', { name: 'CONFIGURE POWERUPS', exact: true }).click();
  assert.equal(await target(host).isEnabled(), true, 'AI and desktop TV do not disable phone-only drops');
  const savedWeight = await target(host).inputValue();
  const desktopContext = await browser.newContext(); const desktop = await desktopContext.newPage(); watch(desktop);
  await desktop.goto(url); await join(desktop, 'Keyboard');
  await target(host).waitFor(); await host.waitForFunction(() => [...document.querySelectorAll('label')].find(label => label.textContent?.startsWith('Target bomb'))?.querySelector('input')?.disabled);
  assert.equal(await target(host).inputValue(), savedWeight, 'disabled weight is preserved');
  assert.ok((await host.locator('.game-dialog').innerText()).includes('every human rider'));
  await desktopContext.close();
  await host.waitForFunction(() => [...document.querySelectorAll('label')].find(label => label.textContent?.startsWith('Target bomb'))?.querySelector('input')?.disabled === false);
  await host.getByRole('button', { name: 'SAVE SETTINGS', exact: true }).click();
  await host.getByRole('button', { name: 'START RACE', exact: true }).click();
  await guest.locator('.mobile-play').waitFor(); await guest.keyboard.press('ArrowLeft');
  await waitProfile(host, 'GuestPhone', 'keyboard'); await waitProfile(tv, 'GuestPhone', 'keyboard');
  await guest.reload(); await waitProfile(host, 'GuestPhone', 'touch');
  await host.getByRole('button', { name: '☰ MENU', exact: true }).click();
  await host.getByRole('button', { name: 'ROOM SETTINGS', exact: true }).click();
  await host.getByRole('button', { name: 'CONFIGURE POWERUPS', exact: true }).click();
  assert.equal(await target(host).isEnabled(), true);
  await mkdir('artifacts', { recursive: true }); await host.screenshot({ path: `artifacts/device-profile-${browserName}.png` });
  assert.deepEqual(errors, []); console.log(`${browserName}: phone profiles, mixed-room gate, live settings, AI/TV exclusion, keyboard override and refresh passed`);
} finally { await browser.close(); }
