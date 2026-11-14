import type { Options } from "webamp";

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
