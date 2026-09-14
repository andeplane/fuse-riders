import test from 'node:test';
import assert from 'node:assert/strict';
import { safeStorage, createMemoryStorage } from '../src/client/safe-storage.js';

// A fake that reproduces Safari's "Block all cookies" behaviour: merely evaluating the `localStorage`
// getter throws a SecurityError, before any get/set/remove call is even made.
function throwingStorageAccess(): Storage {
  throw new DOMException('The operation is insecure.', 'SecurityError');
}

// A minimal but fully typed fake of the real Storage interface, so no cast is needed to satisfy
// safeStorage()'s `() => Storage` accessor type.
function fakeBrowserStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    getItem: (key: string) => (values.has(key) ? values.get(key)! : null),
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
}

test('safeStorage falls back to an in-memory store when the underlying storage throws on access', () => {
  const storage = safeStorage(throwingStorageAccess);
  assert.equal(storage.getItem('missing'), null);
  storage.setItem('name', 'Anders');
  assert.equal(storage.getItem('name'), 'Anders');
  storage.removeItem('name');
  assert.equal(storage.getItem('name'), null);
});

test('safeStorage does not evaluate the storage accessor until a get/set/remove call is made', () => {
  let accessed = 0;
  const wrapper = safeStorage(() => { accessed += 1; throw new Error('boom'); });
  assert.equal(accessed, 0, 'constructing the wrapper must not touch storage eagerly');
  wrapper.getItem('x');
  assert.equal(accessed, 1);
});

test('safeStorage passes through to real storage when it works', () => {
  const backing = fakeBrowserStorage();
  const storage = safeStorage(() => backing);
  storage.setItem('theme', 'clean-neon');
  assert.equal(storage.getItem('theme'), 'clean-neon');
  assert.equal(backing.getItem('theme'), 'clean-neon');
});

test('createMemoryStorage never throws and reports missing keys as null', () => {
  const memory = createMemoryStorage();
  assert.equal(memory.getItem('nope'), null);
  memory.setItem('a', '1');
  memory.removeItem('a');
  assert.equal(memory.getItem('a'), null);
});
