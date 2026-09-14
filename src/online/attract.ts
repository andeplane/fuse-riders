import { HostSession } from './host-session.js';
import { defaultRoomSettings } from '../shared/room-settings.js';
import { mountArenaPresentation } from '../client/phaser/presentation.js';
import { drawArena } from '../client/main.js';
import { defaultTheme, loadThemeSprites } from '../client/themes.js';

/** A separate, silent local game. It never opens a room or a connection. */
export async function startAttract(initialCanvas: HTMLCanvasElement, toggle: HTMLButtonElement): Promise<()=>void> {
  const host = new HostSession('attract', defaultRoomSettings(), { token:()=>crypto.randomUUID() });
  for (let i=0;i<5;i++) host.command('attract',{type:'bot',action:'add'});
  host.command('attract',{type:'action',action:'start'});
  for(let i=0;i<90;i++) host.advance();
  const sprites=await loadThemeSprites(defaultTheme);
  let canvas=initialCanvas;
  const presentation=mountArenaPresentation(canvas,drawArena,replacement=>{canvas=replacement;});
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let paused=motion.matches, disposed=false, previous=performance.now(), accumulator=0,lastDraw=0,raf=0,dirty=true,lastRenderer:string|undefined;
  const label=()=>{toggle.textContent=paused?'▶ PLAY BACKGROUND':'Ⅱ PAUSE BACKGROUND';toggle.setAttribute('aria-pressed',String(paused));};
  const change=()=>{paused=motion.matches;dirty=true;label();};motion.addEventListener('change',change);
  toggle.onclick=()=>{paused=!paused;dirty=true;label();};label();
  const visibility=()=>{previous=performance.now();accumulator=0;};document.addEventListener('visibilitychange',visibility);
  const frame=(now:number)=>{
    if(disposed)return;
    const elapsed=Math.min(100,now-previous);previous=now;
    if(!document.hidden){
      if(!paused){accumulator+=elapsed;while(accumulator>=50){host.advance();accumulator-=50;}if(host.game.phase==='matchOver')host.command('attract',{type:'action',action:'rematch'});}
      if((!paused||dirty||canvas.dataset.renderer!==lastRenderer)&&now-lastDraw>=1000/30){const state=host.snapshot();presentation.render({...state,tick:host.game.tick,round:host.game.round},now,defaultTheme,sprites,host.game.matchId);canvas.dataset.attractTick=String(host.game.tick);lastDraw=now;dirty=false;lastRenderer=canvas.dataset.renderer;}
    }else accumulator=0;
    raf=requestAnimationFrame(frame);
  };
  raf=requestAnimationFrame(frame);
  return ()=>{disposed=true;cancelAnimationFrame(raf);motion.removeEventListener('change',change);document.removeEventListener('visibilitychange',visibility);toggle.onclick=null;presentation.destroy();};
}
