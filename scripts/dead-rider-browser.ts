import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';

// Isolated visual regression: real renderers, synthetic snapshots, no occupied rooms.
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw Error('No server');
const browserName = process.env.BROWSER ?? 'chrome';
const browser = browserName === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await mkdir('artifacts', { recursive: true });
  await page.addInitScript('window.__name = value => value');
  await page.goto(`http://127.0.0.1:${address.port}/?room=INVALID`);
  await page.getByText('Invalid room code', { exact: true }).waitFor();
  for (const mode of ['webgl', 'phaser-canvas', 'canvas'] as const) {
    const results = await page.evaluate(async mode => {
      const { createPhaserArena } = await import(String('/src/client/phaser/arena.ts')) as typeof import('../src/client/phaser/arena.js');
      const { visualFixture } = await import(String('/src/client/phaser/benchmark-fixture.ts')) as typeof import('../src/client/phaser/benchmark-fixture.js');
      const { drawArena } = await import(String('/src/client/main.ts')) as typeof import('../src/client/main.js');
      const { themes } = await import(String('/src/client/themes.ts')) as typeof import('../src/client/themes.js');
      document.body.replaceChildren(); document.body.style.cssText = 'margin:0;background:#020715';
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
      document.body.append(canvas);
      const arena = mode === 'canvas' ? undefined : createPhaserArena(canvas, { renderer: mode === 'webgl' ? 'auto' : 'canvas', resolution: 'world' });
      if (arena) await arena.ready;
      if (mode === 'webgl' && arena!.metrics().renderer !== 'webgl') throw Error('WebGL did not start');
      const ctx = arena ? null : canvas.getContext('2d')!;
      const fixture = visualFixture(100);
      const base = { ...fixture, players: [], bombs: [], blasts: [], pickups: [], portalPairs: [], gravityFields: [] };
      const player = { ...fixture.players[0]!, color: '#22d3ee', x: 800, y: 450, shielded: true,
        drunkUntilTick: 200, invulnerableUntilTick: 200, portalGraceUntilTick: 200,
        trail: [{ x1: 200, y1: 200, x2: 600, y2: 200, createdTick: 80, expiresAtTick: 200 }] };
      const read = (): Uint8Array => {
        const gl = mode === 'webgl' ? canvas.getContext('webgl') : null;
        if (!gl) return new Uint8Array(canvas.getContext('2d')!.getImageData(0, 0, 1600, 900).data);
        const pixels = new Uint8Array(1600 * 900 * 4);
        gl.readPixels(0, 0, 1600, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const regionDifference = (a: Uint8Array, b: Uint8Array, x: number, y: number, width: number, height: number) => {
        let difference = 0;
        for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
          const offset = ((mode === 'webgl' ? 899 - row : row) * 1600 + col) * 4;
          for (let channel = 0; channel < 3; channel++) difference += Math.abs(a[offset + channel]! - b[offset + channel]!);
        }
        return difference;
      };
      const results = [];
      for (const theme of ['neon-pixel', 'clean-neon'] as const) {
        const paint = (players: typeof player[], tick = 100) => {
          const snapshot = { ...base, tick, players };
          if (arena) arena.render(snapshot, 1000, themes[theme], 'dead-rider-browser');
          else drawArena(ctx!, snapshot, 1000, themes[theme], {});
          return read();
        };
        arena?.reset();
        const empty = paint([]);
        const alive = paint([player]);
        const livingTrail = regionDifference(alive, empty, 250, 198, 300, 4);
        if (livingTrail <= 0) throw Error('Live trail missing');
        if (regionDifference(alive, empty, 750, 395, 100, 110) === 0) throw Error('Live avatar missing');
        const dead = { ...player, alive: false };
        paint([dead]);
        if (arena && arena.metrics().particles === 0) throw Error('Death burst missing');
        // Remove the transient sparks so we can inspect the pooled avatar and its overlays underneath.
        arena?.reset();
        const crashed = paint([dead]);
        if (regionDifference(crashed, empty, 750, 395, 100, 110) !== 0) throw Error('Dead rider obscures crash');
        const deadRatio = regionDifference(crashed, empty, 250, 198, 300, 4) / livingTrail;
        if (deadRatio < .7) throw Error(`Dead trail too faint: ${deadRatio}`);
        // Clone the trail to exercise the Canvas age batches with one hittable tick remaining.
        const nearExpiry = paint([{ ...dead, trail: structuredClone(dead.trail) }], 199);
        const expiryRatio = regionDifference(nearExpiry, empty, 250, 198, 300, 4) / livingTrail;
        if (expiryRatio < .6) throw Error(`Hittable trail too faint near expiry: ${expiryRatio}`);
        const removed = paint([{ ...dead, trail: [] }], 200);
        if (regionDifference(removed, empty, 250, 198, 300, 4) !== 0) throw Error('Removed trail remains visible');
        const revived = paint([player]);
        if (regionDifference(revived, empty, 750, 395, 100, 110) === 0) throw Error('Live avatar did not return');
        results.push({ theme, deadRatio, expiryRatio });
        paint([dead]); arena?.reset(); paint([dead]);
      }
      Reflect.set(window, 'disposeDeadRiderCheck', () => { arena?.destroy(); canvas.remove(); });
      return results;
    }, mode);
    await page.screenshot({ path: `artifacts/dead-rider-${mode}-${browserName}.png` });
    await page.evaluate(() => { (Reflect.get(window, 'disposeDeadRiderCheck') as () => void)(); });
    console.log(JSON.stringify({ mode, results }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close(); await server.close();
}
