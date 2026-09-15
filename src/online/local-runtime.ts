import { uuid } from '../shared/uuid.js';
import { HostSession, type RoomCommand } from './host-session.js';
import type { Callbacks } from './runtime.js';
import type { RoomSettings } from '../shared/room-settings.js';

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
/** Offline authority using the same command ledger and physics as online rooms. */
export class LocalRuntime {
  readonly transport={id:'solo',hostId:'solo',grant:{incarnation:'local',epoch:1},sentBytes:0,
    stats:async()=>({direct:0,relayed:0,buffered:0})};
  private session?:HostSession;
  private cancelTick?:()=>void;
  private cancelVisibility?:()=>void;
  private lastAt=0;
  private accumulator=0;
  private paused=false;
  constructor(private readonly settings:RoomSettings,private readonly callbacks:Callbacks,private readonly dependencies:LocalRuntimeDependencies=browserDependencies){}
  start():void {
    if(this.session)return;
    const session=new HostSession('solo',{...this.settings,mode:'devices',weights:{...this.settings.weights}},{token:()=>this.dependencies.token()});
    this.session=session;
    session.command('solo',{type:'join',name:this.dependencies.humanName?.trim().slice(0,20)||'You'});
    for(let i=0;i<4;i++)session.command('solo',{type:'bot',action:'add'});
    session.command('solo',{type:'action',action:'start'});
    this.lastAt=this.dependencies.now();this.accumulator=0;this.paused=this.dependencies.hidden();
    this.callbacks.ready('solo',true);this.callbacks.status('Solo · you and four AI riders');this.publish();
    this.cancelVisibility=this.dependencies.onVisibilityChange(()=>this.visibilityChanged());
    this.cancelTick=this.dependencies.schedule(()=>this.tick(),10);
  }
  command(command:RoomCommand):boolean {
    const session=this.session;if(!session)return false;
    if(command.type==='input'&&(this.paused||this.dependencies.hidden()))return false;
    // The authority is in-process: an input reaches it before the next advance whatever the wall-clock estimate said.
    // When the main thread stalls, the extrapolated estimate runs ahead of the clamped 100 ms catch-up and the
    // authority would refuse the sample as future, losing one-shot fire edges for good (#43).
    const effective=command.type==='settings'?{...command,settings:{...command.settings,mode:'devices' as const}}:command.type==='input'?{...command,intendedTick:session.game.tick+1}:command;
    const error=session.command('solo',effective);
    if(error){this.callbacks.status(error);return false;}
    if(command.type!=='input')this.publish();
    return true;
  }
  private visibilityChanged():void {
    if(!this.session)return;
    this.paused=this.dependencies.hidden();this.lastAt=this.dependencies.now();this.accumulator=0;
    this.session.clear();this.publish();
  }
  private tick():void {
    const session=this.session;if(!session)return;
    const now=this.dependencies.now(),elapsed=now-this.lastAt;this.lastAt=now;
    if(this.dependencies.hidden()!==this.paused){this.visibilityChanged();return;}
    if(this.paused||elapsed<0||!Number.isFinite(elapsed)){this.accumulator=0;return;}
    this.accumulator+=Math.min(elapsed,100);
    while(this.accumulator>=50){
      this.accumulator-=50;
      for(const event of session.advance())this.callbacks.event(event,session.game.matchId,session.game.round,session.game.tick);
      this.publish();
    }
  }
  private publish():void {
    const session=this.session;if(!session)return;
    const game=session.game,at=this.dependencies.now();
    this.callbacks.state({...session.snapshot(),tick:game.tick,round:game.round},session.settings,session.acknowledgements().solo??-1,game.matchId,session.appliedMotion('solo'));
    const scope=session.controlScope('solo');
    if(scope)this.callbacks.clock?.({scope,localSentAt:at,localReceivedAt:at,authorityTick:game.tick+this.accumulator/50,paused:this.paused||game.phase!=='playing'});
  }
  stop():void {
    this.cancelTick?.();this.cancelVisibility?.();this.cancelTick=undefined;this.cancelVisibility=undefined;
    this.session?.clear();this.session=undefined;this.accumulator=0;
  }
}
