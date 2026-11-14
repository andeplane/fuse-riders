import type { Options } from "webamp";

/** Webamp's classic panels are 275x116, including the playlist's default size. */
export const WEBAMP_EMBED_SIZE = { width: 275, height: 348 };

/** Keep every panel visible from the first render; Webamp centres this group in its mount. */
export const WEBAMP_EMBED_OPTIONS = {
  enableHotkeys: false,
  enableDoubleSizeMode: false,
  windowLayout: {
    main: { position: { left: 0, top: 0 } },
    equalizer: { position: { left: 0, top: 116 } },
    playlist: { position: { left: 0, top: 232 } },
  },
} satisfies Options;
