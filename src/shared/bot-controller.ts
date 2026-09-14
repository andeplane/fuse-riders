import { RIDER_RADIUS, RIDER_SPEED, RIDER_TURN_RATE, SELF_TRAIL_GRACE_TICKS, TRAIL_WIDTH, type GameState, type InputIntent, type PlayerState } from './game.js';
import { BOMB_MAX_CHARGE_TICKS, BOMB_MIN_LAUNCH_DISTANCE, BOMB_MAX_LAUNCH_DISTANCE } from './bomb-launch.js';
import { advanceRiderPose } from './rider-motion.js';
import { drunkHeadingOffset } from './drunk.js';
import type { TrailSegment } from './protocol.js';

export const BOT_ID_PREFIX='bot:';
export const BOT_LOOKAHEAD_TICKS=16;
export const BOT_MAX_NEARBY_TRAILS=512;
export interface BotDependencies { random:(seed:number,id:string,tick:number)=>number }
/** Stateless separate random stream: AI decisions never consume pickup randomness. */
export function botRandom(seed:number,id:string,tick:number):number {
  let hash=(seed^tick)>>>0;
  for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),0x45d9f3b)>>>0;
  hash=Math.imul(hash^(hash>>>16),0x45d9f3b)>>>0;
  return ((hash^(hash>>>16))>>>0)/0x100000000;
}
const NEUTRAL:InputIntent={left:false,right:false,bomb:false};
const squared=(x:number)=>x*x;
function distanceToSegmentSquared(x:number,y:number,segment:TrailSegment):number {
  const dx=segment.x2-segment.x1,dy=segment.y2-segment.y1,length=dx*dx+dy*dy;
  const fraction=length?Math.max(0,Math.min(1,((x-segment.x1)*dx+(y-segment.y1)*dy)/length)):0;
  return squared(x-segment.x1-fraction*dx)+squared(y-segment.y1-fraction*dy);
}
function angleDifference(a:number,b:number):number{return Math.atan2(Math.sin(a-b),Math.cos(a-b));}

