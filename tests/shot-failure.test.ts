import test from 'node:test';
import assert from 'node:assert/strict';
import { isShotTransition, ShotFailureNotice, SHOT_FAILURE_TEXT } from '../src/online/shot-failure.js';
test('failure notice classifies only press/release gestures, never neutral or held heartbeats',()=>{
 for(const raw of [null,undefined,false,{}, {type:'input',bomb:true},{type:'input',bombAction:'cancel'},{type:'action',bombAction:'release'}])assert.equal(isShotTransition(raw),false);
 for(const bombAction of ['press','release'])assert.equal(isShotTransition({type:'input',bombAction}),true);
});
test('shot notice persists three seconds independently and another failure restarts the deadline',()=>{
 let now=100;const notice=new ShotFailureNotice(()=>now);assert.equal(notice.message(),undefined);notice.show();assert.equal(notice.message(),SHOT_FAILURE_TEXT);now=3099;assert.equal(notice.message(),SHOT_FAILURE_TEXT);now=3100;assert.equal(notice.message(),undefined);notice.show();now=6000;notice.show();now=8999;assert.equal(notice.message(),SHOT_FAILURE_TEXT);now=9000;assert.equal(notice.message(),undefined);
});
