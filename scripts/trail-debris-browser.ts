import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';
import type { ViewSnapshot } from '../src/client/snapshot-stream.js';

const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw Error('No server');
const browserName = process.env.BROWSER ?? 'chrome';
const browser = browserName === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'chrome' });
const errors: string[] = [];
try {
  await mkdir('artifacts', { recursive: true });
  for (const mode of ['webgl', 'phaser-canvas'] as const) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript('window.__name = value => value');
    await page.goto(`http://127.0.0.1:${address.port}/?room=INVALID`);
    await page.getByText('Invalid room code', { exact: true }).waitFor();
    const removed = await page.evaluate(async mode => {
      const { createPhaserArena } = await import(String('/src/client/phaser/arena.ts')) as typeof import('../src/client/phaser/arena.js');
      const { themes } = await import(String('/src/client/themes.ts')) as typeof import('../src/client/themes.js');
      const { createGame, addPlayer, startMatch, toSnapshot, step } = await import(String('/src/shared/game.ts')) as typeof import('../src/shared/game.js');
      const game = createGame('trail-debris-browser', 42);
      for (let p = 0; p < 3; p++) {
        addPlayer(game, { id: `p${p}`, name: `P${p}`, slot: p, color: ['#22d3ee', '#ff4fa3', '#a3e635'][p]! });
      }
      startMatch(game);
      for (let p = 0; p < 3; p++) {
        const rider = game.players.get(`p${p}`)!;
        Object.assign(rider, { alive: true, x: 160, y: 160 + p * 220, angle: 0,
          trail: Array.from({ length: 60 }, (_, i) => ({ x1: 520 + i * 7, x2: 527 + i * 7,
            y1: 330 + p * 100 + Math.sin(i * .16) * 35, y2: 330 + p * 100 + Math.sin((i + 1) * .16) * 35,
            createdTick: 120 + i, expiresAtTick: 400 })) });
      }
      Object.assign(game, { tick: 200, round: 1, phase: 'playing', roundStartedTick: 190, boundaryInset: 35, nextPickupSpawnTick: 9999 });
      game.bombs.set(99, { id: 99, ownerId: 'p0', launchX: 730, launchY: 450, x: 730, y: 450,
        placedTick: 195, launchedTick: 195, landsAtTick: 196, explodeAtTick: 201, blastRange: 150, flightPath: [] });
      const before = { ...toSnapshot(game), tick: game.tick, round: game.round, bombs: [] };
      step(game, new Map());
      const after = { ...toSnapshot(game), tick: game.tick, round: game.round, pickups: [] };
      const removed = before.players.reduce((n, p) => n + p.trail.length, 0) - after.players.reduce((n, p) => n + p.trail.length, 0);
      document.body.replaceChildren(); document.body.style.cssText = 'margin:0;background:#020715';
      let canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900; document.body.append(canvas);
      const arena = createPhaserArena(canvas, { renderer: mode === 'webgl' ? 'auto' : 'canvas', resolution: 'world' });
      await arena.ready;
      const paint = (snapshot: ViewSnapshot, now: number) => {
        arena.render(snapshot, now, themes['neon-pixel'], 'debris');
      };
      paint(before, 1000); paint(after, 1050);
      const pixels = () => {
        const gl = mode === 'webgl' ? canvas.getContext('webgl') : null;
        if (!gl) return new Uint8Array(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data);
        const data = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data); return data;
      };
      paint({ ...after, tick: 204 }, 1200);
      Reflect.set(window, 'debrisTailCheck', () => {
        const tail = { ...after, tick: 210, blasts: [] };
        paint(tail, 1500); const moving = pixels();
        paint(tail, 2100); const cleared = pixels();
        let changed = 0;
        for (let i = 0; i < moving.length; i += 4) if (Math.abs(moving[i]! - cleared[i]!) + Math.abs(moving[i + 1]! - cleared[i + 1]!) + Math.abs(moving[i + 2]! - cleared[i + 2]!) > 70) changed++;
        paint(tail, 2200); const expired = pixels();
        if (!cleared.every((value, i) => value === expired[i])) throw Error('Debris survived expiry');
        arena.destroy(); return changed;
      });
      return removed;
    }, mode);
    assert.ok(removed > 20, 'real simulation must remove the trails');
    await page.screenshot({ path: `artifacts/trail-debris-${mode}-${browserName}.png` });
    const changed = await page.evaluate(() => (Reflect.get(window, 'debrisTailCheck') as () => number)());
    assert.ok(changed > 50, `${mode}: visible debris must outlast the explosion, move, and clear`);
    console.log(JSON.stringify({ mode, removed, debrisPixels: changed }));
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close(); await server.close();
}
