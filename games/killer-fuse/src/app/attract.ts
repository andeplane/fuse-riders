/**
 * The shared attract lifecycle's driver for Killer Fuse: the real arena renderer drawing the bot-only demo match
 * (`attract-match.ts`) behind the main menu and the lobby. It is silent — the renderer is muted and its synthesised
 * bed is off — and it is disposed when the menu is left, taking the canvas and the renderer's observers with it.
 */
import { awaitAttractReady } from "fuse-ui";
import type { RoundView } from "../engine/index.js";
import { createArenaView } from "../render/index.js";
import type { EventFeed } from "../render/api.js";
import { createAttractMatch } from "./attract-match.js";

/** Nothing is rolled back here, so every step is confirmed as soon as it is drawn. */
const feedOf = (view: RoundView): EventFeed => ({
  ticks: [{ tick: view.step, events: view.events }],
  confirmed: view.step,
});

const NOBODY: readonly string[] = ["", "", "", "", "", ""];

export async function createAttract(
  host: HTMLElement,
  artUrl: string,
  signal?: AbortSignal,
) {
  const match = createAttractMatch({ warmupTicks: 60 });
  const arena = createArenaView(host, {
    artUrl,
    localSlot: -1,
    names: [...NOBODY],
    muted: true,
    bed: false,
  });
  await awaitAttractReady(arena.ready, () => arena.destroy(), signal);
  arena.advance(match.view(), feedOf(match.view()));
  return {
    advance() {
      match.advance();
      arena.advance(match.view(), feedOf(match.view()));
    },
    tick: () => match.tick(),
    render() {
      arena.render(match.previous(), match.view(), 1);
    },
    dispose: () => arena.destroy(),
  };
}
