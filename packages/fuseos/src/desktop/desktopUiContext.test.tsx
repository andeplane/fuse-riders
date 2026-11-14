import { renderHook } from "@testing-library/react";
import { useContext } from "react";

import { DEFAULT_ASSISTANT_OPTIONS } from "../assistant/assistantOptionsStore";
import { INITIAL_ASSISTANT_STATE } from "../assistant/assistantState";

import { DesktopUiContext } from "./desktopUiContext";
import { DEFAULT_BACKGROUND_COLOR } from "./displayPrefsStore";

describe("DesktopUiContext", () => {
  it("defaults to a quiet desktop whose setters do nothing, for a component rendered without the provider", () => {
    const { result } = renderHook(() => useContext(DesktopUiContext));
    const ui = result.current;
    expect(ui).toMatchObject({
      startMenuOpen: false,
      shutdownScreen: false,
      selectedIcon: null,
      iconMenu: null,
      wallpaper: undefined,
      wallpaperSource: "none",
      backgroundColor: DEFAULT_BACKGROUND_COLOR,
      colorMode: "true-color",
      desktopArea: "current",
      largeFonts: false,
      assistant: INITIAL_ASSISTANT_STATE,
      assistantOptions: DEFAULT_ASSISTANT_OPTIONS,
      assistantOpen: false,
      assistantMenu: null,
    });
    expect(ui.iconSpacingX).toBeGreaterThan(0);
    expect(ui.iconSpacingY).toBeGreaterThan(0);
    const calls = [
      () => ui.setStartMenuOpen(true),
      () => ui.setShutdownScreen(true),
      () => ui.setSelectedIcon("paint"),
      () => ui.setIconMenu({ iconId: "paint", position: { x: 1, y: 1 } }),
      () => ui.setWallpaper("data:,", "file"),
      () => ui.setBackgroundColor("#000000"),
      () => ui.setIconSpacing({ x: 80, y: 80 }),
      () => ui.setColorMode("16-colors"),
      () => ui.setDesktopArea("640x480"),
      () => ui.setLargeFonts(true),
      () => ui.assistantDispatch({ type: "show" }),
      () => ui.setAssistantOptions({ greeted: true }),
      () => ui.setAssistantOpen(true),
      () => ui.setAssistantMenu({ x: 2, y: 2 }),
    ];
    for (const call of calls) expect(call()).toBeUndefined();
    expect(result.current).toBe(ui);
  });
});
