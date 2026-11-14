import { render, screen, within } from "@testing-library/react";

import type { WindowState } from "../state/appState";
import { WindowManagerProvider } from "../windows/WindowManagerProvider";
import type { WindowFrameProps } from "../windows/windowsDepsContext";
import { WindowsDepsContext } from "../windows/windowsDepsContext";

import { DisplayViewportContext } from "./displayViewportContext";
import { WindowHost } from "./WindowHost";

it("clamps a frame in logical desktop pixels and supplies the fitted pointer scale to its drag adapter", () => {
  const windows: WindowState[] = [
    {
      kind: "about",
      id: "w1",
      minimized: false,
      maximized: false,
    },
  ];
  render(
    <WindowsDepsContext.Consumer>
      {(deps) => (
        <WindowsDepsContext.Provider
          value={{ ...deps, WindowFrame: RecordingFrame }}
        >
          <DisplayViewportContext.Provider
            value={{ viewport: { width: 640, height: 480 }, scale: 0.5 }}
          >
            <WindowManagerProvider>
              <WindowHost windows={windows} activeId="w1" />
            </WindowManagerProvider>
          </DisplayViewportContext.Provider>
        </WindowsDepsContext.Provider>
      )}
    </WindowsDepsContext.Consumer>,
  );
  expect(screen.getByTestId("frame")).toHaveAttribute("data-scale", "0.5");
  expect(
    Number(screen.getByTestId("frame").getAttribute("data-width")),
  ).toBeLessThanOrEqual(640);
  expect(
    Number(screen.getByTestId("frame").getAttribute("data-height")),
  ).toBeLessThanOrEqual(452);
});

it("opens resizable windows maximized without a Maximize button on a phone-width viewport, leaving fixed-size windows alone", () => {
  const windows: WindowState[] = [
    {
      kind: "controlpanel",
      applet: "home",
      id: "w1",
      minimized: false,
      maximized: false,
    },
    {
      kind: "wallpaper",
      id: "w2",
      minimized: false,
      maximized: false,
    },
  ];
  render(
    <WindowsDepsContext.Consumer>
      {(deps) => (
        <WindowsDepsContext.Provider
          value={{
            ...deps,
            WindowFrame: RecordingFrame,
            getViewport: () => ({ width: 390, height: 844 }),
          }}
        >
          <WindowManagerProvider>
            <WindowHost windows={windows} activeId="w1" />
          </WindowManagerProvider>
        </WindowsDepsContext.Provider>
      )}
    </WindowsDepsContext.Consumer>,
  );
  const [panel, fixed] = screen.getAllByTestId("frame");
  expect(panel).toHaveAttribute("data-maximized", "true");
  expect(panel).toHaveAttribute("data-resizable", "false");
  expect(fixed).toHaveAttribute("data-maximized", "false");
  const panelDialog = screen.getByRole("dialog", { name: "Control Panel" });
  expect(
    within(panelDialog).queryByRole("button", { name: "Maximize" }),
  ).toBeNull();
  expect(
    within(panelDialog).queryByRole("button", { name: "Restore" }),
  ).toBeNull();
  expect(
    within(panelDialog).getByRole("button", { name: "Minimize" }),
  ).toBeInTheDocument();
});

it("draws message boxes in a modal layer, not a frame: the top box has focus, the windows under it look inactive, and a box has no Minimize", () => {
  const windows: WindowState[] = [
    {
      kind: "controlpanel",
      applet: "home",
      id: "w1",
      minimized: false,
      maximized: false,
    },
    {
      kind: "dialog",
      id: "w2",
      title: "First",
      message: "One",
      icon: "info",
      minimized: false,
      maximized: false,
    },
    {
      kind: "dialog",
      id: "w3",
      title: "Second",
      message: "Two",
      icon: "warning",
      minimized: false,
      maximized: false,
    },
  ];
  const { container } = render(
    <WindowsDepsContext.Consumer>
      {(deps) => (
        <WindowsDepsContext.Provider
          value={{ ...deps, WindowFrame: RecordingFrame }}
        >
          <WindowManagerProvider>
            <WindowHost windows={windows} activeId="w1" />
          </WindowManagerProvider>
        </WindowsDepsContext.Provider>
      )}
    </WindowsDepsContext.Consumer>,
  );
  expect(screen.getAllByTestId("frame")).toHaveLength(1);
  expect(container.querySelectorAll("[data-modal-layer]")).toHaveLength(2);
  expect(screen.getByRole("dialog", { name: "Control Panel" })).toHaveAttribute(
    "data-active",
    "false",
  );
  expect(screen.getByRole("dialog", { name: "First" })).toHaveAttribute(
    "data-active",
    "false",
  );
  expect(screen.getByRole("dialog", { name: "Second" })).toHaveAttribute(
    "data-active",
    "true",
  );
  const second = screen.getByRole("dialog", { name: "Second" });
  expect(within(second).queryByLabelText("Minimize")).toBeNull();
});

function RecordingFrame({
  children,
  scale,
  rect,
  maximized,
  resizable,
}: WindowFrameProps) {
  return (
    <div
      data-testid="frame"
      data-scale={scale}
      data-width={rect.width}
      data-height={rect.height}
      data-maximized={maximized}
      data-resizable={resizable}
    >
      {children}
    </div>
  );
}
