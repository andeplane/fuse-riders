import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TickProbes} from '../src/online/tick-probes.js';
test('host clock replies are bound, single-use, bounded and invalidated at recovery',()=>{
 let now=0;const probes=new TickProbes(()=>now),scope={matchId:'m',round:1,controlEpoch:'e'};
 const request=probes.request();now=100;
 assert.equal(probes.accept(request.probeId,1,10,false,scope),undefined);
 assert.equal(probes.accept(request.probeId,0,10,false,scope)?.localReceivedAt,100);
 assert.equal(probes.accept(request.probeId,0,10,false,scope),undefined);
 const old=probes.request();now=2201;
 assert.equal(probes.accept(old.probeId,old.localSentAt,10,false,scope),undefined);
 const cleared=probes.request();probes.clear();
 assert.equal(probes.accept(cleared.probeId,cleared.localSentAt,10,false,scope),undefined);
 const evicted=probes.request();for(let i=0;i<9;i++)probes.request();
 assert.equal(probes.accept(evicted.probeId,evicted.localSentAt,10,false,scope),undefined);
});
