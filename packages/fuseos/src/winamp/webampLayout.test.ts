import {
  WEBAMP_OPTIONS,
  WEBAMP_PANEL_HEIGHT,
  WEBAMP_PANEL_WIDTH,
  WEBAMP_PLAYLIST_EXTRA_ROWS,
  WEBAMP_PLAYLIST_ROW_HEIGHT,
  WEBAMP_STACK_SIZE,
} from "./webampLayout";

describe("Winamp layout", () => {
  it("docks main, equalizer and playlist in one column, the playlist four rows taller", () => {
    const { main, equalizer, playlist } = WEBAMP_OPTIONS.windowLayout;
    expect(main.position).toEqual({ left: 0, top: 0 });
    expect(equalizer.position).toEqual({ left: 0, top: WEBAMP_PANEL_HEIGHT });
    expect(playlist.position).toEqual({
      left: 0,
      top: WEBAMP_PANEL_HEIGHT * 2,
    });
    expect(playlist.size).toEqual({
      extraWidth: 0,
      extraHeight: WEBAMP_PLAYLIST_EXTRA_ROWS,
    });
    expect(WEBAMP_STACK_SIZE).toEqual({
      width: WEBAMP_PANEL_WIDTH,
      height:
        WEBAMP_PANEL_HEIGHT * 3 +
        WEBAMP_PLAYLIST_ROW_HEIGHT * WEBAMP_PLAYLIST_EXTRA_ROWS,
    });
  });

  it("keeps the desktop's keyboard and the single-size skin", () => {
    expect(WEBAMP_OPTIONS.enableHotkeys).toBe(false);
    expect(WEBAMP_OPTIONS.enableDoubleSizeMode).toBe(false);
  });
});
