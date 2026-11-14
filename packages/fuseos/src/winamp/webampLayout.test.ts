import {
  renderWebampInCorner,
  WEBAMP_OPEN_MARGIN,
  WEBAMP_OPTIONS,
  WEBAMP_PANEL_HEIGHT,
  WEBAMP_PANEL_WIDTH,
  WEBAMP_PLAYLIST_EXTRA_ROWS,
  WEBAMP_PLAYLIST_ROW_HEIGHT,
  WEBAMP_STACK_SIZE,
  webampOpenBox,
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

describe(webampOpenBox.name, () => {
  it("is the box whose centre puts the stack in the desktop's top right corner", () => {
    const desktop = { width: 1280, height: 772 };
    const box = webampOpenBox(desktop);
    // Centred in the box, the stack's right edge is one margin from the desktop's and its top one margin down.
    const left = (box.width - WEBAMP_STACK_SIZE.width) / 2;
    const top = (box.height - WEBAMP_STACK_SIZE.height) / 2;
    expect(left + WEBAMP_STACK_SIZE.width).toBe(
      desktop.width - WEBAMP_OPEN_MARGIN,
    );
    expect(top).toBe(WEBAMP_OPEN_MARGIN);
  });

  it("is the desktop itself where the stack and its margins do not fit, so Winamp centres", () => {
    const narrow = { width: 300, height: 800 };
    const short = { width: 1280, height: 480 };
    const unmeasured = { width: 0, height: 0 };
    expect(webampOpenBox(narrow)).toBe(narrow);
    expect(webampOpenBox(short)).toBe(short);
    expect(webampOpenBox(unmeasured)).toBe(unmeasured);
  });
});

describe(renderWebampInCorner.name, () => {
  /** A player that notes the mount's inline box as `renderInto` starts, which is when Webamp measures it. */
  function measuringPlayer() {
    const measured: { inset: string; width: string; height: string }[] = [];
    return {
      measured,
      renderInto: (node: HTMLElement) => {
        const { inset, width, height } = node.style;
        measured.push({ inset, width, height });
        return Promise.resolve();
      },
    };
  }

  function mount(): HTMLElement {
    const node = document.createElement("div");
    node.style.position = "absolute";
    node.style.inset = "0";
    return node;
  }

  it("hands Webamp the corner box for its measurement and the desktop-sized mount straight after", async () => {
    const player = measuringPlayer();
    const node = mount();
    const desktop = { width: 1280, height: 772 };
    const rendering = renderWebampInCorner(player, node, desktop);
    const box = webampOpenBox(desktop);
    expect(player.measured).toEqual([
      {
        inset: "0 auto auto 0",
        width: `${box.width}px`,
        height: `${box.height}px`,
      },
    ]);
    // Restored before the render resolves: nothing is drawn against the temporary box.
    expect(node.style.inset).toBe("0");
    expect(node.style.width).toBe("");
    expect(node.style.height).toBe("");
    await rendering;
  });

  it("leaves the mount alone on a desktop too small for a corner", async () => {
    const player = measuringPlayer();
    const node = mount();
    await renderWebampInCorner(player, node, { width: 320, height: 480 });
    expect(player.measured).toEqual([{ inset: "0", width: "", height: "" }]);
  });
});
