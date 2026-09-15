import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';
import { smokeTimeout } from './smoke-timeout.js';
const server=await createServer({server:{port:0,host:'127.0.0.1',hmr:false}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('No server');
const browser=process.env.BROWSER==='webkit'?await webkit.launch():await chromium.launch({channel:'chrome'});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:Number(process.env.DPR??2)});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.stack ?? e.message));
try{
 await page.addInitScript('window.__name = value => value');await page.goto(`http://127.0.0.1:${address.port}/`);
 const result=await page.evaluate(async(recoveryBudgetMs)=>{
  const {createPhaserArena}=await import(String('/src/client/phaser/arena.ts')) as typeof import('../src/client/phaser/arena.js');
  const {visualFixture}=await import(String('/src/client/phaser/benchmark-fixture.ts')) as typeof import('../src/client/phaser/benchmark-fixture.js');
  const {themes}=await import(String('/src/client/themes.ts')) as typeof import('../src/client/themes.js');
  const results=[];
  // Game boot precedes asynchronous default textures and SceneManager boot.
  // Disposal in that gap must reject readiness without touching a missing system scene.
  for(const backend of ['auto','canvas'] as const){
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;document.body.append(canvas);
   const arena=createPhaserArena(canvas,{renderer:backend});const outcome=arena.ready.then(()=>false,()=>true);
   arena.destroy();arena.destroy();if(!await outcome)throw Error('Disposed renderer reported readiness');
   await new Promise<void>(resolve=>setTimeout(resolve,100));canvas.remove();
  }

  for(const backend of ['auto','canvas'] as const){
   const wrapper=document.createElement('div');wrapper.style.cssText='position:fixed;inset:0;width:800px;height:450px';document.body.append(wrapper);
   const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;wrapper.append(canvas);
   const arena=createPhaserArena(canvas,{renderer:backend});await arena.ready;
   let now=performance.now();
   if(backend==='auto'&&!canvas.getContext('webgl')?.getContextAttributes()?.antialias)throw Error('WebGL trail antialiasing is disabled');
   const fixed=visualFixture(40);
   arena.render(fixed,now,themes['neon-pixel'],'cache-test');
   const settle=async()=>{await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));};
   for(const [w,h] of [[800,450],[1200,675],[400,225]]) {
    wrapper.style.width=`${w}px`;wrapper.style.height=`${h}px`;await settle();
    arena.render(fixed,now,themes['neon-pixel'],'cache-test');
    if(canvas.width!==w*devicePixelRatio||canvas.height!==h*devicePixelRatio)throw Error(`DPR sizing failed: ${canvas.width}x${canvas.height} at ${w}x${h} DPR ${devicePixelRatio}`);
    // A fixture containing just two bright, far-apart landmarks verifies world-to-pixel mapping
    // and the boundary mask after every resize, on both actual rendering backends.
    const marker={...fixed,players:fixed.players.slice(0,1).map(p=>({...p,alive:true,shielded:false,x:500,y:400,trail:[
     {x1:100,y1:100,x2:300,y2:100,createdTick:39,expiresAtTick:100},
     {x1:1200,y1:800,x2:1400,y2:800,createdTick:40,expiresAtTick:100}
    ]})),pickups:[],bombs:[],blasts:[]};
    arena.render(marker,now,themes['neon-pixel'],'sizing-markers');
    for(const [x,y] of [[200,100],[1300,800]]) {
     const px=Math.floor(x*canvas.width/1600),py=Math.floor(y*canvas.height/900);
     const gl=backend==='auto'?canvas.getContext('webgl'):null;
     const pixel=new Uint8Array(4);
     if(gl)gl.readPixels(px,canvas.height-1-py,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
     else pixel.set(canvas.getContext('2d')!.getImageData(px,py,1,1).data);
     if(Math.max(...pixel.slice(0,3))<100)throw Error(`World landmark missing after resize at ${x},${y}: ${pixel}`);
    }
   }
   arena.render(fixed,now,themes['neon-pixel'],'cache-test');
   const stableHistoryBuilds=arena.metrics().trailHistoryBuilds;
   for(let frame=1;frame<=12;frame++) {
    const moving={...fixed,tick:40+frame/20,players:fixed.players.map(p=>({...p,x:p.x+frame/10,
     trail:p.trail.map((segment,index)=>index===p.trail.length-1?{...segment,x2:segment.x2+frame/10}:({...segment}))}))};
    arena.render(moving,now+frame*16,themes['neon-pixel'],'cache-test');
   }
   if(arena.metrics().trailHistoryBuilds!==stableHistoryBuilds)throw Error('Fractional presentation rebuilt stable trail history');
   const clipped={...fixed,players:fixed.players.map((p,index)=>index? p:{...p,trail:p.trail.slice(1)})};
   arena.render(clipped,now+220,themes['neon-pixel'],'cache-test');
   if(arena.metrics().trailHistoryBuilds!==stableHistoryBuilds+1)throw Error('Trail expiry did not refresh geometry');
   arena.reset();
   for(let tick=0;tick<30;tick++)arena.render(visualFixture(tick),now+tick*16,themes['neon-pixel'],'epoch1:match');
   const active=arena.metrics();if(active.automaticLoopRunning)throw Error('Two render loops');if(active.particles<=0||active.particles>480)throw Error('Particles not bounded/emitting');
   arena.reset();if(arena.metrics().particles!==0)throw Error('Reset retained effects');
   arena.render({...visualFixture(36),boundaryInset:100},now+500,themes['clean-neon'],'epoch2:match');
   if(arena.metrics().particles!==0)throw Error('New epoch replayed old bursts');
   const gl=backend==='auto'?canvas.getContext('webgl'):null;const extension=gl?.getExtension('WEBGL_lose_context');
   let restored=false;
   if(extension){
    const wait=(event:string)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`${event} timed out`)),4000);canvas.addEventListener(event,()=>{clearTimeout(timer);resolve();},{once:true});});
    const lost=wait('webglcontextlost');extension.loseContext();await lost;
    arena.render(visualFixture(37),now+550,themes['clean-neon'],'epoch2:match');
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    const restore=wait('webglcontextrestored');extension.restoreContext();await restore;
    arena.render(visualFixture(38),now+600,themes['clean-neon'],'epoch2:match');
    const pixel=new Uint8Array(4);gl!.readPixels(200,200,1,1,gl!.RGBA,gl!.UNSIGNED_BYTE,pixel);if(pixel[0]+pixel[1]+pixel[2]===0)throw Error('Restored renderer remained blank');restored=true;
   }
   results.push({backend:active.renderer,objects:active.objects,particles:active.particles,contextRestored:restored});
   arena.destroy();arena.destroy();wrapper.remove();
  }
  const {mountArenaPresentation}=await import(String('/src/client/phaser/presentation.ts')) as typeof import('../src/client/phaser/presentation.js');
  const fallbackWrapper=document.createElement('div');fallbackWrapper.style.cssText='width:800px;height:450px';document.body.append(fallbackWrapper);
  let fallbackCanvas=document.createElement('canvas');fallbackCanvas.width=1600;fallbackCanvas.height=900;fallbackCanvas.style.cssText='width:100%;height:100%';fallbackWrapper.append(fallbackCanvas);
  const presentation=mountArenaPresentation(fallbackCanvas,ctx=>{ctx.fillStyle='#00ff00';ctx.fillRect(0,0,1600,900);},replacement=>{fallbackCanvas=replacement;});
  let raf=0;const render=()=>{presentation.render(visualFixture(40),performance.now(),themes['neon-pixel'],{},'fallback-test');raf=requestAnimationFrame(render);};render();
  // The presentation allows 10 s for renderer startup (then falls back) and 2 s before falling back from a lost
  // context; 15 s covers both. Each wait names its stage and last state for diagnosis. The budget is polled by
  // requestAnimationFrame, which crawls under software GL, so it scales with SMOKE_TIMEOUT_SCALE like every
  // other smoke deadline rather than staying fixed.
  const until=async(stage:string,predicate:()=>boolean)=>{const end=performance.now()+recoveryBudgetMs;while(!predicate()){if(performance.now()>end)throw Error(`Presentation recovery timed out waiting for ${stage} (renderer=${fallbackCanvas.dataset.renderer}, status=${fallbackCanvas.dataset.rendererStatus}, ${fallbackCanvas.width}x${fallbackCanvas.height})`);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}};
  await until('WebGL startup',()=>fallbackCanvas.dataset.renderer==='phaser-webgl');
  const extension=fallbackCanvas.getContext('webgl')!.getExtension('WEBGL_lose_context');
  if(extension){extension.loseContext();await until('canvas fallback after context loss',()=>fallbackCanvas.dataset.renderer==='canvas-fallback');const pixel=fallbackCanvas.getContext('2d')!.getImageData(20,20,1,1).data;if(pixel[1]!==255||fallbackCanvas.style.opacity!=='1')throw Error('Fallback did not repaint visibly');
   await until('fallback 800x450 backing size',()=>fallbackCanvas.width===800*devicePixelRatio&&fallbackCanvas.height===450*devicePixelRatio);
   fallbackWrapper.style.width='400px';fallbackWrapper.style.height='225px';
   await until('fallback 400x225 backing size',()=>fallbackCanvas.width===400*devicePixelRatio&&fallbackCanvas.height===225*devicePixelRatio);
  }
  cancelAnimationFrame(raf);presentation.destroy();fallbackWrapper.remove();
  return results;
 },smokeTimeout(15000));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result,errors},null,2));
}finally{if(errors.length)console.error('Page errors:',errors);await browser.close();await server.close();}
