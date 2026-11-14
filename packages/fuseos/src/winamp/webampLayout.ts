import type { Options } from "webamp";

import type { Size } from "../windows/windowManager";

/** Webamp's classic panels are 275 wide; main and equalizer are 116 tall and the playlist grows in 29px rows. */
export const WEBAMP_PANEL_WIDTH = 275;
export const WEBAMP_PANEL_HEIGHT = 116;
export const WEBAMP_PLAYLIST_ROW_HEIGHT = 29;

/** Rows added to the playlist's base size, so eight or so tracks show at once instead of three. */
export const WEBAMP_PLAYLIST_EXTRA_ROWS = 4;

/** The whole main/equalizer/playlist stack, as Webamp centres it on the desktop before the first render. */
export const WEBAMP_STACK_SIZE = {
  width: WEBAMP_PANEL_WIDTH,
  height:
    WEBAMP_PANEL_HEIGHT * 3 +
    WEBAMP_PLAYLIST_ROW_HEIGHT * WEBAMP_PLAYLIST_EXTRA_ROWS,
};

/**
 * Webamp as it runs on the desktop: every panel visible and docked in one column from the first
 * render, hotkeys off so the player never grabs the desktop's keyboard, double size off, and a
 * taller playlist. Webamp draws its own title bars and handles dragging, docking and shading itself.
 */
export const WEBAMP_OPTIONS = {
  enableHotkeys: false,
  enableDoubleSizeMode: false,
  windowLayout: {
    main: { position: { left: 0, top: 0 } },
    equalizer: { position: { left: 0, top: WEBAMP_PANEL_HEIGHT } },
    playlist: {
      position: { left: 0, top: WEBAMP_PANEL_HEIGHT * 2 },
      size: { extraWidth: 0, extraHeight: WEBAMP_PLAYLIST_EXTRA_ROWS },
    },
  },
} satisfies Options;

/** The gap Winamp keeps from the desktop's top and right edges when it opens. */
export const WEBAMP_OPEN_MARGIN = 16;

/**
 * The size of the box to hand Webamp while it places its windows. Webamp centres the stack in the scroll size
 * of the node it renders into, measured once as `renderInto` starts, and has no option for where the stack
 * goes. A box anchored at the desktop's top left whose centre is where the stack's centre should be puts
 * Winamp in the top right corner, clear of the launcher that opens in the middle. A desktop without room for
 * the stack and its margins gets itself back: Winamp centres there, as Webamp would on its own.
 */
export function webampOpenBox(desktop: Size): Size {
  const fits =
    desktop.width >= WEBAMP_STACK_SIZE.width + 2 * WEBAMP_OPEN_MARGIN &&
    desktop.height >= WEBAMP_STACK_SIZE.height + 2 * WEBAMP_OPEN_MARGIN;
  if (!fits) return desktop;
  return {
    width: 2 * (desktop.width - WEBAMP_OPEN_MARGIN) - WEBAMP_STACK_SIZE.width,
    height: 2 * WEBAMP_OPEN_MARGIN + WEBAMP_STACK_SIZE.height,
  };
}

/**
 * Renders Webamp into its desktop-sized mount with the stack in the top right corner: the mount is given
 * `webampOpenBox` for the one synchronous measurement `renderInto` makes and is the desktop's size again
 * before anything is drawn, so dragging and edge snapping work over the whole desktop as before.
 */
export function renderWebampInCorner(
  player: { renderInto(node: HTMLElement): Promise<void> },
  mount: HTMLElement,
  desktop: Size,
): Promise<void> {
  const box = webampOpenBox(desktop);
  if (box === desktop) return player.renderInto(mount);
  const { inset, width, height } = mount.style;
  mount.style.inset = "0 auto auto 0";
  mount.style.width = `${box.width}px`;
  mount.style.height = `${box.height}px`;
  const rendering = player.renderInto(mount);
  mount.style.inset = inset;
  mount.style.width = width;
  mount.style.height = height;
  return rendering;
}
