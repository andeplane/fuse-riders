import assert from "node:assert/strict";
import { test } from "node:test";
import { createAttractMatch } from "../src/app/attract-match.js";

test("the menu demo runs real deterministic play without requiring a human room seat", () => {
  const a = createAttractMatch(),
    b = createAttractMatch();
  assert.equal(a.view().riders.length, 2);
  const step = a.view().step;
  for (let i = 0; i < 10; i++) {
    a.advance();
    b.advance();
    assert.deepEqual(a.view(), b.view());
  }
  assert.ok(a.view().step > step);
});
