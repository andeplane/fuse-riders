import { preview } from 'vite';
import { AVATAR_ATLAS_URL } from '../src/shared/avatars.js';
import { defaultTheme, themes } from '../src/client/themes.js';
import { POWERUP_GUIDE } from '../src/client/powerup-guide.js';
import { chromium } from 'playwright';
import { readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { visualFixture } from '../src/client/phaser/benchmark-fixture.js';
const directory=process.env.BUILD_DIRECTORY??'artifacts/phaser-pages-dist';
const chunk=(await readdir(`${directory}/assets`)).find(file=>file.startsWith('arena-')&&file.endsWith('.js'));assert.ok(chunk,'Phaser chunk exists');
const server=await preview({base:'/fuse-riders/',build:{outDir:directory},preview:{port:0,host:'127.0.0.1'}});
const address=server.httpServer.address();if(!address||typeof address==='string')throw Error('No preview server');
const browser=await chromium.launch({channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}});const assets:string[]=[];const failures:string[]=[];
 page.on('response',r=>{if(/\/themes\/|\/avatars\//.test(r.url())){assets.push(new URL(r.url()).pathname);if(!r.ok())failures.push(`${r.status()} ${r.url()}`);}});
 page.on('pageerror',e=>failures.push(e.message));await page.addInitScript('window.__name = value => value');
 await page.goto(`http://127.0.0.1:${address.port}/fuse-riders/`);
 await page.evaluate(async({chunk,state,theme})=>{
   const module=await import(`/fuse-riders/assets/${chunk}`) as typeof import('../src/client/phaser/arena.js');
   const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;document.body.append(canvas);
   const arena=module.createPhaserArena(canvas);await arena.ready;
   arena.render(state,performance.now(),theme,'pages-test');
   arena.destroy();canvas.remove();
 },{chunk,state:visualFixture(20),theme:defaultTheme});
 assert.deepEqual(failures,[]);
 // The landing page loads assets of its own — an attract arena, the legend icons — before this smoke builds
 // its arena, so how many *responses* arrive depends on composition and timing. What must hold is which paths were fetched.
 // The set subsumes the prefix check it replaced: every path is built from /fuse-riders, so a doubled prefix or a stray host
 // shows up as a named difference instead of a boolean. Flame is inventory art and is not loaded by Phaser.
 const expected=new Set([...Object.values(themes).flatMap(theme=>[theme.sprites.rider,theme.sprites.bomb,...POWERUP_GUIDE.map(entry=>`/themes/${theme.id}/pickup-${entry.type}.svg`)]),AVATAR_ATLAS_URL].map(path=>`/fuse-riders${path}`));
 assert.deepEqual(new Set(assets),expected);
 console.log(`Pages subpath smoke passed: ${new Set(assets).size} theme/avatar assets across ${assets.length} responses, all below /fuse-riders/.`);
}finally{await browser.close();await new Promise<void>((resolve,reject)=>server.httpServer.close(error=>error?reject(error):resolve()));}
