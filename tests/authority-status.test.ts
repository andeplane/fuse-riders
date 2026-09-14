import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityTransitionStatus } from '../src/online/authority-status.js';
test('authority recovery clears a stale pause once without overwriting subsequent command errors',()=>{
 let active=true,status='Connected';
 const tick=(permitted:boolean)=>{const next=authorityTransitionStatus(active,permitted);if(next)status=next;active=permitted;};
 tick(false);assert.match(status,/Paused/);tick(true);assert.equal(status,'Room authority confirmed');status='Room full';tick(true);assert.equal(status,'Room full');tick(false);tick(true);assert.equal(status,'Room authority confirmed');
});
test('initial permission produces confirmed status and sustained permission stays silent',()=>{assert.equal(authorityTransitionStatus(false,true),'Room authority confirmed');assert.equal(authorityTransitionStatus(true,true),undefined);assert.match(authorityTransitionStatus(false,false)!,/Paused/);});
