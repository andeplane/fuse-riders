import type { ViewSnapshot } from '../snapshot-stream.js';
import type { ThemeDefinition, ThemeSprites } from '../themes.js';
import type { PhaserArena } from './arena.js';

type LegacyDraw = (ctx: CanvasRenderingContext2D, snapshot: ViewSnapshot, now: number, theme: ThemeDefinition, sprites: ThemeSprites) => void;
/** Lazy renderer boundary. A failed WebGL canvas is replaced before requesting a 2D context. */
export function mountArenaPresentation(initialCanvas: HTMLCanvasElement, legacyDraw: LegacyDraw, replaced: (canvas: HTMLCanvasElement) => void): {
  render(snapshot: ViewSnapshot, now: number, theme: ThemeDefinition, sprites: ThemeSprites, scope: string): void;
  destroy(): void;
} {
  let canvas=initialCanvas; let engine:PhaserArena|undefined; let context:CanvasRenderingContext2D|null=null; let disposed=false;let metricsAt=0;let restoreTimer:ReturnType<typeof setTimeout>|undefined;
  const status=document.createElement('output');status.setAttribute('aria-live','polite');status.style.cssText='display:none;position:fixed;bottom:12px;left:12px;z-index:1000;padding:10px;background:#08152b;color:#ffe680;font:14px monospace';
  const legacy=new URLSearchParams(location.search).get('renderer')==='canvas';
  const fallback=()=>{
    clearTimeout(restoreTimer);status.style.display='none';engine?.destroy();engine=undefined;
    const replacement=canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.replaceWith(replacement);canvas=replacement;replaced(canvas);
    context=canvas.getContext('2d');canvas.dataset.renderer='canvas-fallback';
  };
  if(legacy){context=canvas.getContext('2d');canvas.dataset.renderer='canvas';}
  else void import('./arena.js').then(async module=>{
    if(disposed)return;
    engine=module.createPhaserArena(canvas,{renderer:new URLSearchParams(location.search).get('renderer')==='phaser-canvas'?'canvas':'auto',quality:matchMedia('(max-width: 700px)').matches?'low':'high',onStatus:value=>{clearTimeout(restoreTimer);if(value==='context-lost')restoreTimer=setTimeout(()=>{if(!disposed)fallback();},2000);canvas.dataset.rendererStatus=value;canvas.style.opacity=value==='context-lost'?'.35':'1';status.textContent=value==='context-lost'?'Graphics paused — restoring GPU context':'';status.style.display=value==='context-lost'?'block':'none';if(!status.isConnected)document.body.append(status);}});
    let timeout: ReturnType<typeof setTimeout>|undefined;
    try { await Promise.race([engine.ready,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Renderer startup timed out')),10000);})]); } finally { clearTimeout(timeout); }
    canvas.dataset.renderer=`phaser-${engine.metrics().renderer}`;
  }).catch(()=>{if(!disposed)fallback();});
  return {
    render(snapshot,now,theme,sprites,scope){
      if(disposed)return;
      if(engine){engine.render(snapshot,now,theme,scope);if(now-metricsAt>500){canvas.dataset.rendererMetrics=JSON.stringify(engine.metrics());metricsAt=now;}}
      else if(context){
        if(canvas.width!==snapshot.width||canvas.height!==snapshot.height){canvas.width=snapshot.width;canvas.height=snapshot.height;}
        context.setTransform(1,0,0,1,0,0);
        legacyDraw(context,snapshot,now,theme,sprites);
      }
    },
    destroy(){disposed=true;clearTimeout(restoreTimer);status.remove();engine?.destroy();engine=undefined;},
  };
}
