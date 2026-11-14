import { awaitAttractReady, demoCanvas } from "fuse-ui";
import {
  createMatch,
  advance,
  getView,
  candidateVector,
  type Action,
} from "../engine/index.js";
import { WIDTH, HEIGHT } from "../engine/types.js";
import { createArena } from "../render/arena.js";
export async function createAttract(host: HTMLElement, signal?: AbortSignal) {
  const fresh = () =>
    createMatch("menu-demo", 73, [
      { id: "skye", name: "Skye" },
      { id: "ember", name: "Ember" },
      { id: "pip", name: "Pip" },
    ]);
  let match = fresh(),
    waiting = 0;
  const step = () => {
    if (
      match.phase === "over" ||
      match.phase === "fault" ||
      match.tick > 1600
    ) {
      match = fresh();
      waiting = 0;
    }
    const actions: Action[] = [];
    if (match.phase === "aiming" && ++waiting >= 24) {
      const player = match.players[match.active]!,
        target = match.players.find((p) => p.id !== player.id && p.hp > 0);
      if (target)
        for (let i = 0; i < 100; i++) {
          const v = candidateVector(player, target, match.wind, i);
          if (v) {
            actions.push({
              type: "launch",
              actor: player.id,
              round: match.round,
              turn: match.turn,
              ordinal: player.ordinal + 1,
              weapon: "pebble",
              ...v,
            });
            break;
          }
        }
      waiting = 0;
    }
    advance(match, actions);
  };
  for (let i = 0; i < 90; i++) step();
  const canvas = demoCanvas(host, 1200, 700),
    renderer = createArena(
      canvas,
      `${import.meta.env.BASE_URL}games/fuse-birds/art/v1`,
      true,
    );
  await awaitAttractReady(renderer.ready, () => renderer.destroy(), signal);
  return {
    advance: step,
    tick: () => match.tick,
    render(now: number) {
      renderer.paint(
        {
          world: getView(match),
          camera: { x: WIDTH / 2, y: HEIGHT / 2, zoom: 1 },
          shared: true,
        },
        now,
      );
    },
    dispose: () => renderer.destroy(),
  };
}
