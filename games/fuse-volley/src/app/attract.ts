import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { fuseVolleyGame, DEFAULT_SETTINGS } from "../online/game.js";
import { createScene } from "../render/scene.js";
import { loadArt, browserImages } from "./art.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(fuseVolleyGame, DEFAULT_SETTINGS);
  const renderer = createScene(demoCanvas(host), {
    art: loadArt(import.meta.env.BASE_URL, browserImages),
  });
  return {
    advance: demo.advance,
    tick: demo.tick,
    render(now: number) {
      const view = demo.view().world;
      if (view) renderer.draw(view, now, -1);
    },
    dispose: () => renderer.destroy(),
  };
}
