import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { fuseLaneGame, DEFAULT_SETTINGS } from "../game/index.js";
import { createArt, type ArtImage } from "./art.js";
import { drawBoard } from "./board.js";
import { boardView } from "./layout.js";
import { boardModel } from "./presenter.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(fuseLaneGame, DEFAULT_SETTINGS, {
    bots: 4,
    warmup: 240,
  });
  const canvas = demoCanvas(host, 1200, 750),
    ctx = canvas.getContext("2d")!;
  const art = createArt(
    import.meta.env.BASE_URL,
    () => new Image() as unknown as ArtImage,
    host.ownerDocument,
  );
  const layout = boardView(1200, 750),
    camera = { x: layout.minX / 2, y: layout.minY / 2 };
  const viewer = {
    me: "",
    host: false,
    solo: true,
    display: true,
    shared: false,
  };
  return {
    advance: demo.advance,
    tick: demo.tick,
    render(now: number) {
      const model = boardModel(demo.view(), viewer);
      drawBoard(
        ctx,
        layout,
        camera,
        {
          ...model,
          before: new Map(),
          fraction: 1,
          time: now / 1000,
          hover: -1,
        },
        art,
      );
    },
    dispose() {
      canvas.remove();
    },
  };
}
