import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
const server=await createServer({server:{port:0,host:'127.0.0.1',hmr:false}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('No server');
const browser=process.env.BROWSER==='webkit'?await webkit.launch():await chromium.launch({channel:'chrome',args:['--enable-webgl']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await mkdir('artifacts',{recursive:true});
 await page.exposeFunction('captureRenderer',async()=>page.screenshot({path:'artifacts/phaser-arena.png'}));
 await page.addInitScript('window.__name = value => value');
 await page.goto(`http://127.0.0.1:${address.port}/`);
 const result=await page.evaluate(async(duration)=>{
  const {createPhaserArena}=await import(String('/src/client/phaser/arena.ts')) as typeof import('../src/client/phaser/arena.js');
  const {visualFixture}=await import(String('/src/client/phaser/benchmark-fixture.ts')) as typeof import('../src/client/phaser/benchmark-fixture.js');
  const {drawArena}=await import(String('/src/client/main.ts')) as typeof import('../src/client/main.js');
  const {defaultTheme,loadThemeSprites}=await import(String('/src/client/themes.ts')) as typeof import('../src/client/themes.js');
  const sprites=await loadThemeSprites(defaultTheme);
  const results=[];
  document.querySelector('#app')!.remove();document.body.style.cssText='margin:0;background:#020715';
  for(const mode of ['canvas','phaser']){
   const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;canvas.style.cssText='width:100%;height:auto';document.body.append(canvas);
   const engine=mode==='phaser'?createPhaserArena(canvas):undefined;if(engine)await engine.ready;
   const ctx=engine?null:canvas.getContext('2d')!;const frames:number[]=[],cpu:number[]=[],objects:number[]=[],particles:number[]=[];
   let start=performance.now(),previous=start;
   await new Promise<void>(resolve=>{function frame(now:number){const elapsed=now-start;const snapshot=visualFixture(Math.floor(elapsed/50));const before=performance.now();if(engine)engine.render(snapshot,now,defaultTheme,'benchmark');else drawArena(ctx!,snapshot,now,defaultTheme,sprites);const cost=performance.now()-before;
    if(elapsed>1000){frames.push(now-previous);cpu.push(cost);if(engine){objects.push(engine.metrics().objects);particles.push(engine.metrics().particles);}}previous=now;
    if(elapsed<duration)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
   const percentile=(v:number[],p:number)=>[...v].sort((a,b)=>a-b)[Math.min(v.length-1,Math.floor(v.length*p))]??0;
   results.push({mode,backend:engine?.metrics().renderer??'2d',samples:frames.length,frame:{p50:percentile(frames,.5),p95:percentile(frames,.95),p99:percentile(frames,.99),max:Math.max(...frames)},cpu:{p50:percentile(cpu,.5),p95:percentile(cpu,.95),p99:percentile(cpu,.99)},maxObjects:Math.max(0,...objects),maxParticles:Math.max(0,...particles),raw:{frames,cpu}});
   if(engine){if(engine.metrics().automaticLoopRunning)throw Error('Phaser automatic loop still running');if(Math.max(...particles)<=0||Math.max(...particles)>480)throw Error('Particle emission/bound regression');await (window as unknown as {captureRenderer:()=>Promise<void>}).captureRenderer();engine.destroy();}canvas.remove();
  }
  return {userAgent:navigator.userAgent,devicePixelRatio,results};
 },Number(process.env.DURATION_MS??15000));
 await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/phaser-benchmark-${process.env.BROWSER??'chrome'}.json`,JSON.stringify({date:new Date().toISOString(),method:'Synthetic 5 riders, 800 segments, 24 projectiles, 5 bursts; fixed 1600x900; sequential Canvas/Phaser, 1s warmup. Desktop browser only.',...result,errors},null,2));
 console.log(JSON.stringify({...result,results:result.results.map(({raw,...r})=>r),errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();await server.close();}
