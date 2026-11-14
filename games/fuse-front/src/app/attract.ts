import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { frontGame, DEFAULT_SETTINGS } from "../online/game.js";
import { Battlefield } from "../render/battlefield.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(frontGame, DEFAULT_SETTINGS, {
    bots: 2,
    warmup: 220,
  });
  const canvas = demoCanvas(host);
  const field = new Battlefield(canvas, (width, height) =>
    Object.assign(host.ownerDocument.createElement("canvas"), {
      width,
      height,
    }),
  );
  field.follow = false;
  let sized = "";
  return {
    advance: demo.advance,
    tick: demo.tick,
    render(now: number) {
      const view = demo.view();
      if (!view.world) return;
      if (sized !== demo.scope()) {
        field.resize(960, 600, 1, view.world);
        sized = demo.scope();
      }
      field.draw(demo.scope(), view.world, undefined, 1, -1, now);
    },
    dispose: () => field.dispose(),
  };
}
