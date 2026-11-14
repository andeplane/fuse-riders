import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { axeGame, DEFAULT_SETTINGS } from "../online/game.js";
import { VIEW_W, VIEW_H } from "../engine/view-kit.js";
import { createScene } from "../render/scene.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(axeGame, DEFAULT_SETTINGS);
  const canvas = demoCanvas(host, VIEW_W, VIEW_H),
    pen = canvas.getContext("2d")!;
  const scene = createScene((width, height) => {
    const image = host.ownerDocument.createElement("canvas");
    image.width = width;
    image.height = height;
    const paint = image.getContext("2d")!;
    paint.imageSmoothingEnabled = false;
    return {
      image,
      paint,
      putPixels: (rgba: Uint8ClampedArray<ArrayBuffer>) =>
        paint.putImageData(new ImageData(rgba, width, height), 0, 0),
    };
  });
  return {
    advance: demo.advance,
    tick: demo.tick,
    render() {
      const view = demo.view().world;
      if (view) scene.draw(pen, view, view.step);
    },
    dispose() {
      canvas.remove();
    },
  };
}
