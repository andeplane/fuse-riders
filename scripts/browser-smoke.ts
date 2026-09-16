import { powerBlastRadius } from '../src/shared/power-progression.js';
import { chromium, webkit, type Page } from 'playwright';
import { POWERUP_GUIDE } from '../src/client/powerup-guide.js';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGameServer } from '../src/server/index.js';
import { eliminatePlayer } from '../src/shared/game.js';
import { smokeTimeout } from './smoke-timeout.js';

const app = await createGameServer({
  port: 0,
  hostname: '127.0.0.1',
  lanAddress: '127.0.0.1',
  manualTicks: true,
  buildDirectory: process.env.BUILD_DIRECTORY,
});
// This smoke serves the built bundle, so an unbuilt edit silently tests the previous one. Say so rather than lying quietly.
const newest = (directory: string): number => readdirSync(directory, { withFileTypes: true, recursive: true })
  .filter(item => item.isFile()).map(item => statSync(join(item.parentPath ?? directory, item.name)).mtimeMs)
  .reduce((latest, at) => Math.max(latest, at), 0);
if (newest('src') > newest('dist')) console.warn('WARNING: dist is older than src — run `npx vite build` or this smoke tests the previous bundle.');

const browser = process.env.BROWSER === 'webkit'
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
// Every page this smoke drives goes through here, so it is also where the one deadline they all
// otherwise inherit — Playwright's 30s default — gets scaled for a loaded runner.
const monitor = (page: Page) => { page.setDefaultTimeout(smokeTimeout(30000)); page.on('pageerror', e => errors.push(e.stack ?? e.message)); };
const origin = `http://127.0.0.1:${app.port}`;
const waitFor = async (predicate: () => boolean, detail: string) => {
  const until = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > until) throw new Error(`Timeout: ${detail}`); await new Promise(r => setTimeout(r, 20)); }
};
try {
  await mkdir('artifacts', { recursive: true });
  const host = await browser.newPage({ viewport: { width: 1600, height: 960 } }); monitor(host);
  let hostSnapshotTick = -1;
  host.on('websocket', socket => socket.on('framereceived', frame => {
    const message: { type?: string; tick?: number } = JSON.parse(frame.payload.toString());
    if (message.type === 'snapshot' && typeof message.tick === 'number') hostSnapshotTick = message.tick;
  }));
  const advanceDelivered = async (count: number) => {
    // Manual ticks must let the real socket drain. Several synchronous rounds can
    // exceed the server's bounded send queue and discard the final UI snapshot.
    for (let remaining = count; remaining > 0; remaining -= 2) {
      app.advance(Math.min(2, remaining));
      const tick = app.game.tick;
      await waitFor(() => hostSnapshotTick >= tick, `host snapshot delivery at tick ${tick}`);
    }
  };
  await host.addInitScript(() => {
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = create.call(this); const start = oscillator.start.bind(oscillator);
      oscillator.start = (when?: number) => {
        document.documentElement.dataset.audioStarts = String(Number(document.documentElement.dataset.audioStarts ?? 0) + 1);
        start(when);
      };
      return oscillator;
    };
  });
  await host.goto(`${origin}/display#${app.hostToken}`);
  await host.getByText('HOST ONLINE', { exact: true }).waitFor();
  assert.equal(new URL(host.url()).hash, '', 'host fragment removed from URL');
  await host.locator('.qr').waitFor();
  // Audio enables itself on the first gesture now, so opening the panel is enough; the enable button
  // stays as the fallback for a browser that refused, and says so once audio is running either way.
  await host.locator('.audio-controls summary').click();
  await host.getByRole('button', { name: 'TV audio enabled · test sound', exact: true }).waitFor();
  // Music streams through a media element rather than a decoded buffer, so a phone's silent switch and
  // volume keys reach it. Playing means an element with a source that is not paused.
  const PLAYING = "(() => { const e = document.querySelector('audio.game-music'); return Boolean(e && e.currentSrc && !e.paused); })()";
  await host.waitForFunction(PLAYING, undefined, { timeout: smokeTimeout(15000) }); // Lobby music started.
  await host.getByRole('button', { name: 'Mute music', exact: true }).click();
  assert.equal(await host.getByRole('button', { name: 'Mute music', exact: true }).getAttribute('aria-pressed'), 'true');
  // Silent music must stop streaming rather than play on at zero volume, then resume where it stopped.
  await host.waitForFunction("document.querySelector('audio.game-music').paused === true");
  await host.getByRole('button', { name: 'Mute music', exact: true }).click();
  await host.waitForFunction(PLAYING);
  await host.getByLabel('Effects volume', { exact: true }).fill('20');
  await host.locator('.audio-controls summary').click();
  // The TV legend is icon + name only — it is read from across a room, and uniform one-line rows keep its height a
  // function of the pickup count rather than of how someone's description happens to wrap. Descriptions still render
  // on the landing page, where home-mobile-smoke pins one. Comparing the whole rendered list against its source also
  // proves star stays out (room settings alone enable it) and that no retired name creeps back in.
  await host.locator('.pickup-legend li').first().waitFor();
  const legendNames = await host.locator('.pickup-legend li b').allTextContents();
  assert.deepEqual(legendNames, POWERUP_GUIDE.filter(entry => entry.spawnsByDefault).map(entry => entry.name),
    'TV legend lists every default-spawning pickup, in order, and nothing else');
  // Anchored on real copy so the comparison above cannot pass vacuously on an empty or corrupted guide.
  assert.ok(legendNames.includes('POWER') && !legendNames.includes('STAR'), `legend copy looks wrong: ${legendNames.join(', ')}`);
  assert.ok((await host.locator('.pickup-legend img').first().getAttribute('src'))?.includes('/themes/neon-pixel/pickup-power.svg'));
  // Switching the style must re-src every legend icon, not just the ones that existed when the
  // theme plumbing was written. Ends on the default so later steps shoot the usual artwork.
  // The count is what stops the theme loop below passing vacuously on an empty or truncated list; what each icon says is pinned above.
  const defaultPickups = POWERUP_GUIDE.filter(entry => entry.spawnsByDefault).length;
  for (const themeId of ['clean-neon', 'neon-pixel']) {
    await host.getByRole('combobox').selectOption(themeId);
    const legendSources = await host.locator('.pickup-legend img').evaluateAll(images => images.map(image => image.getAttribute('src') ?? ''));
    assert.equal(legendSources.length, defaultPickups, `legend icons found: ${legendSources.length}, expected ${defaultPickups}`);
    for (const source of legendSources) assert.ok(source.includes(`/themes/${themeId}/`), `legend icon ${source} ignores theme ${themeId}`);
  }

  // A fresh token delivered as a hash-only navigation must be consumed and re-authenticated.
  const recoveredHost = await browser.newPage({ viewport: { width: 1200, height: 800 } }); monitor(recoveredHost);
  await recoveredHost.goto(`${origin}/display#${'0'.repeat(64)}`);
  await recoveredHost.getByText('Host link expired — open the newest TV link to enable Start race.', { exact: true }).waitFor();
  assert.equal(await recoveredHost.getByRole('button', { name: 'START RACE', exact: true }).isEnabled(), false);
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
    assert.equal(await phone.locator('.join-screen .avatar-option').count(), 10);
    const avatarLabels = ['Robot', 'Cat', 'Fox', 'Alien', 'Astronaut'];
    await phone.getByRole('button', { name: avatarLabels[i], exact: true }).click();
    if (i === 0) {
      await phone.getByRole('button', { name: 'Dragon', exact: true }).click();
      await phone.reload();
      assert.equal(await phone.getByRole('button', { name: 'Dragon', exact: true }).getAttribute('aria-pressed'), 'true');
    }
    await phone.getByPlaceholder('Rider name').fill(['Ada', 'Bo', 'Cy', 'Dee', 'Eli'][i]);
    await phone.getByRole('button', { name: 'JOIN THE GRID' }).click();
    await waitFor(() => [...app.game.players.values()].some(player => player.name === ['Ada', 'Bo', 'Cy', 'Dee', 'Eli'][i] && player.avatarId === ['dragon', 'cat', 'fox', 'alien', 'astronaut'][i]), 'chosen avatar reaches server');
    await phone.locator('.controls:not(.hidden)').waitFor(); app.advance(2);
  }
  await phones[0].getByText('◆ 0', { exact: true }).waitFor();
  await phones[0].getByText('STAR · --', { exact: true }).waitFor();
  await phones[0].getByText('PTS · 0', { exact: true }).waitFor();
  await waitFor(() => app.game.players.size === 5, 'five controller seats');
  const controllerColors: string[] = [];
  for (let i = 0; i < phones.length; i++) {
    const color = await phones[i]!.locator('.controller-shell').evaluate(el => (el as HTMLElement).style.getPropertyValue('--player-color'));
    assert.equal(color, [...app.game.players.values()].find(player => player.slot === i)!.color);
    controllerColors.push(await phones[i]!.locator('[data-control=left]').evaluate(el => getComputedStyle(el).backgroundImage));
  }
  assert.equal(new Set(controllerColors).size, 5, 'each phone has its own rider-colored controls');
  const startBounds = (await host.getByRole('button', { name: 'START RACE', exact: true }).boundingBox())!;
  assert.ok(startBounds.y >= 0 && startBounds.y + startBounds.height <= 960, 'start button fits the TV viewport');
  await host.mouse.move(startBounds.x + startBounds.width / 2, startBounds.y + startBounds.height / 2);
  await host.mouse.down();
  app.advance(2); await new Promise(r => setTimeout(r, 120));
  await host.mouse.up();
  await waitFor(() => app.game.phase === 'countdown', 'start countdown');
  app.advance(60);
  await phones[0].getByRole('button', { name: 'Drop bomb' }).waitFor({ state: 'visible' });
  await waitFor(() => app.game.phase === 'playing', 'playing');
  await phones[0].getByRole('button', { name: 'Change avatar', exact: true }).click();
  await phones[0].getByRole('button', { name: 'Slime', exact: true }).click();
  await host.locator('.score-card .avatar-portrait[data-avatar-id=slime]').waitFor();
  await host.locator('.seat-marker .avatar-portrait[data-avatar-id=slime]').waitFor({ state: 'attached' });
  await waitFor(() => [...app.game.players.values()].find(p => p.slot === 0)!.avatarId === 'slime', 'live avatar selection reaches TV state');
  assert.equal(String(app.game.phase), 'playing');
  await host.locator('.announcement.hidden').waitFor({ state: 'attached' });
  const slideLeft = await phones[0].getByRole('button', { name: 'Turn left' }).boundingBox();
  const slideRight = await phones[0].getByRole('button', { name: 'Turn right' }).boundingBox();
  assert.ok(slideLeft && slideRight);
  await phones[0].mouse.move(10, 10); await phones[0].mouse.down();
  await phones[0].mouse.move(slideLeft.x + slideLeft.width / 2, slideLeft.y + slideLeft.height / 2);
  await phones[0].locator('[data-control=left].active').waitFor();
  await phones[0].mouse.move(slideRight.x + slideRight.width / 2, slideRight.y + slideRight.height / 2);
  await phones[0].locator('[data-control=right].active').waitFor();
  assert.equal(await phones[0].locator('[data-control=left].active').count(), 0);
  await phones[0].mouse.move(10, 10); await phones[0].mouse.up();
  assert.equal(await phones[0].locator('.control-button.active').count(), 0);
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
  // Real browser capture cleanup: interrupted contact must never trap the next press.
  await left.evaluate(button => button.addEventListener('pointerdown', event => {
    (button as HTMLElement).dataset.lastPointer = String((event as PointerEvent).pointerId);
  }));
  for (const interruption of ['blur', 'lostpointercapture', 'pointercancel'] as const) {
    await phones[1].mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phones[1].mouse.down();
    await phones[1].mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2);
    assert.equal(await left.evaluate(button => button.classList.contains('active')), true);
    await left.evaluate((button, kind) => {
      const id = Number((button as HTMLElement).dataset.lastPointer);
      if (kind === 'blur') window.dispatchEvent(new Event('blur'));
      else if (kind === 'lostpointercapture') button.releasePointerCapture(id);
      else window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, bubbles: true }));
    }, interruption);
    // Pending lost-capture events are processed with the next pointer event.
    await phones[1].mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await left.locator('xpath=self::*[not(contains(@class, "active"))]').waitFor();
    await phones[1].mouse.up();
    await phones[1].mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phones[1].mouse.down();
    await phones[1].mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2);
    assert.equal(await left.evaluate(button => button.classList.contains('active')), true, `${interruption}: next press works`);
    await phones[1].mouse.up();
  }
  const poweredRider = [...app.game.players.values()].find((player) => player.slot === 0)!;
  poweredRider.powerPickups = 0;
  app.game.pickups.push({ id: 9_001, type: 'power', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('◆ 1', { exact: true }).waitFor();
  assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_001), false, 'power pickup consumed authoritatively');
  app.game.pickups.push({ id: 9_002, type: 'star', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText(/STAR · [0-9.]+s/).waitFor();
  assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_002), false, 'star pickup consumed authoritatively');
  app.game.pickups.push({ id: 9_003, type: 'beer', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[1].getByText(/WOBBLE · [0-9.]+s/).waitFor();
  assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_003), false, 'beer pickup consumed authoritatively');
  assert.equal(poweredRider.drunkUntilTick, 0, 'beer collector is immune to own pickup');
  app.game.pickups.push({ id: 9_020, type: 'ink', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[1].getByText(/INK · [0-9.]+s/).waitFor();
  assert.equal(poweredRider.inkUntilTick, 0, 'ink collector is unaffected');
  assert.equal(app.game.matchStats.get(poweredRider.id)!.inkPickups, 1);
  await host.screenshot({ path: 'artifacts/ink-clouds.png' });
  app.game.pickups.push({ id: 9_040, type: 'extraBomb', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('◆ 1 · B×2', { exact: true }).waitFor();
  assert.equal(poweredRider.extraBombs, 1);
  app.game.pickups.push({ id: 9_004, type: 'triple', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('TRIPLE · ARMED', { exact: true }).waitFor();
  assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_004), false, 'triple pickup consumed authoritatively');
  app.game.pickups.push({ id: 9_008, type: 'five', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('FIVE · ARMED', { exact: true }).waitFor();
  app.game.pickups.push({ id: 9_030, type: 'target', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('TARGET · ARMED', { exact: true }).waitFor();
  const targetButton = phones[0].getByRole('button', { name: 'Drop bomb' });
  const targetBox = (await targetButton.boundingBox())!;
  const tx = targetBox.x + targetBox.width / 2; const ty = targetBox.y + targetBox.height / 2;
  await phones[0].mouse.move(tx, ty); await phones[0].mouse.down();
  await new Promise(r => setTimeout(r, 60)); app.advance(1);
  const initialTarget = { ...poweredRider.bombTarget! };
  await phones[0].mouse.move(tx + 64, ty + 36);
  await new Promise(r => setTimeout(r, 60)); app.advance(1);
  assert.ok(poweredRider.bombTarget!.x > initialTarget.x + 250, 'drag moves the authoritative TV target');
  const finalTarget = { ...poweredRider.bombTarget! };
  await host.screenshot({ path: 'artifacts/target-aim.png' });
  await phones[0].mouse.up(); await new Promise(r => setTimeout(r, 50)); app.advance(1);
  const targetBlast = app.game.blasts.at(-1)!;
  assert.equal(app.game.bombs.size, 0); assert.equal(targetBlast.circle.x, finalTarget.x); assert.equal(targetBlast.circle.y, finalTarget.y);
  assert.equal(targetBlast.circle.radius, powerBlastRadius(poweredRider.powerPickups) * .7);
  assert.equal(poweredRider.targetBombArmed, false); assert.equal(poweredRider.fiveShotArmed, true);
  app.game.bombs.clear(); poweredRider.bombReadyAtTick = app.game.tick; app.advance(2);
  await phones[0].screenshot({ path: 'artifacts/phone-armed-portrait.png' });
  // The controller shows `launching` for only 280 ms after its bombPlaced event, so a polling visibility wait on a
  // loaded runner can miss that whole window however long its deadline is (#124). Record the class being added instead.
  await phones[0].evaluate(() => {
    const seen = { launched: false }; Reflect.set(window, '__launchSeen', seen);
    // Only a change that starts without `launching` counts, so a leftover flash plus an unrelated class change cannot pass.
    const observer = new MutationObserver(records => { if (records.some(record => !(record.oldValue ?? '').split(/\s+/).includes('launching') && (record.target as Element).classList.contains('launching'))) seen.launched = true; });
    for (const bomb of document.querySelectorAll('.bomb')) observer.observe(bomb, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  });
  await phones[0].getByRole('button', { name: 'Drop bomb' }).tap();
  await new Promise(r => setTimeout(r, 50)); app.advance(2); assert.equal(app.game.bombs.size, 6, 'Five overrides Triple and stacks with Extra Bomb');
  await phones[0].waitForFunction(() => (Reflect.get(window, '__launchSeen') as { launched: boolean }).launched, undefined, { timeout: smokeTimeout(10_000) });
  app.game.bombs.clear(); poweredRider.bombReadyAtTick = app.game.tick;
  app.game.pickups.push({ id: 9_009, type: 'shell', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2);
  await phones[0].getByText('GREEN SHELL · HOLD + RELEASE', { exact: true }).waitFor();
  await phones[0].getByRole('button', { name: 'Drop bomb' }).tap();
  await new Promise(r => setTimeout(r, 50)); app.advance(2);
  assert.equal(app.game.bombs.size, 1); assert.ok([...app.game.bombs.values()][0]!.shell);
  await host.screenshot({ path: 'artifacts/green-shell.png' });
  app.game.bombs.clear();
  poweredRider.bombReadyAtTick = app.game.tick;
  app.game.pickups.push({ id: 9_010, type: 'gun', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('GUN · HOLD + RELEASE', { exact: true }).waitFor();
  await phones[0].getByRole('button', { name: 'Drop bomb' }).tap();
  await new Promise(r => setTimeout(r, 50)); app.advance(1);
  assert.equal(app.game.bombs.size, 1); assert.equal([...app.game.bombs.values()][0]!.shell?.gun, true);
  app.advance(4); // Let the projectile separate from the rider for visual inspection.
  await host.screenshot({ path: 'artifacts/gun-projectile.png' }); app.game.bombs.clear();
  app.game.pickups.push({ id: 9_011, type: 'power', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('◆ 2 · B×2', { exact: true }).waitFor();
  assert.equal(poweredRider.powerPickups, 2);
  app.game.pickups.push({ id: 9_006, type: 'orbitShield', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); await phones[0].getByText('SHIELD · READY', { exact: true }).waitFor();
  assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_006), false, 'shield pickup consumed authoritatively');
  app.game.pickups.push({ id: 9_007, type: 'portal', x: poweredRider.x, y: poweredRider.y, expiresAtTick: app.game.tick + 100 });
  app.advance(2); assert.equal(app.game.pickups.some((pickup) => pickup.id === 9_007), false, 'portal pickup consumed authoritatively');
  assert.equal(app.game.portalPairs.length, 1, 'portal pickup opens an authoritative gate pair');
  // Placement was exercised above. Isolate transit from the random board left by
  // earlier weapons: a valid pair can correctly refuse an obstructed linked exit.
  app.game.bombs.clear(); app.game.blasts = [];
  for (const player of app.game.players.values()) {
    player.trail = [];
    if (player !== poweredRider) { player.x = app.game.width / 2; player.y = 80 + player.slot * 35; player.angle = 0; }
  }
  app.game.portalPairs[0]!.gates = [
    { x: app.game.width * .3, y: app.game.height / 2, halfLength: 100 },
    { x: app.game.width * .7, y: app.game.height / 2, halfLength: 100 },
  ];
  const entryGate = app.game.portalPairs[0]!.gates[0];
  poweredRider.x = entryGate.x + 15; poweredRider.y = entryGate.y;
  poweredRider.angle = Math.PI; poweredRider.portalCooldownUntilTick = 0; poweredRider.portalGraceUntilTick = 0;
  assert.equal(poweredRider.alive, true, 'transit fixture rider remains alive');
  app.advance(2);
  assert.ok(poweredRider.portalCooldownUntilTick > app.game.tick, 'gate transit starts authoritative cooldown');
  assert.ok(poweredRider.portalGraceUntilTick > app.game.tick, 'gate transit starts authoritative phase grace');
  assert.ok(poweredRider.x > app.game.width / 2, 'rider arrives at linked gate');
  await phones[0].getByText(/PORTAL · PHASE [0-9.]+s/).waitFor();
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
  assert.equal(await host.getByRole('button', { name: 'Fullscreen', exact: true }).isVisible(), true, 'fullscreen stays visible during a match');
  assert.equal(await host.getByRole('button', { name: 'Fullscreen', exact: true }).isEnabled(), true);
  await host.screenshot({ path: 'artifacts/tv-playing.png' });
  // Refresh reclaims exactly the same seat and updates full state.
  const previousIds = [...app.game.players.keys()]; await phones[0].reload();
  await phones[0].locator('.controls:not(.hidden)').waitFor(); assert.deepEqual([...app.game.players.keys()], previousIds);
  // Exercise complete first-to-three / automatic round restart / host rematch UI.
  const winner = previousIds[0];
  for (let round = 0; round < 3 && app.game.phase !== 'matchOver'; round++) {
    // Earlier weapon/portal exercises may already have ended round one. Finish its
    // authoritative pause (including any replay) before starting the next round.
    if (app.game.phase === 'roundOver') await advanceDelivered(app.game.phaseEndsAtTick! - app.game.tick);
    if (app.game.phase === 'countdown') await advanceDelivered(app.game.phaseEndsAtTick! - app.game.tick);
    assert.equal(String(app.game.phase), 'playing', 'the next round reaches active play');
    for (const id of previousIds) if (id !== winner) eliminatePlayer(app.game, id);
    await advanceDelivered(2);
  }
  assert.equal(app.game.phase, 'matchOver');
  await host.getByText('FINAL ROUND', { exact: true }).waitFor();
  assert.equal(await host.locator('.match-recap:not(.hidden)').count(), 0);
  await advanceDelivered(app.game.phaseEndsAtTick! - app.game.tick);
  await host.getByRole('button', { name: 'REMATCH' }).waitFor();
  await host.locator('.match-recap:not(.hidden)').waitFor();
  assert.equal(await host.locator('.comparison-row:not(.comparison-header)').count(), 5);
  await host.getByText('TRAILBLAZER', { exact: true }).waitFor();
  await host.getByText('UNTOUCHABLE', { exact: true }).waitFor();
  await host.screenshot({ path: 'artifacts/tv-match-over.png' });
  await host.getByRole('button', { name: '🏆 SESSION' }).click();
  await host.locator('.leaderboard-drawer:not(.hidden)').waitFor();
  await host.getByText('15 PTS', { exact: true }).waitFor();
  await host.getByText('ROUND POINTS // 5 · 3 · 2 · 1 · 0', { exact: false }).waitFor();
  await phones[0].getByText(/#1 · \+5 · 15PTS/).waitFor();
  await host.getByRole('button', { name: 'Close leaderboard' }).click();
  const matchId = app.game.matchId; await host.getByRole('button', { name: 'REMATCH' }).click();
  await waitFor(() => app.game.matchId !== matchId, 'new match scope'); app.advance(2);
  assert.equal(app.game.phase, 'countdown'); assert.ok([...app.game.players.values()].every(p => p.roundWins === 0));
  await host.getByRole('button', { name: 'Main menu', exact: true }).click();
  await waitFor(() => app.game.phase === 'lobby', 'return to main menu');
  await host.getByRole('button', { name: 'START RACE', exact: true }).waitFor();
  assert.deepEqual([...app.game.players.keys()], previousIds, 'menu preserves connected phone identities');
  await host.getByRole('button', { name: 'START RACE', exact: true }).click();
  await waitFor(() => app.game.phase === 'countdown', 'start again after menu');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Browser smoke passed: host token recovery, pickups, leaderboard, TV, five phones, controls, themes, reconnect and rematch.');
} finally { await browser.close(); await app.close(); }
