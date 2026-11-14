import { createAttractGame } from "fuse-netcode";
import { awaitAttractReady, demoCanvas } from "fuse-ui";
import { fuseDriversGame, DEFAULT_SETTINGS } from "../game/index.js";
import { mountArena } from "./arena/index.js";
export async function createAttract(host: HTMLElement, signal?: AbortSignal) {
  const demo = createAttractGame(fuseDriversGame, DEFAULT_SETTINGS, {
    warmup: 180,
  });
  const canvas = demoCanvas(host);
  let renderer!: ReturnType<typeof mountArena>;
  const ready = new Promise<void>((resolve, reject) => {
    renderer = mountArena(canvas, {
      assetBase: `${import.meta.env.BASE_URL}fuse-drivers/assets/`,
      onReady: resolve,
      onError: reject,
    });
  });
  await awaitAttractReady(ready, () => renderer.destroy(), signal);
  return {
    advance: demo.advance,
    tick: demo.tick,
    render: () => renderer.render(demo.view(), 1),
    dispose: () => renderer.destroy(),
  };
}
