import test from 'node:test';
import assert from 'node:assert/strict';
import { ControllerInputState, type ControllerInputMessage } from '../src/client/controller-state.js';
import { ControllerKeyboardBindings } from '../src/client/controller-keyboard.js';
function fixture(){const messages:ControllerInputMessage[]=[];let allowed=true;const state=new ControllerInputState({send:m=>{messages.push(m);return true;}});const keyboard=new ControllerKeyboardBindings(state,()=>allowed);let prevented=0;const event=(code:string,repeat=false)=>({code,repeat,preventDefault:()=>{prevented++;}});return {messages,state,keyboard,event,block:()=>{allowed=false;},prevented:()=>prevented};}
test('arrows share held state and Space emits exactly one press and release despite repeats',()=>{const f=fixture();f.keyboard.down(f.event('ArrowLeft'));f.keyboard.down(f.event('Space'));f.keyboard.down(f.event('Space',true));f.keyboard.down(f.event('Space'));f.keyboard.up(f.event('Space'));f.keyboard.up(f.event('Space'));f.keyboard.up(f.event('ArrowLeft'));assert.deepEqual(f.messages.map(m=>m.bombAction),[undefined,'press','release',undefined]);assert.equal(f.state.hasHeld(),false);});
test('pointer ownership survives keyboard release and cancellation',()=>{const f=fixture();f.state.pointerDown(8,'left');f.keyboard.down(f.event('ArrowLeft'));f.keyboard.up(f.event('ArrowLeft'));assert.equal(f.state.isHeld('left'),true);f.keyboard.down(f.event('ArrowRight'));f.keyboard.clear();assert.equal(f.state.isHeld('left'),true);assert.equal(f.state.isHeld('right'),false);f.state.pointerRelease(8);assert.equal(f.state.hasHeld(),false);});
test('menu/focus/visibility cancellation never fires and repeat after reset cannot restart charge',()=>{const f=fixture();f.keyboard.down(f.event('Space'));f.keyboard.clear();f.keyboard.down(f.event('Space',true));f.keyboard.up(f.event('Space'));assert.deepEqual(f.messages.map(m=>m.bombAction),['press','cancel']);f.keyboard.down(f.event('Space'));f.block();f.keyboard.up(f.event('Space'));assert.deepEqual(f.messages.map(m=>m.bombAction),['press','cancel','press','cancel']);});
test('blocked and unrelated keys retain normal browser handling',()=>{const f=fixture();f.keyboard.down(f.event('KeyZ'));f.block();f.keyboard.down(f.event('Space'));f.keyboard.up(f.event('Space'));assert.equal(f.prevented(),0);assert.equal(f.messages.length,0);});
test('blocked new key clears previously held keys without releasing a bomb',()=>{const f=fixture();f.keyboard.down(f.event('Space'));f.block();f.keyboard.down(f.event('ArrowLeft'));assert.equal(f.state.hasHeld(),false);assert.equal(f.messages.at(-1)?.bombAction,'cancel');});
test('browser modifier shortcuts remain untouched while keyup releases an earlier plain hold',()=>{
 for(const modifier of ['altKey','ctrlKey','metaKey'] as const){
  const f=fixture();
  for(const code of ['ArrowLeft','ArrowRight','Space'])f.keyboard.down({...f.event(code),[modifier]:true});
  assert.equal(f.prevented(),0);assert.equal(f.messages.length,0);assert.equal(f.state.hasHeld(),false);
  f.keyboard.down(f.event('Space'));f.keyboard.up({...f.event('Space'),[modifier]:true});
  assert.deepEqual(f.messages.map(message=>message.bombAction),['press','release']);assert.equal(f.state.hasHeld(),false);
 }
});

test('A and D aliases retain independent held ownership from arrow keys',()=>{const f=fixture();for(const [arrow,alias,control] of [['ArrowLeft','KeyA','left'],['ArrowRight','KeyD','right']] as const){f.keyboard.down(f.event(arrow));f.keyboard.down(f.event(alias));f.keyboard.up(f.event(arrow));assert.equal(f.state.isHeld(control),true);f.keyboard.up(f.event(alias));assert.equal(f.state.isHeld(control),false);}assert.equal(f.state.hasHeld(),false);});
