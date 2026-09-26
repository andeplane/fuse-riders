import { readFileSync, writeFileSync } from "node:fs";
import { aiCommands } from "../games/neural-defence/src/engine/ai.js";
import {
  createMatch,
  loadMap,
  step,
  hashState,
} from "../games/neural-defence/src/engine/index.js";

// Normal timings and resources: records actual complete-match evidence.
const map = loadMap(
  JSON.parse(
    readFileSync(
      new URL("../games/neural-defence/maps/skirmish-24.json", import.meta.url),
      "utf8",
    ),
  ),
);
for (const opponent of ["idle", "balanced", "pressure", "economy"] as const) {
  if (process.env.ND_OPPONENT && process.env.ND_OPPONENT !== opponent) continue;
  for (const slot of [0, 1]) {
    if (process.env.ND_SLOT && Number(process.env.ND_SLOT) !== slot) continue;
    let world = createMatch(map, {}, [
      { id: "alpha", slot },
      { id: "beta", slot: 1 - slot },
    ]);
    let contact: number | null = null;
    let rejected = 0;
    while (!world.finished && world.tick < 18_000) {
      world = step(world, [
        ...aiCommands(world, "alpha"),
        ...(opponent !== "idle" ? aiCommands(world, "beta", opponent) : []),
      ]);
      if (world.outcomes.some((e) => e.type === "damage"))
        contact ??= world.tick;
      rejected += world.outcomes.filter((e) => e.type === "rejected").length;
    }
    if (process.env.ND_DUMP === "1")
      writeFileSync(
        `/tmp/neural-skirmish-${opponent}-${slot}.json`,
        JSON.stringify(world),
      );
    console.log(
      JSON.stringify({
        opponent,
        slot,
        rules: world.rulesVersion,
        seconds: world.tick / 20,
        contactSeconds: contact === null ? null : contact / 20,
        finished: world.finished,
        winner: world.winnerId,
        rejected,
        hash: hashState(world),
        players: world.players.map((p) => ({ id: p.id, ...p.statistics })),
      }),
    );
  }
}
