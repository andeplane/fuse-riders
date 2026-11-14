import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { fuseballGame, DEFAULT_SETTINGS } from "../online/game.js";
import { createScene } from "../render/scene.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(fuseballGame, DEFAULT_SETTINGS);
  const renderer = createScene(demoCanvas(host));
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
