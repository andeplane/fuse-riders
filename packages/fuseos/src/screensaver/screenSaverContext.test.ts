import { renderHook } from "@testing-library/react";
import { useContext } from "react";

import { ScreenSaverContext } from "./screenSaverContext";
import { DEFAULT_SCREEN_SAVER_PREFS } from "./screenSaverStore";

describe("ScreenSaverContext", () => {
  it("defaults to the stock preferences, not running, with controls that do nothing, outside the provider", () => {
    const { result } = renderHook(() => useContext(ScreenSaverContext));
    const { snapshot, controls } = result.current;
    expect(snapshot).toEqual({
      prefs: DEFAULT_SCREEN_SAVER_PREFS,
      active: false,
    });
    expect(controls.getSnapshot()).toBe(snapshot);
    expect(controls.configure({ waitMinutes: 1 })).toBeUndefined();
    expect(controls.preview()).toBeUndefined();
    expect(controls.stop()).toBeUndefined();
  });
});
