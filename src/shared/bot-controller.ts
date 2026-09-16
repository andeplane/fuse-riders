import { hypot2, sin, cos, atan2 } from './deterministic-math.js';
import { RIDER_RADIUS, RIDER_SPEED, RIDER_TURN_RATE, SELF_TRAIL_GRACE_TICKS, TRAIL_WIDTH, type BombState, type GameState, type InputIntent, type PlayerState } from './game.js';
import { BOMB_MAX_CHARGE_TICKS, BOMB_MIN_LAUNCH_DISTANCE, BOMB_MAX_LAUNCH_DISTANCE } from './bomb-launch.js';
import { advanceRiderPose } from './rider-motion.js';
import { drunkHeadingOffset } from './drunk.js';
import type { TrailSegment } from './protocol.js';

export const BOT_ID_PREFIX='bot:';
export const BOT_MAX_NEARBY_TRAILS=512;
/** Escape-room grid: one cell is the narrowest gap a rider fits through. */
export const BOT_ESCAPE_CELL=2*RIDER_RADIUS+TRAIL_WIDTH;
export const BOT_ESCAPE_ROOM_CELLS=480;

export type BotDifficulty='easy'|'medium'|'hard';
export const BOT_DIFFICULTIES=['easy','medium','hard'] as const;
/**
 * lookaheadTicks is how far the rider flies each candidate turn, escapeWeight how much it values having room left at
 * the end of it, and reactionTicks holds a decision for a few ticks so a weak rider answers late, as a distracted
 * human does. A deeper multi-turn search was measured against these and came out inside the noise, so it is not here.
 */
export interface BotTier { lookaheadTicks:number; escapeWeight:number; aimError:number; reactionTicks:number }
export const BOT_TIERS:Record<BotDifficulty,BotTier>={
  easy:{lookaheadTicks:6,escapeWeight:0,aimError:260,reactionTicks:4},
  medium:{lookaheadTicks:8,escapeWeight:300,aimError:110,reactionTicks:3},
  hard:{lookaheadTicks:10,escapeWeight:300,aimError:30,reactionTicks:1},
};
const DIFFICULTY_LABELS:Record<BotDifficulty,string>={easy:'Easy',medium:'Medium',hard:'Hard'};
export const BOT_NAMES=['Ada','Turing','Hopper','Nova','Byte'] as const;
/** The action log carries nothing per bot but its name, so the tier rides in the name: one writer, one reader, never out of step. */
export function botDisplayName(base:string,difficulty:BotDifficulty):string{return `AI ${base} · ${DIFFICULTY_LABELS[difficulty]}`;}
export function botDifficulty(name:string):BotDifficulty{return BOT_DIFFICULTIES.find(difficulty=>name.endsWith(`· ${DIFFICULTY_LABELS[difficulty]}`))??'medium';}
export function rollBotDifficulty(roll:number):BotDifficulty{return BOT_DIFFICULTIES[Math.min(BOT_DIFFICULTIES.length-1,Math.floor(Math.max(0,roll)*BOT_DIFFICULTIES.length))]!;}

export interface BotDependencies { random:(seed:number,id:string,tick:number)=>number }
/** Stateless separate random stream: AI decisions never consume pickup randomness. */
export function botRandom(seed:number,id:string,tick:number):number {
  let hash=(seed^tick)>>>0;
  for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),0x45d9f3b)>>>0;
  hash=Math.imul(hash^(hash>>>16),0x45d9f3b)>>>0;
  return ((hash^(hash>>>16))>>>0)/0x100000000;
}
const NEUTRAL:InputIntent={left:false,right:false,bomb:false};
const NEIGHBOURS=[[1,0],[-1,0],[0,1],[0,-1]] as const;
const squared=(x:number)=>x*x;
const clamped=(value:number)=>Math.max(0,Math.min(1,value));
function distanceToSegmentSquared(x:number,y:number,segment:TrailSegment):number {
  const dx=segment.x2-segment.x1,dy=segment.y2-segment.y1,length=dx*dx+dy*dy;
  const fraction=length?Math.max(0,Math.min(1,((x-segment.x1)*dx+(y-segment.y1)*dy)/length)):0;
  return squared(x-segment.x1-fraction*dx)+squared(y-segment.y1-fraction*dy);
}
function angleDifference(a:number,b:number):number{return atan2(sin(a-b),cos(a-b));}

