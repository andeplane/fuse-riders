import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { graveyardGame } from "../online/game.js";
import { draw } from "../render/scene.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(graveyardGame, { display: false });
  const canvas = demoCanvas(host, 1000, 620),
    ctx = canvas.getContext("2d")!;
  return {
    advance: demo.advance,
    tick: demo.tick,
    render() {
      const world = demo.view().world;
      if (world) draw(ctx, world, "");
    },
    dispose() {
      canvas.remove();
    },
  };
}
