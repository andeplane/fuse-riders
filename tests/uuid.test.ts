import test from "node:test";
import assert from "node:assert/strict";
import { uuid } from "fuse-netcode";
test("uuid is a v4 string with or without crypto.randomUUID", () => {
  const shape =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(uuid(), shape);
  const native = crypto.randomUUID;
  Object.defineProperty(crypto, "randomUUID", {
    value: undefined,
    configurable: true,
  });
  try {
    const a = uuid(),
      b = uuid();
    assert.match(a, shape);
    assert.match(b, shape);
    assert.notEqual(a, b);
  } finally {
    Object.defineProperty(crypto, "randomUUID", {
      value: native,
      configurable: true,
    });
  }
});
