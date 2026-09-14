import test from 'node:test';
import assert from 'node:assert/strict';
import { ControllerInputState, type ControllerInputMessage } from '../src/client/controller-state.js';
import { HostSession, type RoomCommand } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';

function fixture(){
 const session=new HostSession('host',defaultRoomSettings(),{token:()=> 'fire-delivery'});session.command('host',{type:'join',name:'Host'});session.command('guest',{type:'join',name:'Guest'});session.command('host',{type:'action',action:'start'});while(session.game.phase==='countdown')session.advance();
 let drop:(m:ControllerInputMessage)=>boolean=()=>false;const sent:RoomCommand[]=[];
 const controller=new ControllerInputState({send:message=>{const packet={...message,scope:session.controlScope('host')!,intendedTick:session.game.tick+1};sent.push(packet);if(drop(message))return false;return !session.command('host',packet);}},()=>session.game.tick*50);
 controller.clear(true,true);session.advance();
 return {session,controller,sent,drop:(predicate:typeof drop)=>{drop=predicate;},player:()=>session.game.players.get('host')!};
}
test('failed press plus fresh held resends cannot invent charge or fire on release',()=>{
 const f=fixture();f.drop(m=>m.bombAction==='press');assert.equal(f.controller.pointerDown(1,'bomb'),false);
 for(let i=0;i<3;i++){f.controller.resend();f.session.advance();}assert.equal(f.player().bombChargeStartedTick,undefined);
 f.drop(()=>false);f.controller.pointerRelease(1);f.session.advance();assert.equal(f.session.game.bombs.size,0);
 // A new physical gesture is still usable after safe cancellation.
 f.controller.pointerDown(2,'bomb');f.session.advance();f.controller.pointerRelease(2);f.session.advance();assert.equal(f.session.game.bombs.size,1);
});
test('lost final release without other held controls cancels within ten ticks and is never retried',()=>{
 const f=fixture();f.controller.pointerDown(1,'bomb');f.session.advance();assert.notEqual(f.player().bombChargeStartedTick,undefined);
 f.drop(m=>m.bombAction==='release');assert.equal(f.controller.pointerRelease(1),false);const count=f.sent.length;
 for(let i=0;i<10;i++){assert.equal(f.controller.resend(),false);f.session.advance();}assert.equal(f.sent.length,count);assert.equal(f.player().bombChargeStartedTick,undefined);assert.equal(f.session.game.bombs.size,0);
});
test('steering heartbeat after lost release carries bomb false and safely cancels instead of firing',()=>{
 const f=fixture();f.controller.pointerDown(1,'left');f.controller.pointerDown(2,'bomb');f.session.advance();f.drop(m=>m.bombAction==='release');f.controller.pointerRelease(2);f.controller.resend();f.session.advance();
 assert.equal(f.player().bombChargeStartedTick,undefined);assert.equal(f.session.game.bombs.size,0);assert.equal(f.session.appliedMotion('host')!.held.left,true);
});
test('ordered-but-delayed release expires rather than replaying after network recovery',()=>{
 const f=fixture();f.controller.pointerDown(1,'bomb');f.session.advance();f.drop(m=>m.bombAction==='release');f.controller.pointerRelease(1);const release=f.sent.at(-1)!;
 for(let i=0;i<7;i++)f.session.advance();assert.match(f.session.command('host',release)!,/expired/);f.session.advance();assert.equal(f.player().bombChargeStartedTick,undefined);assert.equal(f.session.game.bombs.size,0);
});
