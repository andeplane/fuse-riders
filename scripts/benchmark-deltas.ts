import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { createGame,addPlayer,startMatch,step,toSnapshot } from '../src/shared/game.js';
import { WorldEncoder,WorldDecoder } from '../src/online/world-codec.js';
import assert from 'node:assert/strict';
const game=createGame('delta-bench');for(let i=0;i<5;i++)addPlayer(game,{id:`p${i}`,name:`P${i}`,slot:i,color:'#ffffff'});
startMatch(game);for(let i=0;i<60;i++)step(game,new Map());
for(const [i,p] of [...game.players.values()].entries())Object.assign(p,{x:220+i*260,y:400,invulnerableUntilTick:99999});
const inputs=new Map([...game.players.keys()].map(id=>[id,{left:true,right:false,bomb:false}]));
const encoder=new WorldEncoder(),decoder=new WorldDecoder();let full=0,delta=0;const times:number[]=[];
for(let i=0;i<700;i++){
  step(game,inputs);if(i%2)continue;
  const snapshot=toSnapshot(game),begin=performance.now();const frame=encoder.encode(snapshot,game.matchId,game.round,game.tick,i===0||i%300===0);times.push(performance.now()-begin);
  const serialized=JSON.stringify(frame);assert.deepEqual(decoder.accept(JSON.parse(serialized)),snapshot);
  if(i>=100){full+=Buffer.byteLength(JSON.stringify(snapshot));delta+=Buffer.byteLength(serialized);}
}
const report={date:new Date().toISOString(),method:'5 invulnerable circling riders, 30 measured simulated seconds after 5s warmup; 10 Hz deltas with a keyframe every 15s; decoded world equals authoritative snapshot on every update.',fullAt10HzMbps:full*8/30/1e6,deltaAt10HzMbps:delta*8/30/1e6,reductionPercent:(1-delta/full)*100,encoderP95Ms:times.sort((a,b)=>a-b)[Math.floor(times.length*.95)]};
await writeFile('docs/online/delta-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(report);
