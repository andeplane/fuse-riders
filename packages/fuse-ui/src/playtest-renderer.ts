import { registerPlaytestCapture } from "./playtest-input.js";

/** Only rendering is used: a report must never step a game's simulation or clock. */
export interface SnapshotRenderer {
  preRender(): void;
  postRender(): void;
  snapshot(callback: (image: unknown) => void, type?: string): unknown;
}

export interface SnapshotGame<R extends SnapshotRenderer> {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: R;
  readonly scene: { render(renderer: R): void };
}

/**
 * Read the actual framebuffer, including WebGL renderers with a discarded drawing buffer.
 * Redrawing the existing display list also works while a presentation loop sleeps.
 */
export function registerPhaserPlaytestCapture<R extends SnapshotRenderer>(
  doc: Document,
  game: SnapshotGame<R>,
): () => void {
  return registerPlaytestCapture(doc, () => {
    if (!game.canvas?.isConnected || !game.renderer)
      return Promise.resolve(new Map());
    return new Promise<ReadonlyMap<HTMLCanvasElement, string>>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Game screenshot timed out")),
          2000,
        );
        try {
          game.renderer.snapshot((image) => {
            clearTimeout(timeout);
            if (
              image &&
              typeof image === "object" &&
              "src" in image &&
              typeof image.src === "string"
            )
              resolve(new Map([[game.canvas, image.src]]));
            else reject(new Error("Game screenshot could not be read"));
          }, "image/png");
          game.renderer.preRender();
          game.scene.render(game.renderer);
          game.renderer.postRender();
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      },
    );
  });
}
