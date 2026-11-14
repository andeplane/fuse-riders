import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  renderWithProviders,
  TEST_SYSTEM_PROBE,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { MemoryWallpaperStore } from "../desktop/wallpaperStore";
import type { AppState, ControlPanelApplet } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

function renderControlPanel(
  applet: ControlPanelApplet = "home",
  options: Parameters<typeof renderWithProviders>[1] = {},
) {
  const state: AppState = {
    ...DEFAULT_STATE,
    windows: [
      {
        id: "w1",
        minimized: false,
        maximized: false,
        kind: "controlpanel",
        applet,
      },
    ],
  };
  return renderWithProviders(<Desktop />, { ...options, initialState: state });
}

describe("ControlPanelWindow", () => {
  it("opens applets from the home view and the tabs", async () => {
    const user = userEvent.setup();
    renderControlPanel();
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    await user.click(within(dialog).getByRole("button", { name: "Display" }));
    expect(
      within(dialog).getByRole("group", { name: "Display Properties" }),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("tab", { name: "Control Panel" }),
    );
    expect(
      within(dialog).getByRole("listbox", { name: "Control Panel applets" }),
    ).toBeInTheDocument();
  });

  it("shows the browser, graphics and storage the system probe reports", async () => {
    renderControlPanel("system");
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    const system = await within(dialog).findByRole("table", {
      name: "System information",
    });
    expect(system).toHaveTextContent("Chrome 131");
    expect(system).toHaveTextContent("MacIntel");
    expect(system).toHaveTextContent("en-GB");
    const computer = within(dialog).getByRole("table", {
      name: "Computer information",
    });
    expect(computer).toHaveTextContent("1920 x 1080 pixels");
    expect(computer).toHaveTextContent("Available");
    expect(computer).toHaveTextContent("Windows are remembered between visits");
  });

  it("says when WebGPU and storage are not available", async () => {
    renderControlPanel("system", {
      systemProbe: {
        ...TEST_SYSTEM_PROBE,
        hasWebGpu: false,
        storageAvailable: false,
      },
    });
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    const computer = await within(dialog).findByRole("table", {
      name: "Computer information",
    });
    expect(computer).toHaveTextContent("Not available");
    expect(computer).toHaveTextContent("Not available; nothing is remembered");
  });

  it("lists the installed games in the Games applet", async () => {
    renderControlPanel("games");
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    const list = within(dialog).getByRole("list", { name: "Installed games" });
    expect(list).toHaveTextContent("Fuseball");
    expect(list).toHaveTextContent("Fuse Riders");
    expect(list).toHaveTextContent("Fuse Birds");
  });

  it("sets the wallpaper from a file, from the camera, and removes it", async () => {
    const user = userEvent.setup();
    const { mediaDeps, wallpaperStore } = renderControlPanel("display");
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    const desktop = screen.getByRole("list", {
      name: "Desktop icons",
    }).parentElement;
    expect(desktop).toHaveAttribute("data-wallpaper", "default");

    const file = new File(["x"], "photo.png", { type: "image/png" });
    await user.upload(within(dialog).getByLabelText("Browse..."), file);
    expect(mediaDeps.readImageFile).toHaveBeenCalledWith(file);
    await waitFor(() =>
      expect(
        within(dialog).getByRole("img", { name: "Current wallpaper" }),
      ).toHaveAttribute("src", "data:image/jpeg;base64,FILE"),
    );
    expect(desktop).toHaveAttribute("data-wallpaper", "custom");
    expect(wallpaperStore.get()).toBe("data:image/jpeg;base64,FILE");

    await user.click(within(dialog).getByRole("button", { name: "Camera..." }));
    expect(mediaDeps.openCamera).toHaveBeenCalled();
    await user.click(
      await within(dialog).findByRole("button", { name: "Capture" }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("img", { name: "Current wallpaper" }),
      ).toHaveAttribute("src", "data:image/jpeg;base64,PHOTO"),
    );
    expect(within(dialog).queryByRole("group", { name: "Camera" })).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "None" }));
    expect(within(dialog).getByText("(None)")).toBeInTheDocument();
    expect(wallpaperStore.get()).toBeUndefined();
  });

  it("picks a background colour from the Windows 98 palette, clearing the wallpaper, and vice versa", async () => {
    const user = userEvent.setup();
    const { displayPrefsStore, wallpaperStore } = renderControlPanel("display");
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    const desktop = screen.getByRole("list", {
      name: "Desktop icons",
    }).parentElement;

    // A palette colour clears any wallpaper.
    const file = new File(["x"], "photo.png", { type: "image/png" });
    await user.upload(within(dialog).getByLabelText("Browse..."), file);
    await waitFor(() =>
      expect(desktop).toHaveAttribute("data-wallpaper", "custom"),
    );

    await user.click(within(dialog).getByRole("button", { name: "Maroon" }));
    expect(displayPrefsStore.get().backgroundColor).toBe("#800000");
    expect(wallpaperStore.get()).toBeUndefined();
    expect(desktop).toHaveAttribute("data-wallpaper", "default");
    expect(desktop).toHaveStyle({ backgroundColor: "#800000" });

    // Picking a wallpaper again clears the colour back to the classic teal.
    await user.upload(within(dialog).getByLabelText("Browse..."), file);
    await waitFor(() =>
      expect(desktop).toHaveAttribute("data-wallpaper", "custom"),
    );
    expect(displayPrefsStore.get().backgroundColor).toBe("#008080");
  });

  it("sets and clamps desktop icon spacing", async () => {
    const user = userEvent.setup();
    const { displayPrefsStore } = renderControlPanel("display");
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    await user.click(within(dialog).getByRole("tab", { name: "Settings" }));
    const horizontal = within(dialog).getByLabelText("Horizontal");
    const vertical = within(dialog).getByLabelText("Vertical");
    expect(horizontal).toHaveValue(75);
    expect(vertical).toHaveValue(75);

    fireEvent.change(horizontal, { target: { value: "100" } });
    expect(displayPrefsStore.get().iconSpacingX).toBe(100);

    fireEvent.change(vertical, { target: { value: "9999" } });
    expect(displayPrefsStore.get().iconSpacingY).toBe(160);
    fireEvent.change(vertical, { target: { value: "0" } });
    expect(displayPrefsStore.get().iconSpacingY).toBe(40);
  });

  it("switches Small fonts and Large fonts, scaling the whole chrome", async () => {
    const user = userEvent.setup();
    renderControlPanel("display");
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    await user.click(within(dialog).getByRole("tab", { name: "Settings" }));
    expect(within(dialog).getByLabelText("Small fonts")).toBeChecked();
    expect(document.documentElement).not.toHaveClass("large-fonts");

    await user.click(within(dialog).getByLabelText("Large fonts"));
    expect(document.documentElement).toHaveClass("large-fonts");
    expect(within(dialog).getByLabelText("Large fonts")).toBeChecked();

    await user.click(within(dialog).getByLabelText("Small fonts"));
    expect(document.documentElement).not.toHaveClass("large-fonts");
  });

  it("reports camera failures and restores a stored wallpaper on boot", async () => {
    const user = userEvent.setup();
    const store = new MemoryWallpaperStore();
    store.set("data:image/png;base64,SAVED");
    const { mediaDeps } = renderControlPanel("display", {
      wallpaperStore: store,
      mediaDeps: {
        openCamera: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    expect(
      within(dialog).getByRole("img", { name: "Current wallpaper" }),
    ).toHaveAttribute("src", "data:image/png;base64,SAVED");
    await user.click(within(dialog).getByRole("button", { name: "Camera..." }));
    expect(mediaDeps.openCamera).toHaveBeenCalled();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Could not open the camera: denied",
    );
  });

  it("closes", async () => {
    const user = userEvent.setup();
    renderControlPanel();
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    const close = within(dialog)
      .getAllByRole("button", { name: "Close" })
      .at(-1);
    if (!close) throw new Error("no Close button");
    await user.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has an Assistant applet with the Office Assistant options, remembered in the desktop state", async () => {
    const user = userEvent.setup();
    const { assistantOptions, store } = renderControlPanel("assistant");
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    expect(
      within(dialog).getByLabelText("Show the Office Assistant"),
    ).toBeChecked();
    expect(within(dialog).getByLabelText("Show tips")).toBeChecked();
    expect(within(dialog).getByLabelText("Play sounds")).not.toBeChecked();
    expect(
      within(dialog).queryByLabelText("The agent the assistant talks to"),
    ).toBeNull();
    await user.click(within(dialog).getByLabelText("Show tips"));
    await user.click(within(dialog).getByLabelText("Play sounds"));
    expect(assistantOptions.get()).toMatchObject({
      showTips: false,
      sounds: true,
    });

    await user.click(
      within(dialog).getByLabelText("Show the Office Assistant"),
    );
    await waitFor(() => expect(store.load().assistantHidden).toBe(true));
    expect(
      screen.queryByRole("complementary", { name: "Office Assistant" }),
    ).toBeNull();
    await user.click(
      within(dialog).getByLabelText("Show the Office Assistant"),
    );
    expect(
      screen.getByRole("complementary", { name: "Office Assistant" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(store.load().assistantHidden).toBeFalsy());
  });
});
