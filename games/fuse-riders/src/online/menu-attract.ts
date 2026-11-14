import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { fuseGame } from "./fuse-game.js";
import { defaultRoomSettings } from "../engine/room-settings.js";
import { mountArenaPresentation } from "../render/phaser/presentation.js";
import { selectedTheme } from "../client/theme-choice.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(fuseGame, defaultRoomSettings());
  const canvas = demoCanvas(host);
  const presentation = mountArenaPresentation(
    canvas,
    (replacement) => {
      host.replaceChildren(replacement);
    },
    () => {},
  );
  const theme = selectedTheme();
  return {
    advance: demo.advance,
    tick: demo.tick,
    render(now: number) {
      const view = demo.view();
      presentation.render(view, now, theme, demo.scope());
    },
    dispose: () => presentation.destroy(),
  };
}
