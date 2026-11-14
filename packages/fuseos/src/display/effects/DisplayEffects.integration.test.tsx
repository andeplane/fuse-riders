import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../__mocks__/renderWithProviders";
import { Desktop } from "../../desktop/Desktop";
import { MemoryWallpaperStore } from "../../desktop/wallpaperStore";
import { DEFAULT_STATE } from "../../state/appState";

import { MemoryDisplayEffectsStore } from "./effectsStore";
import { KEEP_SETTINGS_SECONDS } from "./resolutionEmulation";

/** The Display applet and a Fuseball window, open side by side. */
function openDisplayAndGame() {
  return {
    ...DEFAULT_STATE,
    windows: [
      {
        id: "game",
        kind: "fusegame" as const,
        gameId: "fuseball",
        minimized: false,
        maximized: false,
      },
      {
        id: "display",
        kind: "controlpanel" as const,
        applet: "display" as const,
        minimized: false,
        maximized: false,
      },
    ],
  };
}

async function openEffectsTab(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
  const tabs = within(dialog).getByRole("tablist", { name: "Display effects" });
  await user.click(within(tabs).getByRole("tab", { name: "Effects" }));
  return dialog;
}

describe("Display Properties: Effects", () => {
  it("quantizes the whole desktop, the game iframe included, to 16 colours and to monochrome", async () => {
    const user = userEvent.setup();
    const { displayPrefsStore } = renderWithProviders(<Desktop />, {
      initialState: openDisplayAndGame(),
    });
    const dialog = await openEffectsTab(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Palette"),
      "16-colors",
    );
    expect(displayPrefsStore.get().colorMode).toBe("16-colors");
    const footprint = screen.getByTestId("display-footprint");
    expect(footprint).toHaveStyle({ filter: "url(#display-16-colors)" });
    expect(document.querySelector("filter#display-16-colors")).not.toBeNull();
    // The game's iframe sits under the filtered footprint, so the browser quantizes it too.
    const frame = screen.getByTitle("Fuseball");
    expect(frame.tagName).toBe("IFRAME");
    expect(footprint.contains(frame)).toBe(true);
    await user.selectOptions(
      within(dialog).getByLabelText("Palette"),
      "monochrome",
    );
    expect(footprint).toHaveStyle({ filter: "url(#display-monochrome)" });
    expect(document.querySelector("filter#display-monochrome")).not.toBeNull();
    await user.selectOptions(
      within(dialog).getByLabelText("Palette"),
      "true-color",
    );
    expect(footprint.style.filter).toBe("");
  });

  it("lays the CRT sheet over the page, pointer-transparent, and bends it only when asked", async () => {
    const user = userEvent.setup();
    const { effectsStore } = renderWithProviders(<Desktop />, {
      initialState: openDisplayAndGame(),
      effectsDeps: { createCurvatureMap: () => "data:image/png;base64,MAP" },
    });
    const dialog = await openEffectsTab(user);
    expect(screen.queryByTestId("crt-overlay")).not.toBeInTheDocument();
    const curvature = within(dialog).getByLabelText("Curved tube");
    expect(curvature).toBeDisabled();

    await user.selectOptions(
      within(dialog).getByLabelText("CRT monitor"),
      "scanlines",
    );
    const overlay = screen.getByTestId("crt-overlay");
    expect(overlay).toHaveAttribute("data-crt", "scanlines");
    expect(overlay).toHaveClass("crt-overlay");
    // Portaled to <body>, above the desktop and any menu that portals there.
    expect(overlay.parentElement).toBe(document.body);
    expect(curvature).toBeDisabled();
    expect(effectsStore.get().crt).toBe("scanlines");

    await user.selectOptions(
      within(dialog).getByLabelText("CRT monitor"),
      "full",
    );
    expect(screen.getByTestId("crt-overlay")).toHaveAttribute(
      "data-crt",
      "full",
    );
    expect(curvature).toBeEnabled();
    expect(document.documentElement).not.toHaveAttribute("data-crt-curvature");
    await user.click(curvature);
    expect(effectsStore.get()).toEqual({
      crt: "full",
      curvature: true,
      scheme: "windows-standard",
    });
    expect(document.documentElement).toHaveAttribute(
      "data-crt-curvature",
      "on",
    );
    const filter = document.querySelector("filter#crt-curvature");
    expect(filter?.querySelector("feImage")?.getAttribute("href")).toBe(
      "data:image/png;base64,MAP",
    );
    expect(
      filter?.querySelector("feDisplacementMap")?.getAttribute("in2"),
    ).toBe("map");

    await user.click(curvature);
    expect(document.documentElement).not.toHaveAttribute("data-crt-curvature");
    expect(document.querySelector("filter#crt-curvature")).toBeNull();

    await user.selectOptions(
      within(dialog).getByLabelText("CRT monitor"),
      "off",
    );
    expect(screen.queryByTestId("crt-overlay")).not.toBeInTheDocument();
  });

  it("stays flat when the browser cannot draw the curvature map", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialState: openDisplayAndGame(),
      effectsStore: new MemoryDisplayEffectsStore({
        crt: "full",
        curvature: true,
        scheme: "windows-standard",
      }),
    });
    await openEffectsTab(user);
    expect(screen.getByTestId("crt-overlay")).toHaveAttribute(
      "data-crt",
      "full",
    );
    expect(document.documentElement).not.toHaveAttribute("data-crt-curvature");
    expect(document.querySelector("filter#crt-curvature")).toBeNull();
  });

  it("emulates 640x480 by filling the window and asks whether to keep it", async () => {
    const user = userEvent.setup();
    const { displayPrefsStore, effectsTimers } = renderWithProviders(
      <Desktop />,
      { initialState: openDisplayAndGame() },
    );
    const dialog = await openEffectsTab(user);
    expect(document.documentElement).not.toHaveAttribute(
      "data-resolution-emulation",
    );

    await user.selectOptions(
      within(dialog).getByLabelText("Screen resolution"),
      "640x480",
    );
    expect(displayPrefsStore.get().desktopArea).toBe("640x480");
    expect(screen.getByTestId("display-surface")).toHaveStyle({
      width: "640px",
      height: "480px",
    });
    // The 1280x800 test viewport: scaled up to its full height, chunky pixels and all.
    const footprint = screen.getByTestId("display-footprint");
    expect(parseFloat(footprint.style.width)).toBeCloseTo(640 * (800 / 480));
    expect(parseFloat(footprint.style.height)).toBeCloseTo(800);
    expect(document.documentElement).toHaveAttribute(
      "data-resolution-emulation",
      "640x480",
    );

    const box = screen.getByRole("dialog", { name: "Monitor Settings" });
    expect(box).toHaveTextContent("resized your desktop to 640 by 480");
    expect(within(box).getByRole("status")).toHaveTextContent(
      `Reverting in ${KEEP_SETTINGS_SECONDS} seconds`,
    );
    act(() => effectsTimers.advance(1000));
    expect(within(box).getByRole("status")).toHaveTextContent(
      `Reverting in ${KEEP_SETTINGS_SECONDS - 1} seconds`,
    );

    await user.click(within(box).getByRole("button", { name: "No" }));
    expect(
      screen.queryByRole("dialog", { name: "Monitor Settings" }),
    ).not.toBeInTheDocument();
    expect(displayPrefsStore.get().desktopArea).toBe("current");
    expect(screen.getByTestId("display-surface")).toHaveStyle({
      width: "1280px",
      height: "800px",
    });
    expect(document.documentElement).not.toHaveAttribute(
      "data-resolution-emulation",
    );
  });

  it("reverts by itself when the clock runs out, and keeps the resolution on Yes", async () => {
    const user = userEvent.setup();
    const { displayPrefsStore, effectsTimers } = renderWithProviders(
      <Desktop />,
      { initialState: openDisplayAndGame() },
    );
    const dialog = await openEffectsTab(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Screen resolution"),
      "800x600",
    );
    act(() => effectsTimers.advance(KEEP_SETTINGS_SECONDS * 1000));
    expect(
      screen.queryByRole("dialog", { name: "Monitor Settings" }),
    ).not.toBeInTheDocument();
    expect(displayPrefsStore.get().desktopArea).toBe("current");

    await user.selectOptions(
      within(dialog).getByLabelText("Screen resolution"),
      "1024x768",
    );
    const box = screen.getByRole("dialog", { name: "Monitor Settings" });
    await user.click(within(box).getByRole("button", { name: "Yes" }));
    expect(
      screen.queryByRole("dialog", { name: "Monitor Settings" }),
    ).not.toBeInTheDocument();
    act(() => effectsTimers.advance(60_000));
    expect(displayPrefsStore.get().desktopArea).toBe("1024x768");
    expect(effectsTimers.pending()).toBe(0);
  });

  it("asks to keep a resolution picked through the legacy Desktop area select too", async () => {
    const user = userEvent.setup();
    const { displayPrefsStore } = renderWithProviders(<Desktop />, {
      initialState: openDisplayAndGame(),
    });
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    await user.selectOptions(
      within(dialog).getByLabelText("Desktop area"),
      "800x600",
    );
    const box = screen.getByRole("dialog", { name: "Monitor Settings" });
    await user.keyboard("{Escape}");
    expect(box).not.toBeInTheDocument();
    expect(displayPrefsStore.get().desktopArea).toBe("current");
  });
});

