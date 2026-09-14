import test from 'node:test';
import assert from 'node:assert/strict';
// CSS-free policy is imported from the dedicated policy boundary.
import {mobilePlayPolicy} from '../src/online/mobile-play-policy.js';
const PHASES=['lobby','countdown','playing','roundOver','matchOver'];
test('a joined phone is the same landscape controller in every phase (#13)',()=>{for(const phase of PHASES){const state={joined:true,phase,displayOnly:false};assert.deepEqual(mobilePlayPolicy(state,true,390,844),{active:true,blocked:true},phase);assert.deepEqual(mobilePlayPolicy(state,true,844,390),{active:true,blocked:false},phase);assert.deepEqual(mobilePlayPolicy(state,true,320,568),{active:true,blocked:true},phase);}});
test('unjoined, display-only, desktop and mouse views keep the normal layout',()=>{for(const phase of PHASES){const state={joined:true,phase,displayOnly:false};for(const other of [{...state,joined:false},{...state,displayOnly:true}])assert.deepEqual(mobilePlayPolicy(other,true,390,844),{active:false,blocked:false},phase);assert.equal(mobilePlayPolicy(state,false,390,844).active,false,phase);assert.equal(mobilePlayPolicy(state,true,1366,1024).active,false,phase);assert.equal(mobilePlayPolicy(state,true,701,1200).active,false,phase);}});
