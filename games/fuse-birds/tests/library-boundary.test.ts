import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import ts from "typescript";

test("the default package runs a complete match in Node without UI or a room", async () => {
  const api = await import("fuse-birds-game");
  const match = api.createMatch("library", 912, [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ]);
  for (let tick = 0; tick < 10_000 && match.phase !== "over"; tick++) {
    const p = match.players[match.active]!;
    api.advance(
      match,
      match.phase === "aiming"
        ? [
            {
              type: "pass",
              actor: p.id,
              round: match.round,
              turn: match.turn,
              ordinal: p.ordinal + 1,
            },
          ]
        : [],
    );
  }
  assert.equal(match.phase, "over");
  const restored = api.decodeState(api.encodeState(match));
  assert.ok(restored);
  assert.equal(api.hashState(restored), api.hashState(match));
});
test("engine imports stay inside the library and rendering only reads the public view boundary", async () => {
  const root = new URL("../src/", import.meta.url);
  for (const layer of ["engine", "render"])
    for (const file of await readdir(new URL(`${layer}/`, root))) {
      if (!file.endsWith(".ts")) continue;
      const source = ts.createSourceFile(
        file,
        await readFile(new URL(`${layer}/${file}`, root), "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const specifier = node.moduleSpecifier.text;
          if (layer === "engine")
            assert.match(
              specifier,
              /^\.\/[^/]+\.js$/,
              `${file} must import only engine siblings`,
            );
          else if (specifier.includes("engine/"))
            assert.match(
              specifier,
              /^\.\.\/engine\/view(?:-kit)?\.js$/,
              `${file} bypasses the view boundary`,
            );
        }
        if (layer === "engine" && ts.isIdentifier(node))
          assert.ok(
            ![
              "window",
              "document",
              "performance",
              "setInterval",
              "setTimeout",
            ].includes(node.text),
            `${file} reads a browser or clock global`,
          );
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
});
test("player colors survive gaps in the lobby roster and checkpoint recovery", async () => {
  const api = await import("fuse-birds-game");
  const match = api.createMatch("identity", 91, [
    { id: "a", name: "Alpha", slot: 1 },
    { id: "b", name: "Beta", slot: 4 },
  ]);
  assert.deepEqual(
    api.getView(match).players.map((p) => p.slot),
    [1, 4],
  );
  assert.deepEqual(
    api.decodeState(api.encodeState(match))?.players.map((p) => p.slot),
    [1, 4],
  );
  assert.throws(() =>
    api.createMatch("invalid", 91, [
      { id: "a", name: "A", slot: 1 },
      { id: "b", name: "B", slot: 1 },
    ]),
  );
});
