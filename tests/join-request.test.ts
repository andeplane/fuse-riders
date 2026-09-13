import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JoinRequest } from '../src/online/join-request.js';

test('join survives authority setup and failed delivery until roster confirmation', () => {
  const request = new JoinRequest<string>(), sent: string[] = [];
  request.request('Rider');
  request.retry(0, false, value => sent.push(value));
  request.retry(2000, true, value => sent.push(value));
  request.retry(2200, true, value => sent.push(value));
  request.retry(2500, true, value => sent.push(value));
  assert.deepEqual(sent, ['Rider', 'Rider']);
  request.confirm();
  request.retry(3000, true, value => sent.push(value));
  assert.equal(sent.length, 2);
  request.request('New name');
  request.retry(3001, true, value => sent.push(value));
  assert.equal(sent.at(-1), 'New name');
});
