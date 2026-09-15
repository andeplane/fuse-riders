import { HostSession, type RoomCommand } from './host-session.js';
import { interpolateWorld } from './interpolate.js';
import { TICK_MS } from './rollback.js';
import { uuid } from '../shared/uuid.js';
import type { Callbacks } from './runtime.js';
import type { RoomSettings } from '../shared/room-settings.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';

export interface LocalRuntimeDependencies {
  now():number;
  hidden():boolean;
  token():string;
  schedule(callback:()=>void,intervalMs:number):()=>void;
  onVisibilityChange(callback:()=>void):()=>void;
  humanName?:string;
}
const browserDependencies:LocalRuntimeDependencies={
  now:()=>performance.now(),hidden:()=>document.hidden,token:uuid,
  schedule:(callback,ms)=>{const timer=setInterval(callback,ms);return()=>clearInterval(timer);},
  onVisibilityChange:callback=>{document.addEventListener('visibilitychange',callback);return()=>document.removeEventListener('visibilitychange',callback);},
};
/** Offline play: the same authority and fold as an online room, with no peers. */
export class LocalRuntime {
  readonly transport={id:'solo',hostId:'solo',grant:{incarnation:'local',epoch:1},sentBytes:0,
    stats:async()=>({direct:0,relayed:0,buffered:0})};
  private session?:HostSession;
  private cancelTick?:()=>void;
  private cancelVisibility?:()=>void;
  private lastAt=0;
  private accumulator=0;
  private paused=false;
  private previous?:ViewSnapshot;
  private current?:ViewSnapshot;
  constructor(private readonly settings:RoomSettings,private readonly callbacks:Callbacks,private readonly dependencies:LocalRuntimeDependencies=browserDependencies){}
  start():void {
    if(this.session)return;
    const session=new HostSession('solo',{...this.settings,mode:'devices',weights:{...this.settings.weights}},{token:()=>this.dependencies.token()});
    this.session=session;
    session.command('solo',{type:'join',name:this.dependencies.humanName?.trim().slice(0,20)||'You'});
    for(let i=0;i<4;i++)session.command('solo',{type:'bot',action:'add'});
    session.command('solo',{type:'action',action:'start'});session.advance();
    this.lastAt=this.dependencies.now();this.accumulator=0;this.paused=this.dependencies.hidden();
    this.callbacks.ready('solo',true);this.callbacks.status('Solo · you and four AI riders');this.publish();
    this.cancelVisibility=this.dependencies.onVisibilityChange(()=>this.visibilityChanged());
    this.cancelTick=this.dependencies.schedule(()=>this.tick(),10);
  }
  command(command:RoomCommand):boolean {
    const session=this.session;if(!session)return false;
    if(command.type==='input'&&(this.paused||this.dependencies.hidden()))return false;
    const effective=command.type==='settings'?{...command,settings:{...command.settings,mode:'devices' as const}}:command;
    const error=session.command('solo',effective);
    if(error){this.callbacks.status(error);return false;}
    if(command.type!=='input')this.publish();
    return true;
  }
  render():ViewSnapshot|undefined {return this.current&&interpolateWorld(this.previous,this.current,this.accumulator/TICK_MS);}
  /** The steer the fold currently holds for a rider; what the benchmark reports as applied motion. */
  held(id:string):{left:boolean;right:boolean}|undefined {const flags=this.session?.sim.state.streams.get(id)?.flags;return flags===undefined?undefined:{left:Boolean(flags&1),right:Boolean(flags&2)};}
  private visibilityChanged():void {
    if(!this.session)return;
    this.paused=this.dependencies.hidden();this.lastAt=this.dependencies.now();this.accumulator=0;this.publish();
  }
  private tick():void {
    const session=this.session;if(!session)return;
    const now=this.dependencies.now(),elapsed=now-this.lastAt;this.lastAt=now;
    if(this.dependencies.hidden()!==this.paused){this.visibilityChanged();return;}
    if(this.paused||elapsed<0||!Number.isFinite(elapsed)){this.accumulator=0;return;}
    this.accumulator+=Math.min(elapsed,100);
    while(this.accumulator>=TICK_MS){
      this.accumulator-=TICK_MS;
      const {matchId,round}=session.game;
      for(const event of session.advance())this.callbacks.event(event,matchId,round,session.tick);
      this.publish();
    }
  }
  private publish():void {
    const session=this.session;if(!session)return;
    const game=session.game;
    this.previous=this.current;this.current={...session.snapshot(),tick:game.tick,round:game.round};
    this.callbacks.state(this.current,session.settings,game.matchId);
  }
  stop():void {
    this.cancelTick?.();this.cancelVisibility?.();this.cancelTick=undefined;this.cancelVisibility=undefined;
    this.session=undefined;this.accumulator=0;
  }
}
