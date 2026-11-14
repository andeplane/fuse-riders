import { createAttractGame } from "fuse-netcode";
import { awaitAttractReady } from "fuse-ui";
import { ballGame, DEFAULT_SETTINGS } from "../online/game.js";
import { createRenderer } from "../render/arena.js";
export async function createAttract(host: HTMLElement, signal?: AbortSignal) {
  const demo = createAttractGame(ballGame, DEFAULT_SETTINGS);
  const renderer = createRenderer(host, import.meta.env.BASE_URL);
  await awaitAttractReady(renderer.ready, () => renderer.destroy(), signal);
  return {
    advance: demo.advance,
    tick: demo.tick,
    render: (now: number) => renderer.paint(demo.view(), now),
    dispose: () => renderer.destroy(),
  };
}
