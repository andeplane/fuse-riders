import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DeferredCommand} from '../src/online/deferred-command.js';
test('host intention waits for permission, latest wins, expires and cannot cross authority reset',()=>{
 const queue=new DeferredCommand<string>();queue.offer('start',0);
 assert.equal(queue.drain(100,false).status,'waiting');queue.offer('menu',200);
 assert.deepEqual(queue.drain(300,true),{status:'ready',value:'menu'});
 assert.equal(queue.drain(301,true).status,'empty');queue.offer('start',400);
 assert.equal(queue.drain(5400,true).status,'expired');queue.offer('start',5500);queue.clear();
 assert.equal(queue.drain(5501,true).status,'empty');
});
