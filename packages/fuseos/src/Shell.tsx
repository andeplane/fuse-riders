import type { ReactNode } from "react";

import { AssistantToolsProvider } from "./assistant/assistantToolsContext";
import { Desktop } from "./desktop/Desktop";
import { DesktopUiProvider } from "./desktop/DesktopUiProvider";
import { DisplayViewportProvider } from "./desktop/DisplayViewportProvider";
import { DisplayEffectsProvider } from "./display/effects/DisplayEffectsProvider";
import { ScreenSaverOverlay } from "./screensaver/ScreenSaverOverlay";
import { ScreenSaverProvider } from "./screensaver/ScreenSaverProvider";
import type { WindowContent } from "./state/appState";
import { AppStateProvider } from "./state/AppStateProvider";
import type { StateStore } from "./state/stateStore";
import { WindowManagerProvider } from "./windows/WindowManagerProvider";

export type ShellProps = {
  store: StateStore;
  /** Windows a deep link asks for; opened once, on top of the stored ones. */
  initialOpen?: WindowContent[];
  children?: ReactNode;
};

/** Provider stack under which the desktop runs. Shared by the app and the tests. */
export function Shell({ store, initialOpen, children }: ShellProps) {
  return (
    <AppStateProvider store={store} initialOpen={initialOpen}>
      <DesktopUiProvider>
        <ScreenSaverProvider>
          <DisplayViewportProvider>
            <DisplayEffectsProvider>
              <WindowManagerProvider>
                <AssistantToolsProvider>
                  {children ?? <Desktop />}
                </AssistantToolsProvider>
              </WindowManagerProvider>
            </DisplayEffectsProvider>
          </DisplayViewportProvider>
          {/* Over the desktop, outside the retro-resolution fit, so it covers the real viewport. */}
          <ScreenSaverOverlay />
        </ScreenSaverProvider>
      </DesktopUiProvider>
    </AppStateProvider>
  );
}
