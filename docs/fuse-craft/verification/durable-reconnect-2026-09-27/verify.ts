import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  decodeState,
  step,
  hashState,
} from "../../../../games/fuse-craft/src/engine/index.ts";
import {
  aiCommands,
  type AiStrategy,
} from "../../../../games/fuse-craft/src/engine/ai.ts";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");
const manifest = JSON.parse(read("matrix-manifest.json"));
for (const [file, expected] of Object.entries(manifest.engineFiles)) {
  if (
    createHash("sha256")
      .update(read(`../../../../games/fuse-craft/src/engine/${file}`))
      .digest("hex") !== expected
  )
    throw new Error(`Qualified engine drift: ${file}`);
}
for (const [file, expected] of Object.entries(manifest.mapHashes)) {
  if (
    createHash("sha256")
      .update(read(`../../../../${file}`))
      .digest("hex") !== expected
  )
    throw new Error(`Qualified map drift: ${file}`);
}
for (const slot of [0, 1])
  for (const pair of ["balanced", "pressure"] as const) {
    const path =
      pair === "balanced"
        ? `fresh-${slot}.replay.json`
        : `../brain-finisher-2026-09-27/pr-${slot}.replay.json`;
    const replay = JSON.parse(read(path));
    let world = decodeState(JSON.stringify(replay.initial)),
      cursor = 0;
    const strategies: [AiStrategy, AiStrategy] =
      pair === "balanced" ? ["balanced", "balanced"] : ["pressure", "relay"];
    while (world.tick < replay.ticks) {
      const row = replay.commands[cursor];
      const expected = row?.tick === world.tick ? (cursor++, row.commands) : [];
      const actual = world.players.flatMap((player, index) =>
        aiCommands(world, player.id, strategies[index]!),
      );
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(
          `Command drift ${pair} seat ${slot} tick ${world.tick}`,
        );
      world = step(world, expected);
    }
    if (hashState(world) !== replay.hash)
      throw new Error(`Replay drift: ${pair} seat ${slot}`);
    console.log(
      JSON.stringify({
        pair,
        slot,
        hash: hashState(world),
        seconds: world.tick / 20,
        winner: world.winnerId,
        verified: true,
      }),
    );
  }
