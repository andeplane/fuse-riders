import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { fuseSurgeGame, DEFAULT_SETTINGS } from "../online/game.js";
import { BOT_NAMES } from "../online/names.js";
import { createScene } from "../render/scene.js";

/** The silent demo behind the menus: four bots on the deck, drawn by the match's own scene. */
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(fuseSurgeGame, DEFAULT_SETTINGS, { bots: 4 });
  const renderer = createScene(demoCanvas(host));
  return {
    advance: demo.advance,
    tick: demo.tick,
    render(now: number) {
      const view = demo.view().world;
      if (view) renderer.draw(view, now, -1, BOT_NAMES);
    },
    dispose: () => renderer.destroy(),
  };
}