interface Pose { x:number; y:number; angle:number; score:number; alive:boolean }
interface PlanContext {
  id:string; tier:BotTier; order:readonly number[];
  trails:{trail:TrailSegment;own:boolean}[]; enemies:readonly PlayerState[]; bombs:readonly BombState[];
  drunkStartedTick:number; drunkUntilTick:number; target?:{x:number;y:number};
}

/** A bounded controller which can only ask the normal simulation to steer/fire. */
export class BotController {
  constructor(private dependencies:BotDependencies={random:botRandom}){}
  private cols=0;private rows=0;private blocked=new Uint8Array(0);private visited=new Int32Array(0);private queue=new Int32Array(0);private stamp=0;
  private held=new Map<string,{at:number;left:boolean;right:boolean}>();

  /** Rasterise walls and the trails that outlive the lookahead, so the endpoint of a candidate turn can be asked how much room it still has. */
  private mapArena(game:Readonly<GameState>,id:string,horizon:number):void{
    const cols=Math.ceil(game.width/BOT_ESCAPE_CELL),rows=Math.ceil(game.height/BOT_ESCAPE_CELL);
    if(cols!==this.cols||rows!==this.rows){this.cols=cols;this.rows=rows;this.blocked=new Uint8Array(cols*rows);this.visited=new Int32Array(cols*rows);this.queue=new Int32Array(cols*rows);this.stamp=0;}
    const min=game.boundaryInset+RIDER_RADIUS,maxX=game.width-min,maxY=game.height-min;
    for(let index=0;index<this.blocked.length;index++){
      const cx=index%cols,x=(cx+.5)*BOT_ESCAPE_CELL,y=((index-cx)/cols+.5)*BOT_ESCAPE_CELL;
      this.blocked[index]=x<min||y<min||x>maxX||y>maxY?1:0;
    }
    const untilTick=game.tick+horizon;
    for(const owner of game.players.values())for(const trail of owner.trail){
      if(trail.expiresAtTick<=untilTick)continue;
      if(owner.id===id&&trail.createdTick>untilTick-SELF_TRAIL_GRACE_TICKS)continue;
      const steps=Math.max(1,Math.ceil(hypot2(trail.x2-trail.x1,trail.y2-trail.y1)/(BOT_ESCAPE_CELL/2)));
      for(let sample=0;sample<=steps;sample++){
        const fraction=sample/steps,cx=Math.floor((trail.x1+(trail.x2-trail.x1)*fraction)/BOT_ESCAPE_CELL),cy=Math.floor((trail.y1+(trail.y2-trail.y1)*fraction)/BOT_ESCAPE_CELL);
        if(cx>=0&&cy>=0&&cx<cols&&cy<rows)this.blocked[cy*cols+cx]=1;
      }
    }
  }
  /**
   * Room left in front of a rider: cells reachable from (x,y) facing `angle`, stopping at BOT_ESCAPE_ROOM_CELLS.
   * Space behind the facing plane is ignored because a rider needs ~107px to turn around, so a pocket it cannot
   * U-turn inside is fatal even when the mouth it came through is wide open.
   * ponytail: half-plane proxy for the real turn arc; swap for a (cell,heading) search if the AI still walls itself in.
   */
  private openCells(x:number,y:number,angle:number):number{
    const cols=this.cols,rows=this.rows,cx=Math.floor(x/BOT_ESCAPE_CELL),cy=Math.floor(y/BOT_ESCAPE_CELL);
    if(cx<0||cy<0||cx>=cols||cy>=rows)return 0;
    const dirX=cos(angle),dirY=sin(angle);
    const mark=++this.stamp;let head=0,tail=0,count=0;
    this.visited[cy*cols+cx]=mark;this.queue[tail++]=cy*cols+cx;
    while(head<tail&&count<BOT_ESCAPE_ROOM_CELLS){
      const index=this.queue[head++]!,cellX=index%cols,cellY=(index-cellX)/cols;count++;
      for(const [dx,dy] of NEIGHBOURS){
        const nextX=cellX+dx,nextY=cellY+dy;
        if(nextX<0||nextY<0||nextX>=cols||nextY>=rows)continue;
        const next=nextY*cols+nextX;
        if(this.visited[next]===mark||this.blocked[next])continue;
        if(((nextX+.5)*BOT_ESCAPE_CELL-x)*dirX+((nextY+.5)*BOT_ESCAPE_CELL-y)*dirY<-BOT_ESCAPE_CELL)continue;
        this.visited[next]=mark;this.queue[tail++]=next;
      }
    }
    return count;
  }
  private struck(game:Readonly<GameState>,context:PlanContext,x:number,y:number,tick:number,future:number):boolean{
    if(context.trails.some(({trail,own})=>trail.expiresAtTick>tick&&!(own&&trail.createdTick>tick-SELF_TRAIL_GRACE_TICKS)&&distanceToSegmentSquared(x,y,trail)<=squared(RIDER_RADIUS+TRAIL_WIDTH/2+2)))return true;
    if(context.enemies.some(enemy=>squared(x-(enemy.x+cos(enemy.angle)*RIDER_SPEED*future/20))+squared(y-(enemy.y+sin(enemy.angle)*RIDER_SPEED*future/20))<squared(RIDER_RADIUS*2+3)))return true;
    if(game.blasts.some(blast=>blast.expiresAtTick>tick&&hypot2(x-blast.circle.x,y-blast.circle.y)<blast.circle.radius+RIDER_RADIUS))return true;
    return context.bombs.some(bomb=>bomb.shell
      ?hypot2(x-(bomb.x+bomb.shell.vx*future/20),y-(bomb.y+bomb.shell.vy*future/20))<RIDER_RADIUS+18
      :bomb.explodeAtTick<=tick&&hypot2(x-bomb.x,y-bomb.y)<bomb.blastRange+RIDER_RADIUS);
  }
  /** One held turn, flown tick by tick against the real hazards: a coarse grid mistakes riding alongside a trail for a crash. */
  private advance(game:Readonly<GameState>,context:PlanContext,rider:PlayerState,direction:number):Pose{
    let x=rider.x,y=rider.y,angle=rider.angle,offset=rider.drunkHeadingOffset,score=0,alive=true;
    for(let step=1;step<=context.tier.lookaheadTicks;step++){
      const tick=game.tick+step;
      const drunk=drunkHeadingOffset(game.seed,context.id,tick,context.drunkStartedTick,context.drunkUntilTick);
      const pose=advanceRiderPose({x,y,angle,drunkHeadingOffset:offset},{left:direction<0,right:direction>0},{distance:RIDER_SPEED/20,turn:RIDER_TURN_RATE/20,drunkHeadingOffset:drunk});
      x=pose.x;y=pose.y;angle=pose.angle;offset=pose.drunkHeadingOffset;
      const clearance=Math.min(x-game.boundaryInset,game.width-game.boundaryInset-x,y-game.boundaryInset,game.height-game.boundaryInset-y)-RIDER_RADIUS;
      if(clearance<2||this.struck(game,context,x,y,tick,tick-game.tick)){alive=false;break;}
      score+=100+Math.min(80,clearance)*.05;
    }
    return {x,y,angle,score,alive};
  }
  private openness(context:PlanContext,pose:Pose):number{
    return context.tier.escapeWeight?this.openCells(pose.x,pose.y,pose.angle)/BOT_ESCAPE_ROOM_CELLS*context.tier.escapeWeight:0;
  }
  private pull(context:PlanContext,pose:Pose):number{
    return context.target?-hypot2(context.target.x-pose.x,context.target.y-pose.y)*.025:0;
  }

