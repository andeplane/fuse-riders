import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("tournament resumes missing seats without replacing results or mixing configurations", () => {
  const output = mkdtempSync(join(tmpdir(), "fuse-tournament-"));
  const args = [
    "--import",
    "tsx",
    "scripts/fuse-craft-tournament.ts",
    "--maps",
    "close-quarters",
    "--seconds",
    "1",
    "--strategies",
    "balanced",
    "--out",
    output,
  ];
  const run = (extra: string[] = []) =>
    execFileSync(process.execPath, [...args, ...extra], {
      encoding: "utf8",
      stdio: "pipe",
    });
  try {
    run();
    const path = join(output, "results.jsonl");
    const original = readFileSync(path, "utf8");
    assert.equal(original.trim().split("\n").length, 2);
    assert.throws(() => run(), /Output already exists/);
    writeFileSync(path, original.split("\n")[0] + "\n");
    assert.match(run(["--resume"]), /Resuming 1 completed matches/);
    assert.equal(readFileSync(path, "utf8"), original);
    assert.match(run(["--resume"]), /Resuming 2 completed matches/);
    assert.equal(readFileSync(path, "utf8"), original);
    const manifestPath = join(output, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, seconds: 2 }));
    assert.throws(() => run(["--resume"]), /configuration differs/);
    assert.equal(readFileSync(path, "utf8"), original);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        ...manifest,
        harnessVersion: manifest.harnessVersion + 1,
      }),
    );
    assert.throws(() => run(["--resume"]), /configuration differs/);
    writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, simulationDirty: "engine changed" }),
    );
    assert.throws(() => run(["--resume"]), /original run is dirty/);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(path, original + original.split("\n")[0] + "\n");
    assert.throws(() => run(["--resume"]), /invalid or duplicate result/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
