import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { freightGame } from "../online/game.js";
import { DEFAULT_SETTINGS } from "../engine/index.js";
import { createScene, VIEW_W, VIEW_H } from "../render/scene.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(freightGame, DEFAULT_SETTINGS);
  const canvas = demoCanvas(host, VIEW_W, VIEW_H);
  const scene = createScene(canvas.getContext("2d")!, (width, height) => {
    const image = host.ownerDocument.createElement("canvas");
    image.width = width;
    image.height = height;
    return image;
  });
  return {
    advance: demo.advance,
    tick: demo.tick,
    render(now: number) {
      const world = demo.view().world;
      if (world)
        scene.draw({
          world,
          me: "",
          labels: new Map(),
          now,
          reducedMotion: true,
        });
    },
    dispose() {
      canvas.remove();
    },
  };
}
