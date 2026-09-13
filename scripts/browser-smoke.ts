import { chromium, webkit, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createGameServer } from '../src/server/index.js';
import { eliminatePlayer } from '../src/shared/game.js';

const app = await createGameServer({
  port: 0,
  hostname: '127.0.0.1',
  lanAddress: '127.0.0.1',
  manualTicks: true,
  buildDirectory: process.env.BUILD_DIRECTORY,
});
const browser = process.env.BROWSER === 'webkit'
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
const monitor = (page: Page) => { page.on('pageerror', e => errors.push(e.message)); };
const origin = `http://127.0.0.1:${app.port}`;
const waitFor = async (predicate: () => boolean, detail: string) => {
  const until = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > until) throw new Error(`Timeout: ${detail}`); await new Promise(r => setTimeout(r, 20)); }
};
try {
  await mkdir('artifacts', { recursive: true });
  const host = await browser.newPage({ viewport: { width: 1600, height: 960 } }); monitor(host);
  await host.goto(`${origin}/display#${app.hostToken}`);
  await host.getByText('HOST ONLINE', { exact: true }).waitFor();
  assert.equal(new URL(host.url()).hash, '', 'host fragment removed from URL');
  await host.locator('.qr').waitFor();
  await host.getByText('longer explosions', { exact: false }).waitFor();
  await host.getByText('2.5s invulnerable', { exact: false }).waitFor();
  await host.getByText('rivals wobble for 4s', { exact: false }).waitFor();
  await host.getByText('next launch fires 3', { exact: false }).waitFor();
  assert.equal(await host.getByText('next launch seeks', { exact: false }).count(), 0, 'retired power-up is absent from legend');
  await host.getByText('blocks one crash', { exact: false }).waitFor();
  await host.getByText('opens linked gates', { exact: false }).waitFor();
  assert.ok((await host.locator('.pickup-legend img').first().getAttribute('src'))?.includes('/themes/neon-pixel/pickup-blast.svg'));

  // A fresh token delivered as a hash-only navigation must be consumed and re-authenticated.
  const recoveredHost = await browser.newPage({ viewport: { width: 1200, height: 800 } }); monitor(recoveredHost);
  await recoveredHost.goto(`${origin}/display#${'0'.repeat(64)}`);
  await recoveredHost.getByText('HOST LINK EXPIRED', { exact: true }).waitFor();
  await recoveredHost.evaluate((token) => { location.hash = token; }, app.hostToken);
  await recoveredHost.getByText('HOST ONLINE', { exact: true }).waitFor();
  assert.equal(new URL(recoveredHost.url()).hash, '', 'replacement host fragment removed from URL');
  await recoveredHost.close();
  await host.screenshot({ path: 'artifacts/tv-lobby.png' });
  const phones: Page[] = [];
  for (let i = 0; i < 5; i++) {
    const context = await browser.newContext({ viewport: i === 0 ? { width: 390, height: 844 } : { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const phone = await context.newPage(); monitor(phone); phones.push(phone);
    await phone.goto(`${origin}/controller`);
    await phone.getByPlaceholder('Rider name').fill(['Ada', 'Bo', 'Cy', 'Dee', 'Eli'][i]);
    await phone.getByRole('button', { name: 'JOIN THE GRID' }).click();
    await phone.locator('.controls:not(.hidden)').waitFor(); app.advance(2);
  }
  await phones[0].getByText('BLAST · BASE', { exact: true }).waitFor();
  await phones[0].getByText('STAR · --', { exact: true }).waitFor();
  await phones[0].getByText('PTS · 0', { exact: true }).waitFor();
  await waitFor(() => app.game.players.size === 5, 'five controller seats');
  await host.getByRole('button', { name: 'START RACE' }).click();
  await waitFor(() => app.game.phase === 'countdown', 'start countdown');
  app.advance(60);
  await phones[0].getByRole('button', { name: 'Drop bomb' }).waitFor({ state: 'visible' });
  await waitFor(() => app.game.phase === 'playing', 'playing');
  await host.locator('.announcement.hidden').waitFor({ state: 'attached' });
  await phones[0].screenshot({ path: 'artifacts/phone-portrait.png' });
  await phones[1].screenshot({ path: 'artifacts/phone-landscape.png' });
  for (const phone of phones) {
    assert.ok(await phone.getByRole('button', { name: 'Turn left' }).isVisible());
    assert.ok(await phone.getByRole('button', { name: 'Turn right' }).isVisible());
    const overflow = await phone.evaluate(() => ({ x: document.documentElement.scrollWidth > innerWidth, y: document.documentElement.scrollHeight > innerHeight }));
    assert.equal(overflow.x, false, 'phone no horizontal overflow'); assert.equal(overflow.y, false, 'phone no vertical scroll while controlling');
  }
  // Real DOM pointer handlers -> WebSocket -> authoritative simulation.
  const rider = [...app.game.players.values()][1]; const initialAngle = rider.angle;
  const left = phones[1].getByRole('button', { name: 'Turn left' });
  const box = (await left.boundingBox())!;
  await phones[1].mouse.move(box.x + box.width / 2, box.y + box.height / 2); await phones[1].mouse.down();
  await new Promise(r => setTimeout(r, 80)); app.advance(4);
  assert.notEqual(rider.angle, initialAngle, 'phone steers authoritative rider');
  await phones[1].mouse.up(); await new Promise(r => setTimeout(r, 50));
  const releasedAngle = rider.angle; app.advance(2); assert.equal(rider.angle, releasedAngle, 'pointer release neutralizes');
  const poweredRider = [...app.game.players.values()].find((player) => player.slot === 0)!;
  app.game.pickups.push({ id: 9_001, type: 'blast', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('BLAST · +1', { exact: true }).waitFor();
  assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_001), false, 'blast pickup consumed authoritatively');
  app.game.pickups.push({ id: 9_002, type: 'star', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText(/STAR · [0-9.]+s/).waitFor();
  assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_002), false, 'star pickup consumed authoritatively');
  app.game.pickups.push({ id: 9_003, type: 'beer', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[1].getByText(/WOBBLE · [0-9.]+s/).waitFor();
  assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_003), false, 'beer pickup consumed authoritatively');
  assert.equal(poweredRider.drunkUntilTick, 0, 'beer collector is immune to own pickup');
  app.game.pickups.push({ id: 9_004, type: 'triple', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('TRIPLE · ARMED', { exact: true }).waitFor();
  assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_004), false, 'triple pickup consumed authoritatively');
  await phones[0].screenshot({ path: 'artifacts/phone-armed-portrait.png' });
  await phones[0].getByRole('button', { name: 'Drop bomb' }).tap();
  await new Promise(r => setTimeout(r, 50)); app.advance(2); assert.equal(app.game.bombs.size, 3, 'Triple Shot release launches one three-bomb volley');
  await phones[0].locator('.bomb.launching').waitFor();
  app.game.pickups.push({ id: 9_006, type: 'orbitShield', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('SHIELD · READY', { exact: true }).waitFor();
  assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_006), false, 'shield pickup consumed authoritatively');
  app.game.pickups.push({ id: 9_007, type: 'portal', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_007), false, 'portal pickup consumed authoritatively');
  assert.ok(app.game.portalPair, 'portal pickup opens an authoritative gate pair');
  const entryGate = app.game.portalPair!.gates[0];
  const towardCenter = Math.atan2(app.game.height / 2 - entryGate.y, app.game.width / 2 - entryGate.x);
  poweredRider.x = entryGate.x + Math.cos(towardCenter) * 35;
  poweredRider.y = entryGate.y + Math.sin(towardCenter) * 35;
  poweredRider.angle = towardCenter + Math.PI; poweredRider.trail = [];
  app.advance(2); await phones[0].getByText(/PORTAL · PHASE [0-9.]+s/).waitFor();
  assert.ok(poweredRider.portalCooldownUntilTick > app.game.tick, 'gate transit starts authoritative cooldown');
  for (const phone of phones) {
    const overflow = await phone.evaluate(() => ({ x: document.documentElement.scrollWidth > innerWidth, y: document.documentElement.scrollHeight > innerHeight }));
    assert.equal(overflow.x, false, 'power-up phone has no horizontal overflow'); assert.equal(overflow.y, false, 'power-up phone has no vertical overflow');
  }
  await phones[0].screenshot({ path: 'artifacts/phone-powerups-portrait.png' });
  await phones[1].screenshot({ path: 'artifacts/phone-powerups-landscape.png' });
  // Exercise theme changes during active gameplay: styling has no simulation writes.
  const beforeTheme = JSON.stringify([...app.game.players.values()]);
  await host.getByRole('combobox').selectOption('clean-neon');
  assert.equal(JSON.stringify([...app.game.players.values()]), beforeTheme);
  await host.getByRole('combobox').selectOption('neon-pixel');
  app.advance(20); await new Promise(r => setTimeout(r, 150));
  await host.screenshot({ path: 'artifacts/tv-playing.png' });
  // Refresh reclaims exactly the same seat and updates full state.
  const previousIds = [...app.game.players.keys()]; await phones[0].reload();
  await phones[0].locator('.controls:not(.hidden)').waitFor(); assert.deepEqual([...app.game.players.keys()], previousIds);
  // Exercise complete first-to-five / automatic round restart / host rematch UI.
  const winner = previousIds[0];
  for (let round = 0; round < 5; round++) {
    if (app.game.phase === 'countdown') app.advance(60);
    for (const id of previousIds) if (id !== winner) eliminatePlayer(app.game, id);
    app.advance(2);
    if (app.game.phase !== 'matchOver') app.advance(60);
  }
  assert.equal(app.game.phase, 'matchOver');
  await host.getByRole('button', { name: 'REMATCH' }).waitFor();
  await host.locator('.match-recap:not(.hidden)').waitFor();
  assert.equal(await host.locator('.comparison-row:not(.comparison-header)').count(), 5);
  await host.getByText('TRAILBLAZER', { exact: true }).waitFor();
  await host.getByText('UNTOUCHABLE', { exact: true }).waitFor();
  await host.screenshot({ path: 'artifacts/tv-match-over.png' });
  await host.getByRole('button', { name: '🏆 SESSION' }).click();
  await host.locator('.leaderboard-drawer:not(.hidden)').waitFor();
  await host.getByText('25 PTS', { exact: true }).waitFor();
  await host.getByText('ROUND POINTS // 5 · 3 · 2 · 1 · 0', { exact: false }).waitFor();
  await phones[0].getByText(/#1 · \+5 · 25PTS/).waitFor();
  await host.getByRole('button', { name: 'Close leaderboard' }).click();
  const matchId = app.game.matchId; await host.getByRole('button', { name: 'REMATCH' }).click();
  await waitFor(() => app.game.matchId !== matchId, 'new match scope'); app.advance(2);
  assert.equal(app.game.phase, 'countdown'); assert.ok([...app.game.players.values()].every(p => p.roundWins === 0));
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Browser smoke passed: host token recovery, pickups, leaderboard, TV, five phones, controls, themes, reconnect and rematch.');
} finally { await browser.close(); await app.close(); }
