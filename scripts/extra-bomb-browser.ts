import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Isolated visual fixture: exercises both renderers, both themes, +1 artwork, HUD and 2/4/13-bomb fans.
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
  for (const mode of ['webgl', 'canvas'] as const) for (const themeId of ['neon-pixel', 'clean-neon'] as const) {
    const result = await page.evaluate(async ({ mode, themeId }) => {
      const { createPhaserArena } = await import(String('/src/client/phaser/arena.ts')) as typeof import('../src/client/phaser/arena.js');
      const { visualFixture } = await import(String('/src/client/phaser/benchmark-fixture.ts')) as typeof import('../src/client/phaser/benchmark-fixture.js');
      const { drawArena } = await import(String('/src/client/main.ts')) as typeof import('../src/client/main.js');
      const { themes } = await import(String('/src/client/themes.ts')) as typeof import('../src/client/themes.js');
      document.body.replaceChildren(); document.body.style.cssText = 'margin:0;background:#020715';
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900; document.body.append(canvas);
      const arena = mode === 'webgl' ? createPhaserArena(canvas, { resolution: 'world' }) : undefined;
      if (arena) { await arena.ready; if (arena.metrics().renderer !== 'webgl') throw Error('WebGL unavailable'); }
      await document.fonts.ready;
      const fixture = visualFixture(100);
      const snapshot = { ...fixture, boundaryInset: 0, players: fixture.players.slice(0, 3).map((p, i) => ({ ...p,
        name: ['TWO', 'FOUR', 'MAX + FIVE'][i]!, x: 240 + i * 510, y: 450, angle: -Math.PI / 2,
        extraBombs: [1, 3, 8][i]!, fiveShotArmed: i === 2, powerPickups: 3,
        alive: true, trail: [], shielded: false, drunkUntilTick: 0, invulnerableUntilTick: 0,
        portalGraceUntilTick: 0, shieldGraceUntilTick: 0, inkUntilTick: 0,
        bombChargeStartedTick: 90, bombReadyAtTick: 0 })), bombs: [], blasts: [], portalPairs: [], gravityFields: [],
        pickups: [{ id: 1, type: 'extraBomb' as const, x: 800, y: 650, expiresAtTick: 200 }] };
      if (arena) arena.render(snapshot, 1000, themes[themeId], 'extra-bomb-browser');
      else drawArena(canvas.getContext('2d')!, snapshot, 1000, themes[themeId], {}, []);
      // First canvas paint starts its lazy image load; wait on that resource and paint again.
      const icon = new Image(); icon.src = `/themes/${themeId}/pickup-extraBomb.svg`; await icon.decode();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (arena) arena.render(snapshot, 1000, themes[themeId], 'extra-bomb-browser');
      else drawArena(canvas.getContext('2d')!, snapshot, 1000, themes[themeId], {}, []);
      const gl = mode === 'webgl' ? canvas.getContext('webgl') : null;
      const pixels = new Uint8Array(1600 * 900 * 4);
      if (gl) gl.readPixels(0, 0, 1600, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      else pixels.set(canvas.getContext('2d')!.getImageData(0, 0, 1600, 900).data);
      let badgePixels = 0;
      for (let y = 650; y < 670; y++) for (let x = 795; x < 825; x++) {
        const o = ((gl ? 899 - y : y) * 1600 + x) * 4;
        if (pixels[o]! > 220 && pixels[o + 1]! > 170 && pixels[o + 2]! < 160) badgePixels++;
      }
      if (badgePixels < 5) throw Error(`Missing gold +1 badge: ${badgePixels}`);
      Reflect.set(window, 'disposeExtraBomb', () => { arena?.destroy(); canvas.remove(); });
      return { badgePixels };
    }, { mode, themeId });
    await page.screenshot({ path: `artifacts/extra-bomb-${mode}-${themeId}.png` });
    await page.evaluate(() => { (Reflect.get(window, 'disposeExtraBomb') as () => void)(); });
    console.log(JSON.stringify({ mode, themeId, ...result }));
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
