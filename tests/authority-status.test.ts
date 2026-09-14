import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityTransitionStatus } from '../src/online/authority-status.js';
test('authority recovery clears a stale pause once without overwriting subsequent command errors',()=>{
 let active=true,status='Connected';
 const tick=(permitted:boolean)=>{const next=authorityTransitionStatus(active,permitted);if(next)status=next;active=permitted;};
 tick(false);assert.match(status,/Paused/);tick(true);assert.equal(status,'Room authority confirmed');status='Room full';tick(true);assert.equal(status,'Room full');tick(false);tick(true);assert.equal(status,'Room authority confirmed');
});
test('a sustained pause announces itself once; further ticks preserve the notice on screen',()=>{
 let active=true,status='Connected';const emitted:string[]=[];
 const tick=(permitted:boolean)=>{const next=authorityTransitionStatus(active,permitted);if(next){emitted.push(next);status=next;}active=permitted;};
 tick(false);assert.match(status,/Paused/);
 status='Room is full (5 players)';
 for(let i=0;i<20;i++)tick(false);
 assert.equal(status,'Room is full (5 players)');assert.equal(emitted.length,1);
});
test('initial permission produces confirmed status and sustained permission stays silent',()=>{assert.equal(authorityTransitionStatus(false,true),'Room authority confirmed');assert.equal(authorityTransitionStatus(true,true),undefined);assert.match(authorityTransitionStatus(true,false)!,/Paused/);assert.equal(authorityTransitionStatus(false,false),undefined);});
