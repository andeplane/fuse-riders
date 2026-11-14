import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useContext } from "react";

import { WindowsDepsContext } from "../windows/windowsDepsContext";

import { DesktopUiContext } from "./desktopUiContext";
import { DisplayViewportContext } from "./displayViewportContext";
import { DisplayViewportProvider } from "./DisplayViewportProvider";

it("shares logical resolution and fit scale, updates on host resize, and unsubscribes", () => {
  let available = { width: 512, height: 384 };
  let resize: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WindowsDepsContext.Consumer>
      {(windows) => (
        <WindowsDepsContext.Provider
          value={{
            ...windows,
            getViewport: () => available,
            subscribeViewport: (callback: () => void) => {
              resize = callback;
              return unsubscribe;
            },
          }}
        >
          <DesktopUiContext.Consumer>
            {(ui) => (
              <DesktopUiContext.Provider
                value={{ ...ui, desktopArea: "1024x768" }}
              >
                <DisplayViewportProvider>{children}</DisplayViewportProvider>
              </DesktopUiContext.Provider>
            )}
          </DesktopUiContext.Consumer>
        </WindowsDepsContext.Provider>
      )}
    </WindowsDepsContext.Consumer>
  );
  const { result, unmount } = renderHook(
    () => useContext(DisplayViewportContext),
    { wrapper },
  );
  expect(result.current).toEqual({
    viewport: { width: 1024, height: 768 },
    scale: 0.5,
  });
  act(() => {
    available = { width: 1600, height: 900 };
    resize?.();
  });
  expect(result.current).toEqual({
    viewport: { width: 1024, height: 768 },
    scale: 1,
  });
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
