import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ALLOWED: Record<string, RegExp> = {
  "fuse-network-protocol": /^(\.|node:)/,
  "fuse-network-fe": /^(\.|fuse-network-protocol$)/,
  "fuse-network-be":
    /^(\.|node:|ws$|fuse-network-protocol$|@google-cloud\/|google-auth-library$)/,
  "fuse-platform":
    /^(\.|node:|fuse-network-be$|jose$|@google-cloud\/firestore$)/,
};
const sources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(path.join(directory, entry.name))
      : entry.name.endsWith(".ts")
        ? [path.join(directory, entry.name)]
        : [],
  );

// A whole-line comment names no module. Only a line that is nothing but comment is dropped, so an import sharing a
// line with a comment is still read; a block comment is not stripped wholesale because a glob such as "src/**/*.ts"
// would open one and hide the real imports after it.
const COMMENT_LINE =
  /^[ \t]*(?:\/\/.*|(?:\/\*|\*(?!\/))(?:(?!\*\/).)*(?:\*\/)?[ \t]*|\*\/[ \t]*)$/gm;
// Every way one module names another: `from "x"` (import, `import type`, `export … from`), the side-effect
// `import "x"`, the dynamic `import("x")`, the type query `import("x").T`, and `require("x")`.
const SPECIFIER =
  /(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;
// A call whose argument is not a literal names a module this scan cannot read, so it is reported rather than skipped.
const OPAQUE = /\b(?:import|require)\s*\(\s*(?![\s"'`])[^)]*\)?/g;
const code = (text: string): string => text.replace(COMMENT_LINE, "");
const importSpecifiers = (text: string): string[] =>
  [...code(text).matchAll(SPECIFIER)].map((match) => match[1]!);
const opaqueImports = (text: string): string[] => [
  ...[...code(text).matchAll(OPAQUE)].map((match) => match[0]),
  ...importSpecifiers(text).filter((specifier) => specifier.includes("${")),
];

test("the import scan reads every form a module can name another in, and nothing inside a comment", () => {
  const found: [form: string, source: string, specifiers: string[]][] = [
    ["named import", 'import { a } from "../../src/a";', ["../../src/a"]],
    ["import type", "import type { B } from '../../src/b';", ["../../src/b"]],
    ["export from", 'export * from "../../src/c";', ["../../src/c"]],
    ["side-effect import", 'import "../../src/d";', ["../../src/d"]],
    [
      "dynamic import",
      'const e = await import("../../src/e");',
      ["../../src/e"],
    ],
    ["require", 'const f = require("../../src/f");', ["../../src/f"]],
    ["type-query import", 'let g: import("../../src/g").G;', ["../../src/g"]],
    [
      "an import broken across lines",
      'import {\n  h,\n} from "../../src/h";\nconst i = import(\n  "../../src/i"\n);',
      ["../../src/h", "../../src/i"],
    ],
    [
      "a template literal without a hole",
      "await import(`../../src/j`);",
      ["../../src/j"],
    ],
    [
      "an import sharing its line with a comment",
      '/* k */ import "../../src/k"; // from "prose"\n */ import "../../src/l";',
      ["../../src/k", "prose", "../../src/l"],
    ],
    [
      "whole-line comments",
      '// import "../../src/m";\n/* import "../../src/n"; */\n/**\n * import("../../src/o")\n * from "../../src/p"\n */\n',
      [],
    ],
    [
      "import.meta and an imported name",
      "import.meta.url; important('q');",
      [],
    ],
  ];
  for (const [form, source, specifiers] of found)
    assert.deepEqual(importSpecifiers(source), specifiers, form);

  const opaque: [form: string, source: string, count: number][] = [
    ["a variable", "await import(name);", 1],
    ["a concatenation", 'require(root + "/x");', 1],
    ["a template literal with a hole", "await import(`../${name}`);", 1],
    ["a commented-out call", "// await import(name);", 0],
    ["a literal", 'await import(\n  "./x"\n); require("./y");', 0],
  ];
  for (const [form, source, count] of opaque)
    assert.equal(opaqueImports(source).length, count, form);
});

test("the shared libraries stay game-agnostic: no import reaches the game or an undeclared package", () => {
  for (const [name, allowed] of Object.entries(ALLOWED)) {
    const root = path.resolve("packages", name, "src");
    let imports = 0;
    for (const file of sources(root)) {
      const text = readFileSync(file, "utf8");
      assert.deepEqual(
        opaqueImports(text),
        [],
        `${file} names a module the scan cannot read`,
      );
      for (const specifier of importSpecifiers(text)) {
        imports++;
        assert.match(specifier, allowed, `${file} imports ${specifier}`);
        if (specifier.startsWith("."))
          assert.ok(
            path
              .resolve(path.dirname(file), specifier)
              .startsWith(root + path.sep),
            `${file} leaves its package via ${specifier}`,
          );
      }
    }
    // The scan once matched single quotes only and went blind when the formatter switched to double quotes.
    assert.ok(imports > 0, `${name}: the scan found no imports to check`);
  }
});
