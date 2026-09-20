import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  camelCase,
  newGame,
  pascalCase,
  rename,
  takenNames,
} from "../scripts/new-game.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("names follow the id", () => {
  assert.equal(camelCase("snake-eyes"), "snakeEyes");
  assert.equal(pascalCase("snake-eyes"), "SnakeEyes");
  assert.equal(
    rename(
      'export const diceGame = { id: "dice", rules: "dice-1" }; // games/dice',
      "yahtzee",
    ),
    'export const yahtzeeGame = { id: "yahtzee", rules: "yahtzee-1" }; // games/yahtzee',
  );
});

test("new-game copies the dice template to a renamed game whose own tests pass", () => {
  // Under node_modules so the copy resolves the workspace packages the way games/ does.
  const cache = join(root, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "new-game-"));
  try {
    cpSync(join(root, "games", "dice"), join(dir, "dice"), {
      recursive: true,
      filter: (path) => !path.includes("node_modules"),
    });
    const written = newGame("snake-eyes", dir);
    assert.ok(written.includes("package.json"));
    assert.ok(written.includes("src/game/index.ts"));
    assert.ok(written.includes("tests/fixtures/snakeEyes.ts"));
    for (const file of written) {
      const text = readFileSync(join(dir, "snake-eyes", file), "utf8");
      assert.doesNotMatch(text, /dice/i, `${file} still names the template`);
    }
    const manifest = JSON.parse(
      readFileSync(join(dir, "snake-eyes", "package.json"), "utf8"),
    ) as { name: string; exports: Record<string, string> };
    assert.equal(manifest.name, "snake-eyes");
    assert.deepEqual(manifest.exports, {
      ".": "./src/game/index.ts",
      "./platform": "./src/platform.ts",
    });

    const run = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--test",
        "tests/rules.test.ts",
        "games/fuse-riders/tests/checkpoint.test.ts",
      ],
      {
        cwd: join(dir, "snake-eyes"),
        encoding: "utf8",
        // Run as its own test run, not as a subtest reporting to this one.
        env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /pass [1-9]\d*/, "the copy's tests ran");

    assert.throws(() => newGame("snake-eyes", dir), /already exists/);
    assert.throws(() => newGame("dice", dir), /taken/);
    // Workspace directories and package names, the root package and its dependencies.
    for (const name of [
      "fuse-ui",
      "fuse-netcode",
      "fuse-riders",
      "vite",
      "ws",
      "jose",
      "tsx",
    ])
      assert.throws(() => newGame(name, dir), /taken/, name);
    for (const bad of ["Snake", "1up", "a_b", "a--b", "a-", "", "x".repeat(33)])
      assert.throws(() => newGame(bad, dir), /not a game id/, bad);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("taken names come from the root manifest and every workspace", () => {
  const taken = takenNames(root);
  for (const name of [
    "fuse-riders",
    "fuse-ui",
    "fuse-network-be",
    "dice",
    "vite",
    "ws",
    "phaser",
  ])
    assert.ok(taken.has(name), name);
  assert.equal(taken.has("snake-eyes"), false);
});

test("the copied game module is the template under its new id", async () => {
  const cache = join(root, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "new-game-"));
  try {
    cpSync(join(root, "games", "dice"), join(dir, "dice"), { recursive: true });
    newGame("pig", dir);
    const module = (await import(
      pathToFileURL(join(dir, "pig", "src", "game", "index.ts")).href
    )) as { pigGame: { id: string; rules: string } };
    assert.equal(module.pigGame.id, "pig");
    assert.equal(module.pigGame.rules, "pig-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
