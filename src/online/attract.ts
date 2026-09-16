import { uuid } from '../shared/uuid.js';
import { World } from './rollback.js';
import { BOT_NAMES, createRoomState } from '../shared/apply-tick.js';
import { ACTION, BOT } from '../shared/input-log.js';
import { defaultRoomSettings } from '../shared/room-settings.js';
import { mountArenaPresentation } from '../client/phaser/presentation.js';
import { drawArena } from '../client/main.js';
import { loadThemeSprites, selectedTheme } from '../client/themes.js';

/** A separate, silent local game on the shared log core. It never opens a room or a connection. */
export async function startAttract(initialCanvas: HTMLCanvasElement, toggle: HTMLButtonElement): Promise<()=>void> {
  const world = new World(createRoomState(uuid(), defaultRoomSettings()), 'attract', 'attract');
  const log = world.stream('attract', 1);
  for (let slot = 0; slot < 5; slot++) log.append(1, [BOT, 'add', `bot:${slot + 1}`, `AI ${BOT_NAMES[slot]}`, slot]);
  log.append(2, [ACTION, 'start', uuid()]);
  let target = 92; world.advance(target);
  const theme=selectedTheme();const sprites=await loadThemeSprites(theme);
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
      if(!paused){
        accumulator+=elapsed;while(accumulator>=50){target++;accumulator-=50;}
        const game=world.state.game;
        if(game.phase==='matchOver'&&game.tick>=(game.phaseEndsAtTick??0))log.append(world.tick+1,[ACTION,'rematch',uuid()]);
        world.advance(target);
      }
      if((!paused||dirty||canvas.dataset.renderer!==lastRenderer)&&now-lastDraw>=1000/30){const view=world.view()[0]!;presentation.render(view,now,theme,sprites,view.matchId);canvas.dataset.attractTick=String(world.tick);lastDraw=now;dirty=false;lastRenderer=canvas.dataset.renderer;}
    }else accumulator=0;
    raf=requestAnimationFrame(frame);
  };
  raf=requestAnimationFrame(frame);
  return ()=>{disposed=true;cancelAnimationFrame(raf);motion.removeEventListener('change',change);document.removeEventListener('visibilitychange',visibility);toggle.onclick=null;presentation.destroy();};
}
