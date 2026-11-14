import { demoCanvas } from "fuse-ui";
import { createAttractMatch } from "./attract-match.js";
import { createScene } from "../render/scene.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractMatch();
  const renderer = createScene(demoCanvas(host));
  return {
    advance: demo.advance,
    tick: demo.tick,
    render(now: number) {
      renderer.draw(demo.view(), now, -1);
    },
    dispose: () => renderer.destroy(),
  };
}
