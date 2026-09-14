import test from 'node:test';
import assert from 'node:assert/strict';
import { headingResponse, type ResponseFrame } from '../src/online/response-measurement.js';
const pointer={epochAt:1000,actorId:'actor',direction:1 as const,trusted:true};
function frame(epochAt:number,angle=0,patch:Partial<ResponseFrame>={}):ResponseFrame {return {kind:'response-render',epochAt,scope:'match:round:epoch',phase:'playing',tick:100,powerupsDisabled:true,players:[{id:'actor',angle,alive:true,drunkUntilTick:0,invulnerableUntilTick:0,portalCooldownUntilTick:0,shielded:false}],...patch};}
const before=()=>[frame(800),frame(850),frame(900),frame(950),frame(999)];
test('only actual changed heading counts, unchanged animation frames do not',()=>{
 const result=headingResponse(pointer,[...before(),frame(1001),frame(1017),frame(1033,.01)]);assert.equal(result.status,'changed');assert.equal(result.latencyMs,33);
});
test('clock-aligned render frames detect wrapped positive heading and reject the wrong direction',()=>{
 const frames=before().map(f=>frame(f.epochAt,Math.PI*2-.001));assert.equal(headingResponse(pointer,[...frames,frame(1020,.005)]).latencyMs,20);assert.equal(headingResponse(pointer,[...before(),frame(1020,-.005)]).reason,'opposite-heading-change');
});
test('death, round transition, intoxication and live powerups invalidate the measurement',()=>{
 for(const changed of [frame(1020,.01,{phase:'roundOver'}),frame(1020,.01,{scope:'new'}),frame(1020,.01,{powerupsDisabled:false}),{...frame(1020,.01),players:[{...frame(0).players[0]!,angle:.01,alive:false}]},{...frame(1020,.01),players:[{...frame(0).players[0]!,angle:.01,drunkUntilTick:101}]}])assert.equal(headingResponse(pointer,[...before(),changed]).status,'rejected');
});
test('turning, short, stale and missing baselines are rejected without cherry-picking',()=>{
 assert.equal(headingResponse(pointer,[frame(990),frame(1020,.01)]).reason,'short-baseline');assert.equal(headingResponse(pointer,[frame(700),frame(800),frame(850),frame(1020,.01)]).reason,'missing-fresh-baseline');assert.equal(headingResponse(pointer,[...before().slice(0,-1),frame(999,.01),frame(1020,.02)]).reason,'confounded-or-turning-baseline');assert.equal(headingResponse({...pointer,trusted:false},before()).reason,'invalid-pointer');
});
test('unchanged heading times out and incomplete capture is separately rejected',()=>{
 assert.equal(headingResponse(pointer,[...before(),frame(1100),frame(1500),frame(1799)]).status,'timeout');assert.equal(headingResponse(pointer,[...before(),frame(1100)]).reason,'incomplete-observation');
});
test('one degree metric remains later than the first tiny numerical departure',()=>{
 const frames=[...before(),frame(1010,.001),frame(1020,.01),frame(1030,.02)];assert.equal(headingResponse(pointer,frames).latencyMs,10);assert.equal(headingResponse(pointer,frames,800,Math.PI/180).latencyMs,30);
});
