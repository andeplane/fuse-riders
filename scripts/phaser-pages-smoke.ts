import { preview } from 'vite';
import { chromium } from 'playwright';
import { readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { defaultTheme } from '../src/client/themes.js';
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
 assert.deepEqual(failures,[]);assert.equal(assets.length,29);assert.ok(assets.every(path=>path.startsWith('/fuse-riders/')&&!path.includes('/fuse-riders/fuse-riders/')));
 console.log(`Pages subpath smoke passed: ${assets.length} theme/avatar assets loaded successfully below /fuse-riders/.`);
}finally{await browser.close();await new Promise<void>((resolve,reject)=>server.httpServer.close(error=>error?reject(error):resolve()));}
