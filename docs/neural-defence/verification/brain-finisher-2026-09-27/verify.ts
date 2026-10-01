import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  decodeState,
  step,
  hashState,
} from "../../../../games/neural-defence/src/engine/index.ts";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");
const manifest = JSON.parse(read("matrix-manifest.json"));
for (const [file, expected] of Object.entries(manifest.engineFiles)) {
  const bytes = read(`../../../../games/neural-defence/src/engine/${file}`);
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
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
for (const slot of [0, 1]) {
  const replay = JSON.parse(read(`pr-${slot}.replay.json`));
  let world = decodeState(JSON.stringify(replay.initial));
  let cursor = 0;
  while (world.tick < replay.ticks) {
    const row = replay.commands[cursor];
    world = step(
      world,
      row?.tick === world.tick ? (cursor++, row.commands) : [],
    );
  }
  if (hashState(world) !== replay.hash)
    throw new Error(`Replay drift: seat ${slot}`);
  console.log(
    JSON.stringify({
      slot,
      hash: hashState(world),
      seconds: world.tick / 20,
      winner: world.winnerId,
      verified: true,
    }),
  );
}
