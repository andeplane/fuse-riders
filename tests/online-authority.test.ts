import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthorityClock, isAuthorityGrant, LEASE_GUARD_MS, reserveAuthority, renewAuthority } from '../src/online/authority.js';

test('replacement reservation fences partitions and rejects delayed old renewals', () => {
  const old = reserveAuthority(undefined, 'room', 'host-a', 'grant-a', 1000);
  const next = reserveAuthority(old, 'room', 'host-b', 'grant-b', 2000);
  assert.equal(next.validFrom, old.expiresAt + LEASE_GUARD_MS);
  assert.equal(renewAuthority(next, old, 2500), undefined);
  assert.equal(renewAuthority(next, next, next.validFrom - 1), undefined);
  const renewed = renewAuthority(next, next, next.validFrom + 3000)!;
  assert.equal(renewed.expiresAt, next.expiresAt + 3000);
  assert.equal(renewAuthority(renewed, renewed, renewed.expiresAt), undefined);
  assert.deepEqual(old, { incarnation:'room',epoch:1,holder:'host-a',grantId:'grant-a',validFrom:1000,expiresAt:11000 });
});

test('clock uncertainty prevents overlapping old and new authorization', () => {
  let local = 0;
  const clock = new AuthorityClock(() => local);
  const old = reserveAuthority(undefined, 'room', 'a', 'a', 1000);
  const next = reserveAuthority(old, 'room', 'b', 'b', 2000);
  for (let serverNow = 10_800; serverNow < 11_600; serverNow += 10) {
    const sent = local; local += 40;
    assert.equal(clock.synchronize(sent, serverNow), true);
    assert.equal(clock.permits(old) && clock.permits(next), false);
  }
});

test('clock stops after suspension or stale samples, resuming only after fresh sample', () => {
  let local = 0; const clock = new AuthorityClock(() => local);
  const grant = reserveAuthority(undefined, 'room', 'a', 'g', 1000);
  clock.synchronize(0, 1100); assert.equal(clock.permits(grant), true);
  local = 501; assert.equal(clock.permits(grant), false);
  assert.equal(clock.permits(grant), false);
  clock.synchronize(501, 1601); assert.equal(clock.permits(grant), true);
  for (let i = 0; i < 40; i++) { local += 100; assert.equal(clock.permits(grant), true); }
  local += 1; assert.equal(clock.permits(grant), false);
  clock.synchronize(local, 6000); clock.invalidate(); assert.equal(clock.permits(grant), false);
});

test('clock rejects bad samples and conservative intervals crossing lease boundaries', () => {
  let now = 600; const clock = new AuthorityClock(() => now);
  assert.equal(clock.synchronize(0, 1000), false);
  assert.equal(clock.synchronize(700, 1000), false);
  assert.equal(clock.synchronize(600, NaN), false);
  assert.equal(clock.synchronize(600, -1), false);
  assert.equal(clock.synchronize(300, 1000), true);
  assert.equal(clock.interval(), undefined); // valid RTT but uncertainty exceeds lease guard
  assert.deepEqual(clock.diagnostics(),{reason:'uncertainty',roundTripMs:300});
  assert.equal(clock.synchronize(550, 1000), true);
  const grant = reserveAuthority(undefined, 'r', 'h', 'g', 1020);
  assert.equal(clock.permits(grant), false);
  now += 100; assert.equal(clock.permits(grant), true);
  now = 500; assert.equal(clock.interval(), undefined);
});

test('grant boundary validation rejects malformed values and exhausted epochs', () => {
  const grant = reserveAuthority(undefined, 'r', 'h', 'g', 0);
  assert.equal(isAuthorityGrant(grant), true);
  for (const value of [null, [], {}, {...grant, epoch:0}, {...grant, holder:''}, {...grant, expiresAt:0}, {...grant, validFrom:NaN}]) assert.equal(isAuthorityGrant(value), false);
  assert.throws(() => reserveAuthority(grant, 'other', 'h', 'g', 1), /incarnation/);
  assert.throws(() => reserveAuthority(undefined, 'r', '', 'g', 1));
  assert.throws(() => reserveAuthority({...grant, epoch:Number.MAX_SAFE_INTEGER}, 'r', 'h', 'g', 1));
  assert.equal(renewAuthority(grant, {...grant, holder:'other'}, 1), undefined);
  assert.equal(renewAuthority(grant, grant, NaN), undefined);
});
