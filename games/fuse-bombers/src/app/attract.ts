import Phaser from "phaser";
import { createAttractGame } from "fuse-netcode";
import { awaitAttractReady } from "fuse-ui";
import { bombersGame, DEFAULT_SETTINGS } from "../online/game.js";
import {
  RoundScene,
  VIEW_WIDTH,
  VIEW_HEIGHT,
  type RoundSource,
} from "../render/round-scene.js";
export async function createAttract(host: HTMLElement, signal?: AbortSignal) {
  const demo = createAttractGame(bombersGame, DEFAULT_SETTINGS, { bots: 4 });
  const first = demo.view().world;
  if (!first) throw new Error("Bombers attract did not start");
  const source: RoundSource = {
    get view() {
      return demo.view().world ?? first;
    },
    get round() {
      const view = demo.view();
      return `${demo.scope()}:${view.round}`;
    },
    advance: () => [],
  };
  let game!: Phaser.Game;
  const ready = new Promise<void>((resolve) => {
    game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: host,
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      banner: false,
      audio: { noAudio: true },
      callbacks: {
        postBoot(booted) {
          booted.scene.add(RoundScene.KEY, RoundScene, true, { source });
          resolve();
        },
      },
    });
  });
  const destroy = () => {
    game.destroy(true);
    if (game.scene.isBooted) game.step(0, 0);
  };
  await awaitAttractReady(ready, destroy, signal);
  // Phaser starts its loop after postBoot returns; stop it after that stack unwinds.
  game.loop.stop();
  let previous = 0;
  return {
    advance: demo.advance,
    tick: demo.tick,
    render(now: number) {
      game.step(now, previous ? Math.min(100, now - previous) : 0);
      previous = now;
    },
    dispose: destroy,
  };
}
