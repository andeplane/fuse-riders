import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceRiderPose } from '../src/shared/rider-motion.js';
import { createGame,addPlayer,startMatch,step,SLOT_COLORS,RIDER_SPEED,RIDER_TURN_RATE,TICK_HZ } from '../src/shared/game.js';
import { drunkHeadingOffset } from '../src/shared/drunk.js';
test('pure rider kernel exactly matches authoritative turns including drunk offsets',()=>{
 const game=createGame('motion-kernel');
 for(let i=0;i<2;i++)addPlayer(game,{id:`p${i}`,name:`P${i}`,slot:i,color:SLOT_COLORS[i]!});
 startMatch(game);for(let t=0;t<60;t++)step(game,new Map());
 const p=game.players.get('p0')!;Object.assign(p,{x:800,y:450,invulnerableUntilTick:10000,drunkStartedTick:game.tick,drunkUntilTick:game.tick+80});
 const controls={left:true,right:false,bomb:false};
 for(let i=0;i<80;i++){
  const previous={x:p.x,y:p.y,angle:p.angle,drunkHeadingOffset:p.drunkHeadingOffset};
  const expected=advanceRiderPose(previous,controls,{distance:RIDER_SPEED/TICK_HZ,turn:RIDER_TURN_RATE/TICK_HZ,drunkHeadingOffset:drunkHeadingOffset(game.seed,p.id,game.tick+1,p.drunkStartedTick,p.drunkUntilTick)});
  step(game,new Map([[p.id,controls]]));
  assert.deepEqual({x:p.x,y:p.y,angle:p.angle,drunkHeadingOffset:p.drunkHeadingOffset},expected);
 }
});
test('opposite controls cancel steering and pure motion leaves input pose unchanged',()=>{
 const pose={x:0,y:0,angle:0,drunkHeadingOffset:.1},copy={...pose};
 const result=advanceRiderPose(pose,{left:true,right:true},{distance:7.5,turn:.14,drunkHeadingOffset:.1});
 assert.deepEqual(result,{x:7.5,y:0,angle:0,drunkHeadingOffset:.1});assert.deepEqual(pose,copy);
});
