import test from "node:test";
import assert from "node:assert/strict";
import {
  deterministicViolations,
  layer,
  sourceFiles,
  syntax,
} from "../../../tests/fixtures/source-guards.js";

test("Math aliases and destructured functions cannot bypass the simulation guard", () => {
  for (const source of [
    "const { sin, random } = Math; sin(1); random();",
    "const native = Math; native.sin(1);",
    "const native = globalThis.Math; native.random();",
    "const native = globalThis['Math']; native.cos(1);",
  ]) {
    assert.ok(
      deterministicViolations(syntax("sample.ts", source)).includes(
        "Math extraction",
      ),
    );
  }
  assert.deepEqual(
    deterministicViolations(
      syntax(
        "sample.ts",
        "const maximum = Math.max; maximum(1, 2); globalThis['Math'].sqrt(4);",
      ),
    ),
    [],
  );
  assert.deepEqual(
    deterministicViolations(
      syntax("sample.ts", "globalThis['Math']['random']();"),
    ),
    ["Math.random"],
  );
});

test("simulation source uses deterministic math and has no clock or locale dependencies", () => {
  const violations = sourceFiles("games/fuse-riders/src")
    .filter((file) => layer(file) === "engine")
    .flatMap((file) =>
      deterministicViolations(syntax(file)).map((hit) => `${file}: ${hit}`),
    );
  assert.deepEqual(violations, []);
});

test("the syntax guard catches computed access and powers but ignores comments and string contents", () => {
  assert.deepEqual(
    deterministicViolations(
      syntax(
        "sample.ts",
        `// Math.random() ** Date.now()\n const text = 'performance.now()'; Math.sqrt(4); x*x;`,
      ),
    ),
    [],
  );
  assert.deepEqual(
    deterministicViolations(
      syntax(
        "sample.ts",
        `Math['random'](); Math.log1p(x); Math[key](); globalThis.Math.sin(x); Date.now(); performance.now(); x **= 2; y ** 2; id['localeCompare'](other);`,
      ),
    ),
    [
      "Date",
      "Math.[dynamic]",
      "Math.log1p",
      "Math.random",
      "Math.sin",
      "exponentiation",
      "localeCompare",
      "performance",
    ],
  );
});