/** A bounded controller which can only ask the normal simulation to steer/fire. */
export class BotController {
  constructor(private dependencies:BotDependencies={random:botRandom}){}
  input(game:Readonly<GameState>,id:string):InputIntent {
    const player=game.players.get(id);
    if(game.phase!=='playing'||!player?.alive||!player.connected)return{...NEUTRAL};
    const enemies=[...game.players.values()].filter(candidate=>candidate.id!==id&&candidate.alive);
    const nearest=enemies.reduce<PlayerState|undefined>((best,candidate)=>!best||Math.hypot(candidate.x-player.x,candidate.y-player.y)<Math.hypot(best.x-player.x,best.y-player.y)?candidate:best,undefined);
    const pickup=game.pickups.reduce<GameState['pickups'][number]|undefined>((best,candidate)=>!best||Math.hypot(candidate.x-player.x,candidate.y-player.y)<Math.hypot(best.x-player.x,best.y-player.y)?candidate:best,undefined);
    const target=pickup??nearest;
    const reach=BOT_LOOKAHEAD_TICKS*RIDER_SPEED/20+RIDER_RADIUS+TRAIL_WIDTH;
    const trails=[...game.players.values()].flatMap(owner=>owner.trail.map(trail=>({trail,own:owner.id===id,distance:distanceToSegmentSquared(player.x,player.y,trail)})))
      .filter(candidate=>candidate.distance<reach*reach).sort((a,b)=>a.distance-b.distance).slice(0,BOT_MAX_NEARBY_TRAILS);
    const random=Math.max(0,Math.min(1,this.dependencies.random(game.seed,id,game.tick)));
    const directions:readonly number[]=random<.5?[0,-1,1]:[0,1,-1];
    let chosen=0,best=-Infinity;
    for(const direction of directions){
      let x=player.x,y=player.y,angle=player.angle,previousOffset=player.drunkHeadingOffset,score=0,survived=0;
      for(let future=1;future<=BOT_LOOKAHEAD_TICKS;future++){
        const tick=game.tick+future;
        const offset=drunkHeadingOffset(game.seed,id,tick,player.drunkStartedTick,player.drunkUntilTick);
        const pose=advanceRiderPose({x,y,angle,drunkHeadingOffset:previousOffset},{left:direction<0,right:direction>0},{distance:RIDER_SPEED/20,turn:RIDER_TURN_RATE/20,drunkHeadingOffset:offset});
        x=pose.x;y=pose.y;angle=pose.angle;previousOffset=pose.drunkHeadingOffset;
        const clearance=Math.min(x-game.boundaryInset,game.width-game.boundaryInset-x,y-game.boundaryInset,game.height-game.boundaryInset-y)-RIDER_RADIUS;
        if(clearance<2)break;
        if(trails.some(({trail,own})=>trail.expiresAtTick>tick&&!(own&&trail.createdTick>tick-SELF_TRAIL_GRACE_TICKS)&&distanceToSegmentSquared(x,y,trail)<=squared(RIDER_RADIUS+TRAIL_WIDTH/2+2)))break;
        if(enemies.some(enemy=>squared(x-(enemy.x+Math.cos(enemy.angle)*RIDER_SPEED*future/20))+squared(y-(enemy.y+Math.sin(enemy.angle)*RIDER_SPEED*future/20))<squared(RIDER_RADIUS*2+3)))break;
        if(game.blasts.some(blast=>blast.expiresAtTick>tick&&Math.hypot(x-blast.circle.x,y-blast.circle.y)<blast.circle.radius+RIDER_RADIUS))break;
        if([...game.bombs.values()].some(bomb=>bomb.shell
          ?Math.hypot(x-(bomb.x+bomb.shell.vx*future/20),y-(bomb.y+bomb.shell.vy*future/20))<RIDER_RADIUS+18
          :bomb.explodeAtTick<=tick&&Math.hypot(x-bomb.x,y-bomb.y)<bomb.blastRange+RIDER_RADIUS))break;
        score+=100+Math.min(80,clearance)*.05;survived++;
      }
      if(target)score-=Math.hypot(target.x-x,target.y-y)*.025;
      if(direction===0&&survived===BOT_LOOKAHEAD_TICKS)score+=1;
      if(score>best){best=score;chosen=direction;}
    }
    const intent:InputIntent={left:chosen<0,right:chosen>0,bomb:false};
    if(!nearest||game.tick<player.bombReadyAtTick)return intent;
    const distance=Math.hypot(nearest.x-player.x,nearest.y-player.y);
    const bearing=Math.atan2(nearest.y-player.y,nearest.x-player.x);
    const aimed=player.targetBombArmed&&!player.gunArmed&&!player.shellArmed;
    const aim=aimed?{x:Math.max(0,Math.min(1,nearest.x/game.width)),y:Math.max(0,Math.min(1,nearest.y/game.height))}:undefined;
    const maxChargeTicks=game.settings?.bombChargeTicks??BOMB_MAX_CHARGE_TICKS;
    const wantedCharge=aimed||player.gunArmed||player.shellArmed?1:Math.max(1,Math.min(maxChargeTicks,Math.round((distance-BOMB_MIN_LAUNCH_DISTANCE)/(BOMB_MAX_LAUNCH_DISTANCE-BOMB_MIN_LAUNCH_DISTANCE)*maxChargeTicks)));
    if(player.bombChargeStartedTick!==undefined){
      const release=game.tick-player.bombChargeStartedTick>=wantedCharge;
      return{...intent,bomb:!release,...(aim?{aim}:{}),...(release?{bombCommands:[{action:'release',...(aim?{aim}:{})}]}:{})};
    }
    if(aimed||(distance<500&&Math.abs(angleDifference(bearing,player.angle))<.6)){
      return{...intent,bomb:true,...(aim?{aim}:{}),bombCommands:[{action:'press',...(aim?{aim}:{})}]};
    }
    return intent;
  }
}
