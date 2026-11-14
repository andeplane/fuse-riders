import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProviderOptions } from "../__mocks__/renderWithProviders";
import {
  PHONE_DEVICE,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { BSOD_HEADLINE } from "../system32/BlueScreen";
import { desktopBsodModule } from "../system32/desktopBsod";
import { MemoryScheduler } from "../system32/system32Deps";
import { RESTART_MS } from "../system32/system32Machine";

import { RUN_PROMPT } from "./RunWindow";

function renderRun(options: ProviderOptions = {}) {
  const user = userEvent.setup();
  const result = renderWithProviders(<Desktop />, {
    initialOpen: [{ kind: "run" }],
    ...options,
  });
  const dialog = () => screen.queryByRole("dialog", { name: "Run" });
  const box = () => screen.getByRole("combobox", { name: "Open:" });
  const run = async (text: string) => {
    await user.clear(box());
    await user.type(box(), `${text}{Enter}`);
  };
  return { ...result, user, dialog, box, run };
}

describe("RunWindow", () => {
  it("shows the Windows 98 prompt with the box focused and OK waiting for a name", () => {
    const { dialog, box } = renderRun();
    expect(dialog()).toHaveTextContent(RUN_PROMPT);
    expect(box()).toHaveFocus();
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
    expect(dialog()?.querySelector("svg[data-icon='run']")).not.toBeNull();
  });

  it("opens a program by name and closes", async () => {
    const { run, dialog, store } = renderRun();
    await run("winamp");
    expect(dialog()).toBeNull();
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "winamp",
    ]);
  });

  it("opens a retro game, the DOS Games folder and Notepad++", async () => {
    const { run, user, store } = renderRun();
    await run("DOOM.EXE");
    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("menuitem", { name: "Run..." }));
    await run("dosgames");
    await user.keyboard("{Meta>}r{/Meta}");
    await run("notepad");
    expect(store.load().windows).toEqual([
      expect.objectContaining({ kind: "retro", game: "doom" }),
      expect.objectContaining({ kind: "retroFolder" }),
      expect.objectContaining({ kind: "notepadpp", paths: ["README.md"] }),
    ]);
  });

  it("starts a Fuse game through the games launcher: a window, or a tab where games open in tabs", async () => {
    const windowed = renderRun();
    await windowed.run("fuseball");
    expect(windowed.store.load().windows).toEqual([
      expect.objectContaining({ kind: "fusegame", gameId: "fuseball" }),
    ]);
    expect(windowed.osAnalytics.launches).toEqual([
      { game: "fuseball", launch: "window" },
    ]);
    windowed.unmount();

    const tabbed = renderRun({ launchDevice: PHONE_DEVICE });
    await tabbed.run("fuseball");
    expect(tabbed.desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
    expect(tabbed.store.load().windows).toEqual([]);
  });

  it("raises a Blue Screen of Death for bsod", async () => {
    const scheduler = new MemoryScheduler();
    const { run, dialog, user } = renderRun({ system32Deps: { scheduler } });
    await run("bsod");
    expect(dialog()).toBeNull();
    if (desktopBsodModule) {
      // The desktop's own screen (D1), the one Ctrl+Alt+Delete raises.
      expect(
        screen.getByRole("alertdialog", { name: "Windows fatal exception" }),
      ).toBeInTheDocument();
      await user.keyboard("x");
      expect(screen.queryByRole("alertdialog")).toBeNull();
      return;
    }
    // Without D1: the SYSTEM32 gag's own blue screen, then its fake restart back to a healthy desktop.
    expect(screen.getByRole("alert")).toHaveTextContent(BSOD_HEADLINE);
    await user.keyboard("x");
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => scheduler.advance(RESTART_MS));
    expect(document.querySelector(".s32-root")?.className).toBe("s32-root");
  });

  it("opens a web address in a browser tab", async () => {
    const { run, dialog, desktopDeps } = renderRun();
    await run("https://fusegames.ai/");
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "https://fusegames.ai/",
    );
    expect(dialog()).toBeNull();
  });

  it("opens the Recycle Bin by the name people remember", async () => {
    const { run, store } = renderRun();
    await run("Recycle Bin");
    expect(store.load().windows).toEqual([
      expect.objectContaining({ kind: "recyclebin" }),
    ]);
  });

  it("stays open under an error box for a name nothing answers to", async () => {
    const { run, dialog, user, box } = renderRun();
    await run("quake");
    const error = screen
      .getAllByRole("dialog", { name: "Run" })
      .find((candidate) => candidate.textContent?.includes("Cannot find"));
    expect(error).toHaveTextContent(
      "Cannot find the file 'quake' (or one of its components).",
    );
    if (!error) return;
    await user.click(within(error).getByRole("button", { name: "OK" }));
    expect(dialog()).not.toBeNull();
    expect(box()).toHaveValue("quake");
  });

  it("closes on Cancel and on Escape, and Browse... opens My Computer instead", async () => {
    const first = renderRun();
    await first.user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(first.dialog()).toBeNull();
    expect(first.store.load().windows).toEqual([]);
    first.unmount();

    const second = renderRun();
    await second.user.type(second.box(), "do{Escape}");
    expect(second.dialog()).toBeNull();
    second.unmount();

    const third = renderRun();
    await third.user.click(screen.getByRole("button", { name: "Browse..." }));
    expect(third.dialog()).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Exploring - My Computer" }),
    ).toBeInTheDocument();
  });
});
