import test from 'node:test';
import assert from 'node:assert/strict';
import { ControllerInputState, TRAILING_RESENDS, type ControllerInputMessage } from '../src/client/controller-state.js';
import { HostSession, type RoomCommand } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { BOMB_MIN_LAUNCH_DISTANCE } from '../src/shared/bomb-launch.js';

type Input=Extract<RoomCommand,{type:'input'}>;
function fixture(){
 const session=new HostSession('host',{...defaultRoomSettings(),weights:{}},{token:()=> 'fire-delivery'});session.command('host',{type:'join',name:'Host'});session.command('guest',{type:'join',name:'Guest'});session.command('host',{type:'action',action:'start'});while(session.game.phase==='countdown')session.advance();
 let drop:(m:ControllerInputMessage)=>boolean=()=>false;const sent:Input[]=[];
 const controller=new ControllerInputState({send:message=>{const packet:Input={...message,scope:session.controlScope('host')!,intendedTick:session.game.tick+1};sent.push(packet);if(drop(message))return false;return !session.command('host',packet);}},()=>session.game.tick*50);
 controller.clear(true,true);session.advance();
 return {session,controller,sent,drop:(predicate:typeof drop)=>{drop=predicate;},deliver:(packet:Input)=>session.command('host',packet),player:()=>session.game.players.get('host')!,bombs:()=>session.game.bombs.size};
}
function pump(f:ReturnType<typeof fixture>,count:number){for(let i=0;i<count;i++){f.controller.resend();f.session.advance();}}

test('a lost press is recreated by the next held resend and the release fires with that charge',()=>{
 const f=fixture();let dropped=0;f.drop(m=>m.bombAction==='press'&&dropped++===0);
 assert.equal(f.controller.pointerDown(1,'bomb'),false);f.session.advance();assert.equal(f.player().bombChargeStartedTick,undefined);
 pump(f,1);const started=f.player().bombChargeStartedTick;assert.notEqual(started,undefined);
 pump(f,5);assert.equal(f.player().bombChargeStartedTick,started,'resends of a known gesture never restart its charge');
 f.controller.pointerRelease(1);f.session.advance();assert.equal(f.bombs(),1);
});
test('a tap whose press and every resend were lost still fires once, at minimum charge, from the release',()=>{
 const f=fixture();f.drop(m=>m.bomb);f.controller.pointerDown(1,'bomb');f.controller.pointerRelease(1);f.session.advance();
 assert.equal(f.bombs(),1);const bomb=[...f.session.game.bombs.values()][0]!;
 assert.ok(Math.abs(Math.hypot(bomb.x-bomb.launchX,bomb.y-bomb.launchY)-BOMB_MIN_LAUNCH_DISTANCE)<1e-6);
 pump(f,TRAILING_RESENDS+2);assert.equal(f.bombs(),1,'the repeated release is idempotent');assert.equal(f.player().bombChargeStartedTick,undefined);
});
test('a lost release is delivered by the trailing resends and fires exactly once',()=>{
 const f=fixture();f.controller.pointerDown(1,'bomb');f.session.advance();let dropped=0;f.drop(m=>m.bombAction==='release'&&dropped++===0);
 assert.equal(f.controller.pointerRelease(1),false);f.session.advance();assert.equal(f.bombs(),0);
 assert.equal(f.controller.resend(),true);f.session.advance();assert.equal(f.bombs(),1);
 pump(f,TRAILING_RESENDS+2);assert.equal(f.bombs(),1);assert.equal(f.player().bombChargeStartedTick,undefined);
 assert.equal(f.controller.resend(),false,'idle after the trailing resends');
});
test('steering resends after a lost release restate the release instead of cancelling the shot',()=>{
 const f=fixture();f.controller.pointerDown(1,'left');f.controller.pointerDown(2,'bomb');f.session.advance();let dropped=0;f.drop(m=>m.bombAction==='release'&&dropped++===0);
 f.controller.pointerRelease(2);f.controller.resend();f.session.advance();
 assert.equal(f.bombs(),1);assert.equal(f.session.appliedMotion('host')!.held.left,true);
});
test('reordered and duplicated packets apply once, in sequence order',()=>{
 const f=fixture();f.drop(()=>true);
 f.controller.pointerDown(1,'bomb');const press=f.sent.at(-1)!;f.controller.resend();const hold=f.sent.at(-1)!;f.controller.pointerRelease(1);const release=f.sent.at(-1)!;
 f.deliver(hold);f.deliver(release);f.deliver(press);f.session.advance();assert.equal(f.bombs(),1);
 f.deliver(release);f.deliver(hold);f.deliver(press);f.session.advance();assert.equal(f.bombs(),1);assert.equal(f.player().bombChargeStartedTick,undefined);
});
test('late and far-future input is applied inside the window instead of being rejected',()=>{
 const f=fixture();f.drop(()=>true);f.controller.pointerDown(1,'bomb');const press=f.sent.at(-1)!;f.controller.pointerRelease(1);const release=f.sent.at(-1)!;
 assert.equal(f.deliver({...press,intendedTick:f.session.game.tick-30}),undefined);f.session.advance();assert.notEqual(f.player().bombChargeStartedTick,undefined);
 assert.equal(f.deliver({...release,intendedTick:f.session.game.tick+40}),undefined);
 for(let i=0;i<3;i++){f.session.advance();assert.equal(f.bombs(),0);}
 f.session.advance();assert.equal(f.bombs(),1);
});
test('a finished gesture is forgotten with the control scope, so a reset cannot invent a phantom shot',()=>{
 const f=fixture();f.controller.pointerDown(1,'bomb');f.session.advance();f.controller.pointerRelease(1);f.session.advance();assert.equal(f.bombs(),1);
 f.session.clear();f.controller.forgetFinishedGesture();f.controller.pointerDown(2,'left');f.session.advance();
 assert.equal(f.bombs(),1);assert.equal(f.player().bombChargeStartedTick,undefined);
});
test('a held gesture blacked out past the freshness window re-presses when packets resume',()=>{
 const f=fixture();f.controller.pointerDown(1,'bomb');f.session.advance();f.drop(()=>true);
 pump(f,10);assert.equal(f.player().bombChargeStartedTick,undefined,'freshness expiry cancels the charge');
 f.drop(()=>false);pump(f,1);assert.notEqual(f.player().bombChargeStartedTick,undefined);
 f.controller.pointerRelease(1);f.session.advance();assert.equal(f.bombs(),1);
});
