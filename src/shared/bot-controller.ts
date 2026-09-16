import { hypot2, sin, cos, atan2 } from './deterministic-math.js';
import { RIDER_RADIUS, BOOST_SPEED, RIDER_SPEED, riderTurnRate, SELF_TRAIL_GRACE_TICKS, TRAIL_WIDTH, TICK_HZ, OVERTIME_START_TICK, OVERTIME_INSET_PER_TICK, segmentDistanceSquared, type GameState, type InputIntent, type PlayerState } from './game.js';
import { BOMB_MAX_CHARGE_TICKS, BOMB_MIN_LAUNCH_DISTANCE, BOMB_MAX_LAUNCH_DISTANCE } from './bomb-launch.js';
import { advanceRiderPose } from './rider-motion.js';
import { drunkHeadingOffset } from './drunk.js';
import type { TrailSegment } from './protocol.js';

export const BOT_ID_PREFIX='bot:';
export const BOT_LOOKAHEAD_TICKS=32;
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
function angleDifference(a:number,b:number):number{return atan2(sin(a-b),cos(a-b));}

interface SteeringPlan { direction:number; turnTicks:number }
const TURN_DURATIONS=[2,4,8,12,16,24,BOT_LOOKAHEAD_TICKS] as const;
const SAFETY_MARGIN=2;
const TRAIL_CLEARANCE=RIDER_RADIUS+TRAIL_WIDTH/2+SAFETY_MARGIN;

/** Replan every tick, but evaluate short turns followed by straight escape paths. */
function chooseSteering(game:Readonly<GameState>,player:PlayerState,enemies:PlayerState[],target:{x:number;y:number}|undefined,random:number):number {
  const reach=BOT_LOOKAHEAD_TICKS*RIDER_SPEED*BOOST_SPEED/TICK_HZ+TRAIL_CLEARANCE;
  const trails=[...game.players.values()].flatMap(owner=>owner.trail.map(trail=>({trail,own:owner.id===player.id,distance:distanceToSegmentSquared(player.x,player.y,trail)})))
    .filter(candidate=>candidate.trail.expiresAtTick>game.tick&&candidate.distance<reach*reach)
    .sort((a,b)=>a.distance-b.distance).slice(0,BOT_MAX_NEARBY_TRAILS);
  // Assume visible opponents continue straight; never inspect their queued inputs.
  // Their predicted trail remains dangerous after their head has passed a crossing.
  const enemyPaths=enemies.filter(enemy=>squared(enemy.x-player.x)+squared(enemy.y-player.y)<squared(reach*2)).map(enemy=>{
    let pose={x:enemy.x,y:enemy.y,angle:enemy.angle,drunkHeadingOffset:enemy.drunkHeadingOffset};
    const path=Array.from({length:BOT_LOOKAHEAD_TICKS},(_,index)=>{
      const tick=game.tick+index+1,previous=pose;
      pose=advanceRiderPose(previous,NEUTRAL,{distance:(enemy.boostUntilTick>tick?RIDER_SPEED*BOOST_SPEED:RIDER_SPEED)/TICK_HZ,
        turn:riderTurnRate(enemy)/TICK_HZ,drunkHeadingOffset:drunkHeadingOffset(game.seed,enemy.id,tick,enemy.drunkStartedTick,enemy.drunkUntilTick)});
      return {x1:previous.x,y1:previous.y,x2:pose.x,y2:pose.y,createdTick:tick,expiresAtTick:tick+BOT_LOOKAHEAD_TICKS};
    });
    return {path,straight:enemy.drunkUntilTick<=game.tick&&enemy.drunkHeadingOffset===0};
  });
  const directions=random<.5?[-1,1]:[1,-1];
  const plans:SteeringPlan[]=[{direction:0,turnTicks:0},...directions.flatMap(direction=>TURN_DURATIONS.map(turnTicks=>({direction,turnTicks})))];
  const bombs=[...game.bombs.values()];
  let chosen=0,bestSurvived=-1,bestScore=-Infinity;
  for(const plan of plans){
    let pose={x:player.x,y:player.y,angle:player.angle,drunkHeadingOffset:player.drunkHeadingOffset},score=0,survived=0;
    const ownPath:TrailSegment[]=[];
    for(let future=1;future<=BOT_LOOKAHEAD_TICKS;future++){
      const tick=game.tick+future,previous=pose;
      const distance=(player.boostUntilTick>tick?RIDER_SPEED*BOOST_SPEED:RIDER_SPEED)/TICK_HZ;
      pose=advanceRiderPose(previous,{left:plan.direction<0&&future<=plan.turnTicks,right:plan.direction>0&&future<=plan.turnTicks},
        {distance,turn:riderTurnRate(player)/TICK_HZ,drunkHeadingOffset:drunkHeadingOffset(game.seed,player.id,tick,player.drunkStartedTick,player.drunkUntilTick)});
      const {x,y}=pose;
      const elapsed=game.tick-(game.roundStartedTick??game.tick);
      const inset=game.boundaryInset+(Math.max(0,elapsed+future-OVERTIME_START_TICK)-Math.max(0,elapsed-OVERTIME_START_TICK))*OVERTIME_INSET_PER_TICK;
      let clearance=Math.min(x-inset,game.width-inset-x,y-inset,game.height-inset-y)-RIDER_RADIUS;
      if(clearance<SAFETY_MARGIN)break;
      let trailDistanceSquared=Infinity;
      const hitsTrail=(trail:TrailSegment)=>{
        const endpointDistance=distanceToSegmentSquared(x,y,trail);
        trailDistanceSquared=Math.min(trailDistanceSquared,endpointDistance);
        // Only nearby endpoints need the exact swept test. The extra step distance
        // prevents tunnelling past short segments between prediction samples.
        return endpointDistance<=squared(TRAIL_CLEARANCE+distance)&&segmentDistanceSquared(previous.x,previous.y,x,y,trail.x1,trail.y1,trail.x2,trail.y2)<=squared(TRAIL_CLEARANCE);
      };
      if(trails.some(({trail,own})=>trail.expiresAtTick>tick&&!(own&&trail.createdTick>tick-SELF_TRAIL_GRACE_TICKS)&&hitsTrail(trail)))break;
      if(ownPath.some(trail=>trail.createdTick<=tick-SELF_TRAIL_GRACE_TICKS&&hitsTrail(trail)))break;
      if(enemyPaths.some(({path,straight})=>{
        const head=path[future-1]!;
        if(distanceToSegmentSquared(x,y,head)<=squared(RIDER_RADIUS*2+SAFETY_MARGIN+distance)&&segmentDistanceSquared(previous.x,previous.y,x,y,head.x1,head.y1,head.x2,head.y2)<=squared(RIDER_RADIUS*2+SAFETY_MARGIN))return true;
        // Collinear predicted segments form one exact trail, even across boost expiry.
        if(straight)return future>1&&hitsTrail({...head,x1:path[0]!.x1,y1:path[0]!.y1,x2:head.x1,y2:head.y1});
        for(let index=0;index<future-1;index++)if(hitsTrail(path[index]!))return true;
        return false;
      }))break;
      if(game.blasts.some(blast=>blast.expiresAtTick>tick&&distanceToSegmentSquared(blast.circle.x,blast.circle.y,{x1:previous.x,y1:previous.y,x2:x,y2:y,createdTick:tick,expiresAtTick:tick})<squared(blast.circle.radius+RIDER_RADIUS)))break;
      if(bombs.some(bomb=>bomb.shell
        ?segmentDistanceSquared(previous.x,previous.y,x,y,bomb.x+bomb.shell.vx*(future-1)/TICK_HZ,bomb.y+bomb.shell.vy*(future-1)/TICK_HZ,bomb.x+bomb.shell.vx*future/TICK_HZ,bomb.y+bomb.shell.vy*future/TICK_HZ)<squared(RIDER_RADIUS+18)
        :bomb.explodeAtTick<=tick&&hypot2(x-bomb.x,y-bomb.y)<bomb.blastRange+RIDER_RADIUS))break;
      clearance=Math.min(clearance,Math.sqrt(trailDistanceSquared)-RIDER_RADIUS-TRAIL_WIDTH/2);
      score+=Math.min(60,clearance)*.05;
      survived++;
      ownPath.push({x1:previous.x,y1:previous.y,x2:x,y2:y,createdTick:tick,expiresAtTick:tick+BOT_LOOKAHEAD_TICKS});
    }
    if(target&&survived===BOT_LOOKAHEAD_TICKS)score-=hypot2(target.x-pose.x,target.y-pose.y)*.025;
    if(plan.direction===0&&survived===BOT_LOOKAHEAD_TICKS)score+=1;
    // Survival is lexicographic: a pickup or extra clearance can never buy a
    // shorter predicted life. Among equally safe paths, prefer breathing room.
    if(survived>bestSurvived||(survived===bestSurvived&&score>bestScore)){
      bestSurvived=survived;bestScore=score;chosen=plan.direction;
    }
  }
  return chosen;
}

