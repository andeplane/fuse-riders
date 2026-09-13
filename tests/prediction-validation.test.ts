import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isAppliedMotionState,isInputControlScope} from '../src/online/prediction-validation.js';
import type {AppliedMotionState} from '../src/online/prediction-contract.js';
test('motion ledger boundary rejects malformed, unbounded and contradictory tick data',()=>{
 const value:AppliedMotionState={scope:{matchId:'m',round:1,controlEpoch:'e'},tick:10,appliedSeq:1,appliedTick:9,held:{left:true,right:false},results:[{seq:1,status:'applied',appliedTick:9}],motion:{seed:1,drunkStartedTick:0,drunkUntilTick:0,drunkHeadingOffset:0}};
 assert.equal(isAppliedMotionState(JSON.parse(JSON.stringify(value))),true);
 for(const invalid of [null,{...value,appliedTick:11},{...value,results:[...value.results,...value.results]},{...value,results:Array(129).fill({seq:1,status:'expired'})},{...value,motion:{...value.motion,drunkHeadingOffset:NaN}},{...value,held:{left:1,right:false}},{...value,results:[{seq:1,status:'applied',appliedTick:11}]}])assert.equal(isAppliedMotionState(invalid),false);
 assert.equal(isInputControlScope({...value.scope,controlEpoch:''}),false);
});
