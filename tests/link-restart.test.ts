import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkRestartPolicy } from '../src/online/link-restart.js';

test('restarts are due every interval and stop after the bounded budget',()=>{
  const p=new LinkRestartPolicy(0,3,8000);
  assert.equal(p.due(7999),false);assert.equal(p.due(8000),true);
  const a1=p.begin(8000);assert.equal(p.due(16000),false,'in flight');assert.equal(p.complete(a1),true);
  assert.equal(p.due(15999),false);assert.equal(p.due(16000),true);
  p.complete(p.begin(16000));p.complete(p.begin(24000));
  assert.equal(p.attempts,3);assert.equal(p.exhausted,true);assert.equal(p.due(1e9),false);
});

test('fresh health restores the budget and retires the attempt in flight',()=>{
  const p=new LinkRestartPolicy(0,2,8000);
  const stale=p.begin(8000);
  p.healthy(9000);
  assert.equal(p.complete(stale),false,'a completion from before recovery must not signal');
  assert.equal(p.attempts,0);assert.equal(p.exhausted,false);
  assert.equal(p.due(16999),false);assert.equal(p.due(17000),true);
  const next=p.begin(17000);assert.equal(p.complete(stale),false);assert.equal(p.complete(next),true);
});

test('only the newest attempt can complete',()=>{
  const p=new LinkRestartPolicy(0,4,100);
  const first=p.begin(100);
  p.healthy(150);const second=p.begin(250);
  assert.equal(p.complete(first),false);assert.equal(p.due(400),false);
  assert.equal(p.complete(second),true);assert.equal(p.due(400),true);
});
