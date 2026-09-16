import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';
import { POWERUP_GUIDE } from '../src/client/powerup-guide.js';
import { themes } from '../src/client/themes.js';

/** Reproducible sprite sheet and actual arena captures, without a live room. */
const output = 'artifacts/powerup-showcase';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw Error('No preview server');
// One list, derived from the guide that already pairs a pickup with its name, so the sheet cannot silently omit a
// pickup again (#176). bomb and flame are the sprites that are not pickups; rider is not part of this sheet.
const names = ['bomb', ...POWERUP_GUIDE.map(entry => `pickup-${entry.type}`), 'flame'];
const labels = ['BOMB', ...POWERUP_GUIDE.map(entry => entry.name), 'FLAME'];
const themeList = (Object.keys(themes) as Array<keyof typeof themes>).map(id => ({ id, heading: themes[id].label.toUpperCase() }));
const types = POWERUP_GUIDE.map(entry => entry.type);
const browserName = process.env.BROWSER === 'webkit' ? 'webkit' : 'chrome';
const browser = browserName === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
// Phaser loader failures only log to the console, so treat console errors as failures too.
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.addInitScript('window.__name = value => value');
  await page.route('**/sprite-showcase.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><main></main></body></html>' }));
  await page.goto(`http://127.0.0.1:${address.port}/sprite-showcase.html`);
  await page.evaluate(async ({ names, labels, themeList }) => {
    document.head.innerHTML = `<style>
      *{box-sizing:border-box}body{margin:0;background:#040d1e;color:#ebf5ff;font-family:system-ui;padding:44px}
      h1{font-size:32px;letter-spacing:-1px;margin:0 0 8px}p{color:#8ea5bf;margin:0 0 30px;font-size:14px}
      h2{font-size:13px;color:#79ebf4;letter-spacing:3px;margin:28px 0 14px}
      .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:12px}
      .card{border:1px solid #23405b;border-radius:18px;background:radial-gradient(at 50% 20%,#142741,#071326);text-align:center;padding:17px 10px 12px}
      .hero{width:76px;height:76px;display:block;margin:auto auto 10px}.small{height:34px;display:flex;gap:18px;align-items:center;justify-content:center;margin:10px 0 0}
      b{font-size:10px;letter-spacing:2px;color:#c7dbea}img{object-fit:contain}
    </style>`;
    const root = document.querySelector('main')!;
    root.innerHTML = '<h1>Power-ups, polished.</h1><p>Smooth neon sprites · enlarged detail above, 22px and 34px sizes below</p>';
    for (const theme of themeList) {
      const heading = document.createElement('h2'); heading.textContent = theme.heading; root.append(heading);
      const grid = document.createElement('div'); grid.className = 'grid'; root.append(grid);
      names.forEach((name, index) => {
        const src = `/themes/${theme.id}/${name}.svg`;
        const card = document.createElement('div'); card.className = 'card';
        card.innerHTML = `<img class="hero" src="${src}"><b>${labels[index]}</b><div class="small"><img width="22" height="22" src="${src}"><img width="34" height="34" src="${src}"></div>`;
        grid.append(card);
      });
    }
    await Promise.all(Array.from(document.images, image => image.decode()));
  }, { names, labels, themeList });
  await page.screenshot({ path: `${output}/${browserName}-sprites.png`, fullPage: true });
  for (const backend of ['auto', 'canvas'] as const) {
    for (const { id: themeId } of themeList) {
      await page.evaluate(async ({ backend, themeId, types }) => {
        const { createPhaserArena } = await import(String('/src/client/phaser/arena.ts')) as typeof import('../src/client/phaser/arena.js');
        const { visualFixture } = await import(String('/src/client/phaser/benchmark-fixture.ts')) as typeof import('../src/client/phaser/benchmark-fixture.js');
        const { themes } = await import(String('/src/client/themes.ts')) as typeof import('../src/client/themes.js');
        document.body.innerHTML = '<div style="width:1280px;height:720px"><canvas width="1600" height="900"></canvas></div>';
        const canvas = document.querySelector('canvas')!;
        const arena = createPhaserArena(canvas, { renderer: backend }); await arena.ready;
        const fixture = visualFixture(40);
        // Spacing follows the count: past a dozen pickups a fixed 125 would run the row off the 1600px arena.
        const spacing = Math.min(125, 1380 / Math.max(1, types.length - 1));
        fixture.pickups = types.map((type, index) => ({ id: index, type, x: 110 + index * spacing, y: 780, expiresAtTick: 100 }));
        fixture.bombs = fixture.bombs.filter(bomb => !bomb.shell).slice(0, 3).map((bomb, index) => ({ ...bomb, x: 450 + index * 250, y: 250, explodeAtTick: 43 + index * 8 }));
        arena.render(fixture, 1000, themes[themeId], 'sprite-showcase');
        canvas.dataset.ready = 'true';
        window.addEventListener('showcase-dispose', () => arena.destroy(), { once: true });
      }, { backend, themeId, types });
      await page.locator('canvas[data-ready="true"]').screenshot({ path: `${output}/${browserName}-${backend}-${themeId}.png` });
      await page.evaluate(() => window.dispatchEvent(new Event('showcase-dispose')));
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Decoded all ${names.length * themeList.length} SVG assets; captured every theme in WebGL and Canvas (${browserName}): ${output}`);
} finally {
  await browser.close(); await server.close();
}
