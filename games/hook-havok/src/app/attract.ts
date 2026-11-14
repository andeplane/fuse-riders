import { createAttractGame } from "fuse-netcode";
import { awaitAttractReady } from "fuse-ui";
import { hookGame } from "../online/game.js";
import { DEFAULT_TUNING } from "../engine/world.js";
import { createShowcase } from "../render/scene.js";
export async function createAttract(host: HTMLElement, signal?: AbortSignal) {
  const demo = createAttractGame(
    hookGame,
    { ...DEFAULT_TUNING, bomb: "fuse", experiment: "ball" },
    { bots: 4 },
  );
  let scene!: ReturnType<typeof createShowcase>;
  const ready = new Promise<void>((resolve, reject) => {
    scene = createShowcase(host, {
      externallyStepped: true,
      paused: false,
      idleOnly: false,
      atmosphere: true,
      view: () => demo.view(),
      ready: resolve,
      failed: (message) => reject(new Error(message)),
      phase() {},
      time() {},
    });
  });
  await awaitAttractReady(ready, () => scene.destroy(), signal);
  return {
    advance: demo.advance,
    tick: demo.tick,
    render: (now: number) => scene.drawFrame(now),
    dispose: () => scene.destroy(),
  };
}
