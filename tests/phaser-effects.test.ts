import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EffectTransitions, bombPose } from '../src/client/phaser/effects.js';
import { createGame, addPlayer, toSnapshot } from '../src/shared/game.js';
import type { ViewSnapshot } from '../src/client/snapshot-stream.js';
const frame = (): ViewSnapshot => { const game=createGame('visual-test'); addPlayer(game,{id:'p',name:'P',slot:0,color:'#22d3ee'}); return {...toSnapshot(game),tick:10,round:1}; };
test('effects do not replay on repeated snapshots or across authority/match reset',()=>{
 const effects=new EffectTransitions(); const s=frame(); const blast={bombId:1,circle:{x:20,y:30,radius:40},expiresAtTick:18};
 effects.accept(s,'epoch1:match1');
 assert.equal(effects.accept({...s,blasts:[blast]},'epoch1:match1').explosions.length,1);
 assert.equal(effects.accept({...s,blasts:[blast]},'epoch1:match1').explosions.length,0);
 assert.equal(effects.accept({...s,blasts:[blast]},'epoch2:match1').explosions.length,0);
 assert.equal(effects.accept({...s,round:2,blasts:[blast]},'epoch2:match1').explosions.length,0);
 effects.reset(); assert.equal(effects.accept({...s,blasts:[blast]},'epoch2:match1').explosions.length,0);
});
test('bomb flight sprite follows segmented path while damage radius stays at landing point',()=>{
 const bomb={id:1,ownerId:'p',launchX:0,launchY:0,x:100,y:100,launchedTick:0,landsAtTick:10,explodeAtTick:50,blastRange:90,flightPath:[{x:0,y:0,angle:0},{x:100,y:0,angle:0},{x:100,y:100,angle:0}]};
 assert.deepEqual(bombPose(bomb,2.5),{x:50,y:0,flight:.25});
 assert.deepEqual(bombPose(bomb,7.5),{x:100,y:50,flight:.75});
 assert.deepEqual(bombPose(bomb,20),{x:100,y:100,flight:1});
 assert.equal(bomb.x,100); assert.equal(bomb.blastRange,90);
});
