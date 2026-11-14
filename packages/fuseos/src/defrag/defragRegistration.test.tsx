import { render } from "@testing-library/react";

import { createTestGames } from "../__mocks__/renderWithProviders";
import { windowMeta } from "../desktop/windowMeta";
import type { WindowState } from "../state/appState";
import {
  appStateReducer,
  DEFAULT_STATE,
  parseAppState,
  sameInstance,
  serializeAppState,
} from "../state/appState";
import { deepLinkContents, parseOpenParam } from "../state/deepLink";
import { Win98Icon } from "../ui/icons";

import type { DefragWindowContent } from "./defragWindowContent";
import { DEFRAG_DETAILS_SIZE, DEFRAG_SELECT_SIZE } from "./defragWindowContent";

const games = createTestGames();

describe("Disk Defragmenter's registrations", () => {
  it("opens from ?open=defrag", () => {
    expect(
      deepLinkContents(parseOpenParam("?open=defrag"), { has: () => false }),
    ).toEqual([{ kind: "defrag" }]);
  });

  it("is a single instance: opening it again focuses the one that is running", () => {
    expect(sameInstance({ kind: "defrag" }, { kind: "defrag" })).toBe(true);
    expect(sameInstance({ kind: "defrag" }, { kind: "paint" })).toBe(false);
    const running = appStateReducer(DEFAULT_STATE, {
      type: "open",
      content: { kind: "defrag", drive: "C", stage: "running", percent: 40 },
    });
    const again = appStateReducer(running, {
      type: "open",
      content: { kind: "defrag" },
    });
    expect(again.windows).toHaveLength(1);
    expect(again.windows[0]).toMatchObject({ stage: "running", percent: 40 });
  });

  it("survives storage, and a corrupt entry falls back to an empty desktop", () => {
    const state = appStateReducer(DEFAULT_STATE, {
      type: "open",
      content: {
        kind: "defrag",
        drive: "A",
        stage: "running",
        details: true,
        percent: 12,
      },
    });
    expect(parseAppState(serializeAppState(state))).toEqual(state);
    expect(
      parseAppState(
        JSON.stringify({
          version: 1,
          windows: [
            {
              id: "w1",
              minimized: false,
              maximized: false,
              kind: "defrag",
              drive: "Z",
            },
          ],
        }),
      ),
    ).toEqual(DEFAULT_STATE);
  });

  it("has a title bar for each stage, a fixed size and its own icon", () => {
    const window = (
      content: Omit<DefragWindowContent, "kind">,
    ): WindowState => ({
      id: "w1",
      minimized: false,
      maximized: false,
      kind: "defrag",
      ...content,
    });
    expect(windowMeta(window({}), games)).toEqual({
      title: "Select Drive",
      icon: "defrag",
      resizable: false,
      size: DEFRAG_SELECT_SIZE,
    });
    expect(
      windowMeta(
        window({
          stage: "running",
          drive: "C",
          details: true,
          percent: 73,
        }),
        games,
      ),
    ).toEqual({
      title: "73% - Defragmenting Drive C",
      icon: "defrag",
      resizable: false,
      size: DEFRAG_DETAILS_SIZE,
    });
  });

  it("draws its icon at both sizes", () => {
    for (const size of [16, 32] as const) {
      const { container, unmount } = render(
        <Win98Icon name="defrag" size={size} />,
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("data-icon")).toBe("defrag");
      expect(svg?.getAttribute("width")).toBe(String(size));
      unmount();
    }
  });
});
