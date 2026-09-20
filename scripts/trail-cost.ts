/**
 * What trail presentation costs per frame, on the pinned recording rather than a synthetic fixture.
 *
 *   pnpm exec tsx scripts/trail-cost.ts          # 3000 ticks, three frames each
 *   TICKS=8000 pnpm exec tsx scripts/trail-cost.ts
 *
 * The recording is replayed in Node and each tick is presented three times, as a 60 Hz screen draws a
 * 20 Hz simulation, with the first rider led ahead so its speculative tip is rewritten every frame. Both
 * pipelines run on the same views:
 *
 *  - "fullRebuild" is what a frame cost before issue #254's append-only history: `completeTrailStrokes`
 *    re-derives every path of every rider, and every triangle is built again. (It is a floor on that cost:
 *    the old `TrailRibbonCache` also serialised every stroke to JSON on every frame to notice.)
 *  - "retained" is `TrailHistory` plus the current `TrailRibbonCache`, which build only what arrived since
 *    the last frame.
 *
 * `ribbonVerticesPerFrame` is the same on both by construction — the same picture is drawn either way, and
 * `scripts/render-parity.ts` is what proves that. The timings are one machine's Node numbers for the trail
 * pipeline alone, not frame time in a browser; `scripts/phaser-benchmark.ts` measures that.
 */
import { readFileSync } from "node:fs";
import {
  applyTick,
  createRoomState,
} from "../games/fuse-riders/src/engine/apply-tick.js";
import { BotController } from "../games/fuse-riders/src/engine/bot-controller.js";
import { defaultRoomSettings } from "../games/fuse-riders/src/engine/room-settings.js";
import { toView } from "../games/fuse-riders/src/engine/game.js";
import type { WorldView } from "../games/fuse-riders/src/engine/view.js";
import {
  streamReader,
  type Recording,
} from "../games/fuse-riders/tests/fixtures/replay-log.js";
import { presentWorld } from "../games/fuse-riders/src/render/time/present.js";
import { completeTrailStrokes } from "../games/fuse-riders/src/render/phaser/trails.js";
import { TrailHistory } from "../games/fuse-riders/src/render/phaser/trail-history.js";
import {
  TrailRibbonCache,
  trailRibbon,
} from "../games/fuse-riders/src/render/phaser/trail-ribbon.js";

const ticks = Number(process.env.TICKS ?? 3000);
if (!Number.isInteger(ticks) || ticks < 1 || ticks > 20000)
  throw Error("TICKS must be a whole number of ticks up to 20000");
// The cosmetic ribbon width the arena uses; only the vertex counts depend on it.
const WIDTH = 10;

const recording: Recording = JSON.parse(
  readFileSync(
    new URL(
      "../games/fuse-riders/tests/fixtures/mechanics-recording.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const state = createRoomState(recording.matchId, defaultRoomSettings());
const bots = new BotController();
const streams = streamReader(recording.entries);
const history = new TrailHistory();
const cache = new TrailRibbonCache(WIDTH);

let frames = 0,
  points = 0,
  built = 0,
  vertices = 0,
  drawn = 0,
  rebuildMs = 0,
  retainMs = 0;
let older: WorldView | undefined;

for (let tick = 1; tick <= ticks; tick++) {
  applyTick(state, recording.creator, streams(tick), bots);
  const newer = { ...toView(state.game), tick: state.game.tick };
  const led = newer.players[0];
  for (const fraction of [0.34, 0.67, 1]) {
    const view = presentWorld(
      older,
      newer,
      Math.min((older?.tick ?? newer.tick) + fraction, newer.tick),
      led && {
        id: led.id,
        controls: { left: fraction > 0.5, right: false },
        lead: fraction,
      },
    );
    frames++;

    let start = performance.now();
    const rebuilt = completeTrailStrokes(
      view.players,
      view.tick,
      view.phase,
      view.rules,
      view.tick,
    );
    // A cache with nothing retained is what a frame that changed everything got.
    new TrailRibbonCache(WIDTH).update(rebuilt);
    rebuildMs += performance.now() - start;
    for (const stroke of rebuilt)
      for (const path of stroke.paths) {
        points += path.length;
        vertices += trailRibbon(path, WIDTH / 2).length;
      }

    start = performance.now();
    const strokes = history.complete(
      view.players,
      `${recording.matchId}:${view.round}`,
      view.tick,
      view.phase,
      view.rules,
      view.tick,
    );
    const ribbons = cache.update(strokes);
    retainMs += performance.now() - start;
    built += history.builtLastFrame();
    for (const ribbon of ribbons) drawn += ribbon.vertices.length;
  }
  older = newer;
}

const per = (total: number) => Number((total / frames).toFixed(1));
console.log(
  JSON.stringify(
    {
      recording: "games/fuse-riders/tests/fixtures/mechanics-recording.json",
      ticks,
      frames,
      pathPointsPerFrame: { fullRebuild: per(points), retained: per(built) },
      ribbonVerticesPerFrame: { fullRebuild: per(vertices), drawn: per(drawn) },
      msPerFrame: {
        fullRebuild: Number((rebuildMs / frames).toFixed(3)),
        retained: Number((retainMs / frames).toFixed(3)),
      },
    },
    null,
    2,
  ),
);