describe("Display Properties: Appearance", () => {
  it("paints a scheme on <html> and gives the desktop its colour", async () => {
    const user = userEvent.setup();
    const { displayPrefsStore, effectsStore } = renderWithProviders(
      <Desktop />,
      { initialState: openDisplayAndGame() },
    );
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--w95-surface")).toBe("silver");
    expect(root).toHaveAttribute("data-color-scheme", "windows-standard");
    expect(screen.getByTestId("scheme-preview")).toHaveAttribute(
      "data-scheme",
      "windows-standard",
    );

    await user.selectOptions(
      within(dialog).getByLabelText("Scheme"),
      "hot-dog-stand",
    );
    expect(effectsStore.get().scheme).toBe("hot-dog-stand");
    expect(root).toHaveAttribute("data-color-scheme", "hot-dog-stand");
    expect(root.style.getPropertyValue("--w95-surface")).toBe("#ffff00");
    expect(root.style.getPropertyValue("--w95-title-start")).toBe("#ff0000");
    expect(screen.getByTestId("scheme-preview")).toHaveAttribute(
      "data-scheme",
      "hot-dog-stand",
    );
    expect(displayPrefsStore.get().backgroundColor).toBe("#ffff00");
    expect(screen.getByTestId("display-surface").firstElementChild).toHaveStyle(
      { backgroundColor: "#ffff00" },
    );
  });

  it("leaves a chosen wallpaper alone when a scheme is applied", async () => {
    const user = userEvent.setup();
    const wallpaperStore = new MemoryWallpaperStore();
    wallpaperStore.set("data:image/png;base64,WALL");
    const { displayPrefsStore } = renderWithProviders(<Desktop />, {
      initialState: openDisplayAndGame(),
      wallpaperStore,
    });
    const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
    await user.selectOptions(
      within(dialog).getByLabelText("Scheme"),
      "fuse-neon",
    );
    expect(document.documentElement.style.getPropertyValue("--w95-light")).toBe(
      "#16e7ff",
    );
    expect(wallpaperStore.get()).toBe("data:image/png;base64,WALL");
    expect(displayPrefsStore.get().backgroundColor).toBe("#008080");
  });

  it("restores the stored scheme and CRT on boot, and resets <html> on unmount", () => {
    const { unmount } = renderWithProviders(<Desktop />, {
      effectsStore: new MemoryDisplayEffectsStore({
        crt: "scanlines",
        curvature: false,
        scheme: "rose",
      }),
    });
    const root = document.documentElement;
    expect(root).toHaveAttribute("data-color-scheme", "rose");
    expect(root.style.getPropertyValue("--w95-surface")).toBe("#cfafb7");
    expect(screen.getByTestId("crt-overlay")).toHaveAttribute(
      "data-crt",
      "scanlines",
    );
    unmount();
    expect(root).toHaveAttribute("data-color-scheme", "windows-standard");
    expect(root.style.getPropertyValue("--w95-surface")).toBe("silver");
    expect(screen.queryByTestId("crt-overlay")).not.toBeInTheDocument();
  });
});
