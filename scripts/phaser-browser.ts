import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';
const server=await createServer({server:{port:0,host:'127.0.0.1',hmr:false}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('No server');
const browser=process.env.BROWSER==='webkit'?await webkit.launch():await chromium.launch({channel:'chrome'});
const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.stack ?? e.message));
try{
 await page.addInitScript('window.__name = value => value');await page.goto(`http://127.0.0.1:${address.port}/`);
 const result=await page.evaluate(async()=>{
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
   const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;document.body.append(canvas);
   const arena=createPhaserArena(canvas,{renderer:backend});await arena.ready;
   let now=performance.now();
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
   arena.destroy();arena.destroy();canvas.remove();
  }
  const {mountArenaPresentation}=await import(String('/src/client/phaser/presentation.ts')) as typeof import('../src/client/phaser/presentation.js');
  let fallbackCanvas=document.createElement('canvas');fallbackCanvas.width=1600;fallbackCanvas.height=900;document.body.append(fallbackCanvas);
  const presentation=mountArenaPresentation(fallbackCanvas,ctx=>{ctx.fillStyle='#00ff00';ctx.fillRect(0,0,1600,900);},replacement=>{fallbackCanvas=replacement;});
  let raf=0;const render=()=>{presentation.render(visualFixture(40),performance.now(),themes['neon-pixel'],{},'fallback-test');raf=requestAnimationFrame(render);};render();
  const until=async(predicate:()=>boolean)=>{const end=performance.now()+6000;while(!predicate()){if(performance.now()>end)throw Error('Presentation recovery timed out');await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}};
  await until(()=>fallbackCanvas.dataset.renderer==='phaser-webgl');
  const extension=fallbackCanvas.getContext('webgl')!.getExtension('WEBGL_lose_context');
  if(extension){extension.loseContext();await until(()=>fallbackCanvas.dataset.renderer==='canvas-fallback');const pixel=fallbackCanvas.getContext('2d')!.getImageData(20,20,1,1).data;if(pixel[1]!==255||fallbackCanvas.style.opacity!=='1')throw Error('Fallback did not repaint visibly');}
  cancelAnimationFrame(raf);presentation.destroy();fallbackCanvas.remove();
  return results;
 });
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result,errors},null,2));
}finally{await browser.close();await server.close();}