/** A bounded controller which can only ask the normal simulation to steer/fire. */
export class BotController {
  constructor(private dependencies:BotDependencies={random:botRandom}){}
  input(game:Readonly<GameState>,id:string):InputIntent {
    const player=game.players.get(id);
    if(game.phase!=='playing'||!player?.alive||!player.connected)return{...NEUTRAL};
    const enemies=[...game.players.values()].filter(candidate=>candidate.id!==id&&candidate.alive);
    const nearest=enemies.reduce<PlayerState|undefined>((best,candidate)=>!best||hypot2(candidate.x-player.x,candidate.y-player.y)<hypot2(best.x-player.x,best.y-player.y)?candidate:best,undefined);
    const pickup=game.pickups.filter(candidate=>candidate.type!=='grip'||!player.grip).reduce<GameState['pickups'][number]|undefined>((best,candidate)=>!best||hypot2(candidate.x-player.x,candidate.y-player.y)<hypot2(best.x-player.x,best.y-player.y)?candidate:best,undefined);
    const target=pickup??nearest;
    const chosen=chooseSteering(game,player,enemies,target,this.dependencies.random(game.seed,id,game.tick));
    const intent:InputIntent={left:chosen<0,right:chosen>0,bomb:false};
    if(!nearest||game.tick<player.bombReadyAtTick)return intent;
    const distance=hypot2(nearest.x-player.x,nearest.y-player.y);
    const bearing=atan2(nearest.y-player.y,nearest.x-player.x);
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
