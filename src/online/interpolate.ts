import type { ViewSnapshot } from '../client/snapshot-stream.js';
/** All discrete state belongs to the earlier tick; never expose future trail/death state. */
export function interpolateWorld(older:ViewSnapshot|undefined,newer:ViewSnapshot,fraction:number):ViewSnapshot {
  if(!older||older.round!==newer.round||older.phase!==newer.phase||fraction>=1)return newer;
  const f=Math.max(0,Math.min(1,fraction));
  return {...older,tick:older.tick+(newer.tick-older.tick)*f,players:older.players.map(previous=>{
    const player=newer.players.find(p=>p.id===previous.id);
    if(!player||!previous.alive||!player.alive||previous.portalCooldownUntilTick!==player.portalCooldownUntilTick)return previous;
    const delta=Math.atan2(Math.sin(player.angle-previous.angle),Math.cos(player.angle-previous.angle));
    return {...previous,x:previous.x+(player.x-previous.x)*f,y:previous.y+(player.y-previous.y)*f,angle:previous.angle+delta*f};
  }),bombs:older.bombs.map(previous=>{
    const bomb=newer.bombs.find(b=>b.id===previous.id);
    if(!bomb?.shell||!previous.shell||bomb.shell.vx!==previous.shell.vx||bomb.shell.vy!==previous.shell.vy)return previous;
    return {...previous,x:previous.x+(bomb.x-previous.x)*f,y:previous.y+(bomb.y-previous.y)*f};
  })};
}
