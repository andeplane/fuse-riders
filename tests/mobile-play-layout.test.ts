import test from 'node:test';
import assert from 'node:assert/strict';
// CSS-free policy is imported from the dedicated policy boundary.
import {mobilePlayPolicy} from '../src/online/mobile-play-policy.js';
test('phone gameplay needs landscape while lobby, desktop and TV retain normal layout',()=>{const state={joined:true,phase:'playing',displayOnly:false};assert.deepEqual(mobilePlayPolicy(state,true,390,844),{active:true,blocked:true});assert.deepEqual(mobilePlayPolicy(state,true,844,390),{active:true,blocked:false});for(const other of [{...state,joined:false},{...state,phase:'lobby'},{...state,phase:'matchOver'},{...state,displayOnly:true}])assert.equal(mobilePlayPolicy(other,true,390,844).active,false);assert.equal(mobilePlayPolicy(state,false,390,844).active,false);assert.equal(mobilePlayPolicy(state,true,1366,1024).active,false);});
test('countdown and inter-round keep full phone controls and rotation gate',()=>{for(const phase of ['countdown','roundOver'])assert.deepEqual(mobilePlayPolicy({joined:true,phase,displayOnly:false},true,320,568),{active:true,blocked:true});});
