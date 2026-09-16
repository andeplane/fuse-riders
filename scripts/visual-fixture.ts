// A controlled renderer fixture for comparing art direction. Not a gameplay test.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { createGameServer } from '../src/server/index.js';
import { AVATARS } from '../src/shared/avatars.js';
import { addPlayer, type TrailSegment } from '../src/shared/game.js';
import { createVolleyFlightPaths } from '../src/shared/launch-modifiers.js';

const app = await createGameServer({ port: 0, hostname: '127.0.0.1', lanAddress: '127.0.0.1', manualTicks: true, buildDirectory: process.env.BUILD_DIRECTORY });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const colors = ['#00d9ff', '#ff3aaf', '#b5ff36', '#ff963b', '#b76bff'];
  for (let i = 0; i < 5; i++) addPlayer(app.game, { id: `p${i}`, name: `P${i + 1}`, avatarId: AVATARS[i * 2]!.id, slot: i, color: colors[i] });
  app.game.phase = 'playing'; app.game.tick = 960; app.game.roundStartedTick = 0;
  // Cubic Bézier chains place representative curved trails throughout the arena.
  type Point = readonly [number, number];
  const routes: Point[][] = [
    [[490,340],[300,390],[110,330],[110,160],[110,50],[350,60],[320,190],[310,235],[260,250],[205,200]],
    [[190,310],[70,350],[110,530],[250,550],[330,630],[430,610],[530,550]],
    [[420,650],[610,600],[490,550],[460,470],[400,380],[540,300],[640,215]],
    [[840,105],[930,40],[1080,80],[1060,155],[1040,255],[740,270],[820,165],[865,110],[960,165],[1010,155]],
    [[840,450],[1050,335],[1130,445],[1080,550],[1100,650],[925,670],[870,585]],
  ];
  routes.forEach((points, index) => {
    const player = app.game.players.get(`p${index}`)!;
    const segments: TrailSegment[] = [];
    let previous = points[0];
    for (let i = 0; i + 3 < points.length; i += 3) {
      const [a,b,c,d] = points.slice(i, i + 4);
      for (let j = 1; j <= 60; j++) {
        const t = j / 60; const s = 1 - t;
        const current: Point = [s*s*s*a[0]+3*s*s*t*b[0]+3*s*t*t*c[0]+t*t*t*d[0],s*s*s*a[1]+3*s*s*t*b[1]+3*s*t*t*c[1]+t*t*t*d[1]];
        segments.push({ x1: previous[0], y1: previous[1], x2: current[0], y2: current[1], createdTick: 900, expiresAtTick: 1040 });
        previous = current;
      }
    }
    player.trail = segments; player.x = previous[0]; player.y = previous[1];
    const last = segments.at(-1)!; player.angle = Math.atan2(last.y2-last.y1,last.x2-last.x1); player.alive = true; player.roundWins = index % 4;
  });
  for (const [id,x,y] of [[1,405,145],[2,1040,355],[3,670,605]]) app.game.bombs.set(id,{id,ownerId:`p${id}`,launchX:x,launchY:y,x,y,placedTick:940,launchedTick:940,landsAtTick:946,explodeAtTick:980+id*5,blastRange:150,flightPath:Array.from({length:7},()=>({x,y,angle:0}))});
  app.game.blasts.push({ bombId: 5, ownerId: 'p0', circle: { x: 510, y: 340, radius: 150 }, expiresAtTick:968 });
  app.game.pickups = [
    { id: 1, type: 'power', x: 1250, y: 320, expiresAtTick: 1200 },
    { id: 3, type: 'five', x: 1350, y: 420, expiresAtTick: 1200 },
    { id: 2, type: 'star', x: 1250, y: 520, expiresAtTick: 1200 },
  ];
  app.game.players.get('p4')!.invulnerableUntilTick = 1000;
  app.game.players.get('p0')!.shielded = true;
  app.game.players.get('p0')!.targetBombArmed = true;
  app.game.players.get('p0')!.bombChargeStartedTick = 942;
  app.game.players.get('p0')!.bombTarget = { x: 1200, y: 650 };
  app.game.players.get('p1')!.drunkUntilTick = 1020;
  app.game.players.get('p3')!.inkUntilTick = 980;
  app.game.players.get('p2')!.fiveShotArmed = true;
  app.game.players.get('p2')!.bombChargeStartedTick = 942;
  app.game.portalPairs = [
    { id: 'fixture-gates', gates: [{ x: 1300, y: 180, halfLength: 140 }, { x: 900, y: 720, halfLength: 140 }], expiresAtTick: 1150 },
    { id: 'fixture-gates-2', gates: [{ x: 260, y: 300, halfLength: 110 }, { x: 700, y: 620, halfLength: 110 }], expiresAtTick: 1150 },
  ];
  const flightPath = createVolleyFlightPaths({ x: 700, y: 700 }, 0, 300, { minX: 27, minY: 27, maxX: 1573, maxY: 873 })[1]!;
  const landing = flightPath.at(-1)!;
  app.game.bombs.set(4, { id: 4, ownerId: 'p0', launchX: 700, launchY: 700, x: landing.x, y: landing.y, placedTick: 957, launchedTick: 957, landsAtTick: 963, explodeAtTick: 997, blastRange: 150, flightPath });
  const page = await browser.newPage({ viewport: {width:1672,height:940} });
  // tsx preserves nested function names with this helper when serializing evaluate callbacks.
  await page.addInitScript('globalThis.__name = (fn) => fn;');
  await page.goto(`http://127.0.0.1:${app.port}/display#${app.hostToken}`);
  await page.getByText('HOST ONLINE',{exact:true}).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  if (process.env.BENCHMARK === '1') {
    const sample = await page.evaluate(async () => {
      const intervals: number[] = [];
      let previous = performance.now(); const start = previous;
      await new Promise<void>(resolve => {
        function measure(now: number) {
          intervals.push(now - previous); previous = now;
          if (now - start < 5000) requestAnimationFrame(measure); else resolve();
        }
        requestAnimationFrame(measure);
      });
      const sorted = intervals.slice(1).sort((a,b) => a-b);
      return { frames: intervals.length, elapsedMs: previous-start, fps: intervals.length*1000/(previous-start), medianFrameMs: sorted[Math.floor(sorted.length*.5)], p95FrameMs: sorted[Math.floor(sorted.length*.95)] };
    });
    console.log('RENDER_BENCHMARK', JSON.stringify(sample));
  }
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/neon-pixel-visual.png'});
  await page.getByRole('combobox').selectOption('clean-neon'); await page.waitForTimeout(300);
  await page.screenshot({path:'artifacts/clean-neon-visual.png'});
  console.log('Saved controlled art comparison fixtures for both themes. These are renderer fixtures, not live match evidence.');
} finally { await browser.close(); await app.close(); }
