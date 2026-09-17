import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ALLOWED: Record<string, RegExp> = {
  "fuse-network-protocol": /^(\.|node:)/,
  "fuse-network-fe": /^(\.|fuse-network-protocol$)/,
  "fuse-network-be":
    /^(\.|node:|ws$|fuse-network-protocol$|@google-cloud\/|google-auth-library$)/,
};
const sources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(path.join(directory, entry.name))
      : entry.name.endsWith(".ts")
        ? [path.join(directory, entry.name)]
        : [],
  );

test("the networking libraries stay game-agnostic: no import reaches the game or an undeclared package", () => {
  for (const [name, allowed] of Object.entries(ALLOWED)) {
    const root = path.resolve("packages", name, "src");
    for (const file of sources(root))
      for (const match of readFileSync(file, "utf8").matchAll(
        /from '([^']+)'/g,
      )) {
        const specifier = match[1]!;
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
});
