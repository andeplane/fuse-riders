import { RIDER_SPEED, RIDER_TURN_RATE } from '../shared/game.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
interface Controls { left:boolean;right:boolean }
interface Pose {x:number;y:number;angle:number}
interface Pending extends Controls {seq:number;at:number}
/** Predict only local motion. Confirmed death, portals and round changes reset prediction. */
export class LocalPrediction {
  private pose?:Pose;
  private shown?:Pose;
  private last=0;
  private authoritativeAt=0;
  private current:Controls={left:false,right:false};
  private pending:Pending[]=[];
  private scope='';
  private alive=false;
  private portal=0;
  correction=0;
  ackMs=0;
  constructor(private now:()=>number){}
  input(seq:number,left:boolean,right:boolean):void {
    const at=this.now();this.advance(at);this.current={left,right};this.pending.push({seq,left,right,at});
    if(this.pending.length>100)this.pending.shift();
  }
  accept(state:ViewSnapshot,id:string,ack:number):void {
    const player=state.players.find(player=>player.id===id);if(!player)return;
    const now=this.now(),scope=`${state.round}:${state.phase}`;
    const acknowledged=this.pending.find(input=>input.seq===ack);if(acknowledged)this.ackMs=now-acknowledged.at;
    this.pending=this.pending.filter(input=>input.seq>ack);
    const reset=!this.pose||scope!==this.scope||!player.alive||player.portalCooldownUntilTick>this.portal;
    this.scope=scope;this.portal=player.portalCooldownUntilTick;this.alive=player.alive&&state.phase==='playing';
    const pose:Pose={x:player.x,y:player.y,angle:player.angle};
    if(!reset&&this.alive&&this.pending.length){
      let at=Math.max(now-200,this.pending[0]!.at);let held:Controls=this.pending[0]!;
      for(const input of this.pending){if(input.at<at){held=input;continue;}move(pose,held,(input.at-at)/1000);at=input.at;held=input;}
      move(pose,held,Math.max(0,now-at)/1000);
    }
    this.correction=this.pose?Math.hypot(pose.x-this.pose.x,pose.y-this.pose.y):0;
    this.pose=pose;this.last=now;this.authoritativeAt=now;
    if(reset||this.correction>80)this.shown={...pose};
  }
  private advance(now:number):void {if(this.pose&&this.alive)move(this.pose,this.current,Math.max(0,Math.min(50,Math.min(now,this.authoritativeAt+200)-this.last))/1000);this.last=now;}
  render(state:ViewSnapshot,id:string):ViewSnapshot {
    this.advance(this.now());if(!this.pose||!this.alive)return state;
    if(!this.shown)this.shown={...this.pose};
    const amount=.5;this.shown.x+=(this.pose.x-this.shown.x)*amount;this.shown.y+=(this.pose.y-this.shown.y)*amount;this.shown.angle=this.pose.angle;
    return {...state,players:state.players.map(player=>player.id===id?{...player,...this.shown}:player)};
  }
}
function move(pose:Pose,controls:Controls,seconds:number):void {
  const steps=Math.max(1,Math.ceil(seconds/.016));const dt=seconds/steps;
  for(let i=0;i<steps;i++){pose.angle+=(Number(controls.right)-Number(controls.left))*RIDER_TURN_RATE*dt;pose.x+=Math.cos(pose.angle)*RIDER_SPEED*dt;pose.y+=Math.sin(pose.angle)*RIDER_SPEED*dt;}
}

/** A one-snapshot render buffer smooths remote riders between 10 Hz updates. */
export function interpolateWorld(older:ViewSnapshot|undefined,newer:ViewSnapshot,fraction:number):ViewSnapshot {
  if(!older||older.round!==newer.round||older.phase!=='playing'||newer.phase!=='playing')return newer;
  const f=Math.max(0,Math.min(1,fraction));
  return {...newer,players:newer.players.map(player=>{
    const previous=older.players.find(candidate=>candidate.id===player.id);
    if(!previous?.alive||!player.alive||previous.portalCooldownUntilTick!==player.portalCooldownUntilTick)return player;
    const delta=Math.atan2(Math.sin(player.angle-previous.angle),Math.cos(player.angle-previous.angle));
    return {...player,x:previous.x+(player.x-previous.x)*f,y:previous.y+(player.y-previous.y)*f,angle:previous.angle+delta*f};
  }),bombs:newer.bombs.map(bomb=>{
    const previous=older.bombs.find(candidate=>candidate.id===bomb.id);
    if(!bomb.shell||!previous?.shell)return bomb;
    return {...bomb,x:previous.x+(bomb.x-previous.x)*f,y:previous.y+(bomb.y-previous.y)*f};
  })};
}
