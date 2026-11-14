import type { ReactNode } from "react";

import { Desktop } from "./desktop/Desktop";
import { DesktopUiProvider } from "./desktop/DesktopUiProvider";
import { DisplayViewportProvider } from "./desktop/DisplayViewportProvider";
import { ScreenSaverOverlay } from "./screensaver/ScreenSaverOverlay";
import { ScreenSaverProvider } from "./screensaver/ScreenSaverProvider";
import type { WindowContent } from "./state/appState";
import { AppStateProvider } from "./state/AppStateProvider";
import type { StateStore } from "./state/stateStore";
import { WindowManagerProvider } from "./windows/WindowManagerProvider";

export type ShellProps = {
  store: StateStore;
  /** Windows a deep link asks for; opened once, on top of the stored ones. */
  initialOpen?: readonly WindowContent[];
  children?: ReactNode;
};

/** Provider stack under which the desktop runs. Shared by the app and the tests. */
export function Shell({ store, initialOpen, children }: ShellProps) {
  return (
    <AppStateProvider store={store} initialOpen={initialOpen}>
      <DesktopUiProvider>
        <ScreenSaverProvider>
          <DisplayViewportProvider>
            <WindowManagerProvider>
              {children ?? <Desktop />}
            </WindowManagerProvider>
          </DisplayViewportProvider>
          {/* Over the desktop, outside the retro-resolution fit, so it covers the real viewport. */}
          <ScreenSaverOverlay />
        </ScreenSaverProvider>
      </DesktopUiProvider>
    </AppStateProvider>
  );
}
