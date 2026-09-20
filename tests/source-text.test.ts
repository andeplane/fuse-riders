import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const TEXT = /\.(ts|tsx|js|mjs|cjs|json|css|html|md|sh|ya?ml)$/;
const files = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.name === "node_modules"
      ? []
      : entry.isDirectory()
        ? files(path.join(directory, entry.name))
        : TEXT.test(entry.name)
          ? [path.join(directory, entry.name)]
          : [],
  );
const roots = [
  "service",
  "tests",
  "scripts",
  ...readdirSync("packages", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join("packages", entry.name, "src")),
  path.join("games", "fuse-riders", "src"),
  path.join("games", "fuse-riders", "tests"),
].filter((root) => existsSync(root));
const TAB = 0x09,
  NEWLINE = 0x0a,
  RETURN = 0x0d,
  SPACE = 0x20,
  DELETE = 0x7f;

test("source files are text: no raw control bytes other than tab, newline and carriage return", () => {
  // A regex once carried a raw NUL, unit separator and DEL: `file` called the module data and grep skipped it as
  // binary. Such characters are written as escapes in source.
  const found: string[] = [];
  let scanned = 0;
  for (const file of roots.flatMap(files)) {
    scanned++;
    let line = 1;
    for (const byte of readFileSync(file)) {
      if (byte === NEWLINE) line++;
      else if (
        (byte < SPACE && byte !== TAB && byte !== RETURN) ||
        byte === DELETE
      )
        found.push(`${file}:${line} 0x${byte.toString(16).padStart(2, "0")}`);
    }
  }
  assert.ok(scanned > 100, `scanned ${scanned} files`);
  assert.deepEqual(found, []);
});
