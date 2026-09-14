import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectIngress } from '../src/online/direct-ingress.js';

test('immutable roster permissions authorize disjoint action and receipt slot flows', () => {
  const ingress = new DirectIngress(0);
  for (const permissions of [{ actions: [0], receipts: [0] }, { actions: [0, 0], receipts: [] }, { actions: [5], receipts: [] }, { actions: [0], receipts: [-1] }, { actions: [0, 1, 2, 3, 4, 5], receipts: [] }]) assert.equal(ingress.bind(7, permissions, 0), false);
  const actions = [1, 0]; assert.equal(ingress.bind(7, { actions, receipts: [2] }, 0), true); actions.push(3);
  assert.equal(ingress.flow('action', 3, 0), 'unauthorized');
  assert.equal(ingress.flow('action', 0, 0), 'accepted'); assert.equal(ingress.flow('receipt', 0, 0), 'unauthorized');
  assert.equal(ingress.flow('receipt', 2, 0), 'accepted'); assert.equal(ingress.flow('action', 2, 0), 'unauthorized');
  assert.equal(ingress.bind(7, { actions: [0, 1], receipts: [2] }, 0), true);
  assert.equal(ingress.bind(7, { actions: [0], receipts: [2] }, 0), false);
  assert.equal(ingress.bind(6, { actions: [0], receipts: [2] }, 0), false);
  assert.equal(ingress.bind(8, { actions: [], receipts: [4] }, 0), true);
  assert.equal(ingress.flow('action', 0, 0), 'unauthorized'); assert.equal(ingress.flow('receipt', 4, 0), 'accepted');
});

test('flow burst and refill are exact, and repeated binding never refills them', () => {
  const ingress = new DirectIngress(0), permissions = { actions: [0], receipts: [] };
  assert.equal(ingress.bind(7, permissions, 0), true);
  for (let i = 0; i < 280; i++) {
    assert.equal(ingress.bind(7, permissions, 0), true); assert.equal(ingress.flow('action', 0, 0), 'accepted');
  }
  assert.equal(ingress.flow('action', 0, 0), 'limited');
  for (let i = 0; i < 140; i++) assert.equal(ingress.flow('action', 0, 1000), 'accepted');
  assert.equal(ingress.flow('action', 0, 1000), 'limited');
  assert.equal(ingress.flow('action', 0, 999), 'limited'); assert.equal(ingress.flow('action', 0, NaN), 'limited');
});

test('five legitimate100Hz stream flows preserve their separate liveness allowance', () => {
  const ingress = new DirectIngress(0); assert.equal(ingress.bind(7, { actions: [0, 1, 2], receipts: [3, 4] }, 0), true);
  for (let now = 0; now < 10_000; now += 10) {
    for (let slot = 0; slot < 5; slot++) {
      const copies = 1 + Number(now % 50 === 0) + Number(now % 100 === 0);
      for (let i = 0; i < copies; i++) {
        assert.equal(ingress.packet(512, now), true);
        assert.equal(ingress.flow(slot < 3 ? 'action' : 'receipt', slot, now), 'accepted');
      }
    }
    if (now % 100 === 0) { assert.equal(ingress.packet(12, now), true); assert.equal(ingress.flow('probe', 8, now), 'accepted'); }
  }
});

test('liveness has a reserved burst even when all five flow bursts are used', () => {
  const ingress = new DirectIngress(0); ingress.bind(7, { actions: [0, 1, 2, 3, 4], receipts: [] }, 0);
  for (let slot = 0; slot < 5; slot++) for (let i = 0; i < 280; i++) {
    assert.equal(ingress.packet(512, 0), true); assert.equal(ingress.flow('action', slot, 0), 'accepted');
  }
  for (let i = 0; i < 40; i++) { assert.equal(ingress.packet(12, 0), true); assert.equal(ingress.flow('probe', 8, 0), 'accepted'); }
  assert.equal(ingress.flow('probe', 8, 0), 'limited');
  for (let i = 0; i < 20; i++) assert.equal(ingress.flow('probe', 9, 1000), 'accepted');
  assert.equal(ingress.flow('probe', 9, 1000), 'limited');
});

test('packet limits apply before parsing and the association budget survives alias changes', () => {
  const ingress = new DirectIngress(0);
  for (const bytes of [-1, 513, NaN, 1.5]) assert.equal(ingress.packet(bytes, 0), false);
  for (let i = 0; i < 1500; i++) assert.equal(ingress.packet(512, 0), true);
  assert.equal(ingress.packet(1, 0), false);
  assert.equal(ingress.bind(7, { actions: [0], receipts: [] }, 0), true);
  assert.equal(ingress.bind(8, { actions: [1], receipts: [] }, 0), true); assert.equal(ingress.packet(1, 0), false);
  for (let i = 0; i < 750; i++) assert.equal(ingress.packet(512, 1000), true);
  assert.equal(ingress.packet(512, 1000), false); assert.equal(ingress.packet(1, 999), false);
  assert.equal(ingress.bind(0, { actions: [], receipts: [] }, 1000), false);
  assert.equal(ingress.bind(9, { actions: [], receipts: [] }, NaN), false);
  assert.throws(() => new DirectIngress(-1));
});
