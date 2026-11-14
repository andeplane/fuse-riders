import { windowMeta } from "../desktop/windowMeta";
import {
  appStateReducer,
  DEFAULT_STATE,
  parseAppState,
} from "../state/appState";
import { deepLinkContents } from "../state/deepLink";

const games = { find: () => undefined, icon: () => undefined };

describe("mIRC as a FuseOS program", () => {
  it("opens from ?open=mirc", () => {
    expect(deepLinkContents(["mirc"], { has: () => false })).toEqual([
      { kind: "mirc" },
    ]);
  });

  it("is a single instance", () => {
    const once = appStateReducer(DEFAULT_STATE, {
      type: "open",
      content: { kind: "mirc" },
    });
    const twice = appStateReducer(once, {
      type: "open",
      content: { kind: "mirc" },
    });
    expect(twice.windows).toHaveLength(1);
  });

  it("survives a reload, caption included, and rejects a malformed caption", () => {
    const stored = JSON.stringify({
      version: 1,
      windows: [
        {
          id: "w1",
          minimized: false,
          maximized: false,
          kind: "mirc",
          caption: "mIRC - [Status]",
        },
      ],
    });
    expect(parseAppState(stored).windows[0]).toMatchObject({
      kind: "mirc",
      caption: "mIRC - [Status]",
    });
    const bad = stored.replace('"mIRC - [Status]"', "7");
    expect(parseAppState(bad).windows).toEqual([]);
  });

  it("titles its frame with the caption, or mIRC", () => {
    const base = {
      id: "w1",
      minimized: false,
      maximized: false,
      kind: "mirc" as const,
    };
    expect(windowMeta(base, games)).toMatchObject({
      title: "mIRC",
      icon: "mirc",
      resizable: true,
    });
    expect(
      windowMeta({ ...base, caption: "mIRC - [#fuse [3]]" }, games).title,
    ).toBe("mIRC - [#fuse [3]]");
  });
});
