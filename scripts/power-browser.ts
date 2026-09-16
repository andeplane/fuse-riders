import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Exercise real renderers with isolated snapshots; never modify an occupied room.
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw Error('No server');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await mkdir('artifacts', { recursive: true });
  await page.addInitScript('window.__name = value => value');
  await page.goto(`http://127.0.0.1:${address.port}/?room=INVALID`);
  await page.getByText('Invalid room code', { exact: true }).waitFor();
  for (const mode of ['webgl', 'canvas'] as const) {
    const result = await page.evaluate(async mode => {
      const { createPhaserArena } = await import(String('/src/client/phaser/arena.ts')) as typeof import('../src/client/phaser/arena.js');
      const { visualFixture } = await import(String('/src/client/phaser/benchmark-fixture.ts')) as typeof import('../src/client/phaser/benchmark-fixture.js');
      const { drawArena } = await import(String('/src/client/main.ts')) as typeof import('../src/client/main.js');
      const { themes } = await import(String('/src/client/themes.ts')) as typeof import('../src/client/themes.js');
      document.body.replaceChildren(); document.body.style.cssText = 'margin:0;background:#020715';
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
      document.body.append(canvas);
      const arena = mode === 'canvas' ? undefined : createPhaserArena(canvas, { resolution: 'world' });
      if (arena) await arena.ready;
      if (arena && arena.metrics().renderer !== 'webgl') throw Error('WebGL did not start');
      await document.fonts.ready;
      const fixture = visualFixture(100);
      const players = fixture.players.slice(0, 3).map((p, i) => ({ ...p, name: ['ADA', 'BO', 'CY'][i]!,
        x: 400 + 400 * i, y: 450, color: ['#22d3ee', '#ff55bb', '#77ff66'][i]!, powerPickups: [0, 1, 12][i]!,
        alive: true, trail: [], shielded: false, drunkUntilTick: 0, invulnerableUntilTick: 0,
        portalGraceUntilTick: 0, shieldGraceUntilTick: 0, inkUntilTick: 0, bombChargeStartedTick: undefined,
        bombReadyAtTick: 130, reloadDurationTicks: 80 }));
      const snapshot = { ...fixture, players, bombs: [], blasts: [], pickups: [], portalPairs: [], gravityFields: [] };
      const read = () => {
        const gl = mode === 'webgl' ? canvas.getContext('webgl') : null;
        if (!gl) return new Uint8Array(canvas.getContext('2d')!.getImageData(0, 0, 1600, 900).data);
        const pixels = new Uint8Array(1600 * 900 * 4);
        gl.readPixels(0, 0, 1600, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const paint = () => {
        if (arena) arena.render(snapshot, 1000, themes['neon-pixel'], 'power-browser');
        else drawArena(canvas.getContext('2d')!, snapshot, 1000, themes['neon-pixel'], {});
        return read();
      };
      const offset = (x: number, y: number) => ((mode === 'webgl' ? 899 - y : y) * 1600 + x) * 4;
      const before = paint();
      const samples = players.map(p => {
        let gold = 0, identity = 0;
        const rgb = [1, 3, 5].map(start => parseInt(p.color.slice(start, start + 2), 16));
        for (let y = 410; y < 435; y++) for (let x = p.x - 130; x < p.x + 130; x++) {
          const o = offset(x, y);
          if (before[o]! > 240 && before[o + 1]! > 200 && before[o + 2]! < 110) gold++;
          if (rgb.every((v, channel) => Math.abs(before[o + channel]! - v) < 15)) identity++;
        }
        if (gold < 5 || identity < 5) throw Error(`Missing gold count or identity color: ${p.name}, ${gold}, ${identity}`);
        return { name: p.name, count: p.powerPickups, gold, identity };
      });
      players[0]!.powerPickups = 1;
      const after = paint();
      let labelChanges = 0, avatarChanges = 0;
      for (let y = 410; y < 480; y++) for (let x = 270; x < 530; x++) {
        const o = offset(x, y);
        const changed = [0, 1, 2].some(channel => before[o + channel] !== after[o + channel]);
        if (changed && y < 435) labelChanges++;
        if (changed && y >= 435) avatarChanges++;
      }
      if (labelChanges === 0) throw Error('First pickup did not update the visible count');
      if (avatarChanges !== 0) throw Error('Pickup changed the avatar/reload area: progress ring must be absent');
      players[0]!.powerPickups = 0; paint();
      Reflect.set(window, 'disposePowerCheck', () => { arena?.destroy(); canvas.remove(); });
      return { samples, labelChanges, avatarChanges };
    }, mode);
    await page.screenshot({ path: `artifacts/power-count-${mode}.png` });
    await page.evaluate(() => { (Reflect.get(window, 'disposePowerCheck') as () => void)(); });
    console.log(JSON.stringify({ mode, ...result }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close(); await server.close();
}