  input(game:Readonly<GameState>,id:string):InputIntent {
    const player=game.players.get(id);
    if(game.phase!=='playing'||!player?.alive||!player.connected)return{...NEUTRAL};
    const tier=BOT_TIERS[botDifficulty(player.name)];
    const enemies=[...game.players.values()].filter(candidate=>candidate.id!==id&&candidate.alive);
    const nearest=enemies.reduce<PlayerState|undefined>((best,candidate)=>!best||hypot2(candidate.x-player.x,candidate.y-player.y)<hypot2(best.x-player.x,best.y-player.y)?candidate:best,undefined);
    const pickup=game.pickups.reduce<GameState['pickups'][number]|undefined>((best,candidate)=>!best||hypot2(candidate.x-player.x,candidate.y-player.y)<hypot2(best.x-player.x,best.y-player.y)?candidate:best,undefined);
    const held=this.held.get(id);
    // Elapsed, never a deadline: returning to the lobby rewinds the clock and a stale deadline would freeze the rider mid-turn.
    const waited=held?game.tick-held.at:Infinity;
    const steering=waited>=0&&waited<tier.reactionTicks&&held?{left:held.left,right:held.right}:this.steer(game,id,player,tier,enemies,nearest,pickup??nearest);
    const intent:InputIntent={...steering,bomb:false};
    if(!nearest||game.tick<player.bombReadyAtTick)return intent;
    const distance=hypot2(nearest.x-player.x,nearest.y-player.y);
    const bearing=atan2(nearest.y-player.y,nearest.x-player.x);
    const aimed=player.targetBombArmed&&!player.gunArmed&&!player.shellArmed;
    // One fixed miss per shot: the cooldown stamp is stable while charging, so a weak rider commits to its bad aim.
    const scatter=(axis:string)=>(Math.max(0,Math.min(1,this.dependencies.random(game.seed,id+axis,player.bombReadyAtTick)))*2-1)*tier.aimError;
    const aim=aimed?{x:clamped((nearest.x+scatter(':aimX'))/game.width),y:clamped((nearest.y+scatter(':aimY'))/game.height)}:undefined;
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

  private steer(game:Readonly<GameState>,id:string,player:PlayerState,tier:BotTier,enemies:readonly PlayerState[],nearest?:PlayerState,target?:{x:number;y:number}):{left:boolean;right:boolean}{
    const horizon=tier.lookaheadTicks;
    const reach=horizon*RIDER_SPEED/20+RIDER_RADIUS+TRAIL_WIDTH;
    const trails=[...game.players.values()].flatMap(owner=>owner.trail.map(trail=>({trail,own:owner.id===id,distance:distanceToSegmentSquared(player.x,player.y,trail)})))
      .filter(candidate=>candidate.distance<reach*reach).sort((a,b)=>a.distance-b.distance).slice(0,BOT_MAX_NEARBY_TRAILS);
    this.mapArena(game,id,horizon);
    const random=Math.max(0,Math.min(1,this.dependencies.random(game.seed,id,game.tick)));
    const context:PlanContext={id,tier,order:random<.5?[0,-1,1]:[0,1,-1],trails,enemies,bombs:[...game.bombs.values()],
      drunkStartedTick:player.drunkStartedTick,drunkUntilTick:player.drunkUntilTick,target};
    let chosen=0,best=-Infinity;
    for(const direction of context.order){
      const pose=this.advance(game,context,player,direction);
      const value=pose.score+this.openness(context,pose)+this.pull(context,pose)+(direction===0&&pose.alive?1:0);
      if(value>best){best=value;chosen=direction;}
    }
    const steering={left:chosen<0,right:chosen>0};
    this.held.set(id,{at:game.tick,...steering});
    return steering;
  }
}
