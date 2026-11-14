import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProviderOptions } from "../__mocks__/renderWithProviders";
import {
  PHONE_DEVICE,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { MemoryFuseOsPrefsStore } from "../settings/fuseosPrefsStore";
import { MemoryDialUpSession } from "../sounds/dialup/dialUpSession";

import { MemoryLastPlayedStore } from "./lastPlayedStore";
import { LAUNCHER_WINDOW_ID } from "./launcherFacts";
import { ADD_GAME_MESSAGE } from "./useLauncherViewModel";

/** A session that has already dialled in, so the online programs open without Dial-Up Networking in front. */
function online(): MemoryDialUpSession {
  const session = new MemoryDialUpSession();
  session.markConnected();
  return session;
}

/** The desktop with the launcher open, as every boot has it. */
function renderLauncher(options: ProviderOptions = {}) {
  const result = renderWithProviders(<Desktop />, {
    initialState: {
      version: 1,
      windows: [
        {
          id: LAUNCHER_WINDOW_ID,
          kind: "launcher",
          minimized: false,
          maximized: false,
        },
      ],
    },
    ...options,
  });
  const launcher = screen.getByRole("dialog", { name: "Fusteam" });
  return { ...result, launcher, inside: within(launcher) };
}

describe("LauncherWindow", () => {
  it("lists every game under MY GAMES with the first selected, its screenshot, tagline and facts", () => {
    const { inside } = renderLauncher();
    expect(inside.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "My Games",
      "Friends",
      "Servers",
      "News",
    ]);
    expect(inside.getByRole("tab", { name: "My Games" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const list = inside.getByRole("listbox", { name: "My Games" });
    const rows = within(list).getAllByRole("option");
    expect(
      rows.map((row) => row.querySelector(".fst-row-name")?.textContent),
    ).toEqual(["Fuseball", "Fuse Riders", "Fuse Birds"]);
    // The old list's Status column; decorative, so it stays out of the row's name.
    expect(rows[0]).toHaveTextContent("Ready");
    expect(inside.getByRole("option", { name: "Fuseball" })).toBe(rows[0]);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]?.querySelector("img")).toHaveAttribute(
      "src",
      "/fuse-riders/fuseos/game-icons/fuseball-16.png",
    );
    expect(rows[1]?.querySelector("[data-icon='tile']")).not.toBeNull();
    // The list has keyboard focus, so the arrows work right after boot.
    expect(list).toHaveFocus();

    const details = inside.getByRole("region", { name: "Fuseball details" });
    expect(
      within(details).getByRole("img", { name: "Fuseball screenshot" }),
    ).toHaveAttribute("src", "/fuse-riders/gallery/fuseball.jpg");
    expect(details).toHaveTextContent("Five-a-side with rockets");
    expect(details).toHaveTextContent("Status:Ready to play");
    expect(details).toHaveTextContent(/Disk usage:\d+ MB/);
    expect(details).toHaveTextContent("Last played:Never");
    const links = within(details).getByRole("navigation", { name: "Links" });
    const newTab = within(links).getByRole("link", { name: "Open in new tab" });
    expect(newTab).toHaveAttribute("href", "/fuse-riders/fuseball/");
    expect(newTab).toHaveAttribute("target", "_blank");
    // Leaderboard and Friends open programs on this desktop, not pages.
    for (const name of ["Leaderboard", "Friends"])
      expect(within(links).getByRole("link", { name })).not.toHaveAttribute(
        "target",
      );
    expect(inside.getByText("FUSTEAM")).toBeInTheDocument();
  });

  it("selects a row on click and shows a placeholder for a game without a screenshot", async () => {
    const user = userEvent.setup();
    const { inside } = renderLauncher();
    await user.click(inside.getByRole("option", { name: "Fuse Riders" }));
    expect(inside.getByRole("option", { name: "Fuse Riders" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const details = inside.getByRole("region", { name: "Fuse Riders details" });
    expect(
      within(details).getByRole("img", {
        name: "Fuse Riders has no screenshot yet",
      }),
    ).toHaveTextContent("FR");
    expect(screen.queryByRole("dialog", { name: "Fuse Riders" })).toBeNull();
  });

  it("walks the list with the arrow keys, stopping at the ends, and plays with Enter", async () => {
    const user = userEvent.setup();
    const { inside } = renderLauncher();
    const list = inside.getByRole("listbox", { name: "My Games" });
    list.focus();
    await user.keyboard("{ArrowUp}");
    expect(inside.getByRole("option", { name: "Fuseball" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(inside.getByRole("option", { name: "Fuse Birds" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(list).toHaveAttribute(
      "aria-activedescendant",
      "fst-game-fuse-birds",
    );
    await user.keyboard("{ArrowUp}{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "Fuse Riders" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("Fuse Riders")).toHaveAttribute(
      "src",
      "/fuse-riders/fuse-riders/",
    );
  });

  it("plays the selected game from PLAY, focusing its window when it is already open, and records when", async () => {
    const user = userEvent.setup();
    const lastPlayed = new MemoryLastPlayedStore();
    const { inside, launcher, desktopDeps } = renderLauncher({
      launcherDeps: { lastPlayed },
    });
    await user.click(inside.getByRole("option", { name: "Fuseball" }));
    await user.click(inside.getByRole("button", { name: "Play Fuseball" }));
    const game = await screen.findByRole("dialog", { name: "Fuseball" });
    expect(game).toHaveAttribute("data-active", "true");
    expect(lastPlayed.get()).toEqual({ fuseball: desktopDeps.now() });
    expect(
      inside.getByRole("region", { name: "Fuseball details" }),
    ).toHaveTextContent("Last played:Today, 12:34");

    fireEvent.mouseDown(launcher);
    expect(game).toHaveAttribute("data-active", "false");
    await user.click(inside.getByRole("button", { name: "Play Fuseball" }));
    expect(screen.getAllByRole("dialog", { name: "Fuseball" })).toHaveLength(1);
    expect(game).toHaveAttribute("data-active", "true");
  });

  it("opens the game's own page in a new tab from PLAY IN NEW TAB and records when, even when windows are the preference", async () => {
    const user = userEvent.setup();
    const lastPlayed = new MemoryLastPlayedStore();
    const { inside, desktopDeps } = renderLauncher({
      launcherDeps: { lastPlayed },
    });
    await user.click(
      inside.getByRole("button", { name: "Play Fuseball in new tab" }),
    );
    expect(desktopDeps.openExternal).toHaveBeenCalledTimes(1);
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
    expect(screen.queryByRole("dialog", { name: "Fuseball" })).toBeNull();
    expect(lastPlayed.get()).toEqual({ fuseball: desktopDeps.now() });
    expect(
      inside.getByRole("region", { name: "Fuseball details" }),
    ).toHaveTextContent("Last played:Today, 12:34");
  });

  it("plays the selected row in a new tab with Shift+Enter", async () => {
    const user = userEvent.setup();
    const lastPlayed = new MemoryLastPlayedStore();
    const { inside, desktopDeps } = renderLauncher({
      launcherDeps: { lastPlayed },
    });
    inside.getByRole("listbox", { name: "My Games" }).focus();
    await user.keyboard("{ArrowDown}{Shift>}{Enter}{/Shift}");
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuse-riders/",
    );
    expect(screen.queryByRole("dialog", { name: "Fuse Riders" })).toBeNull();
    expect(lastPlayed.get()).toEqual({ "fuse-riders": desktopDeps.now() });
  });

  it("plays on a double click of a row", async () => {
    const user = userEvent.setup();
    const { inside } = renderLauncher();
    await user.dblClick(inside.getByRole("option", { name: "Fuse Birds" }));
    expect(
      await screen.findByRole("dialog", { name: "Fuse Birds" }),
    ).toBeInTheDocument();
  });

  it("opens the game in a browser tab when that is the launch preference", async () => {
    const user = userEvent.setup();
    const { inside, desktopDeps } = renderLauncher({
      prefsStore: new MemoryFuseOsPrefsStore({ gameLaunch: "tab" }),
    });
    await user.click(inside.getByRole("button", { name: "Play Fuseball" }));
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
    expect(screen.queryByRole("dialog", { name: "Fuseball" })).toBeNull();
  });

  it("launches in a tab on a touch device when nothing is chosen, and in a window with a mouse", async () => {
    const user = userEvent.setup();
    const touch = renderLauncher({ launchDevice: PHONE_DEVICE });
    await user.click(
      touch.inside.getByRole("button", { name: "Play Fuseball" }),
    );
    expect(touch.desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
    touch.unmount();

    const mouse = renderLauncher();
    await user.click(
      mouse.inside.getByRole("button", { name: "Play Fuseball" }),
    );
    expect(mouse.desktopDeps.openExternal).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Fuseball" }),
    ).toBeInTheDocument();
  });

  it("shows the last played date read from the store", () => {
    const { inside } = renderLauncher({
      launcherDeps: {
        lastPlayed: new MemoryLastPlayedStore({
          fuseball: Date.UTC(1998, 5, 24, 8, 0),
        }),
      },
    });
    expect(
      inside.getByRole("region", { name: "Fuseball details" }),
    ).toHaveTextContent("Last played:Yesterday");
  });

  it("opens Fuse Messenger, Network Neighborhood and the Hall of Fame from the Friends, Servers and News tabs", async () => {
    const user = userEvent.setup();
    const { inside, store } = renderLauncher({ dialUpSession: online() });
    for (const [tab, title] of [
      ["Friends", "Fuse Messenger"],
      ["Servers", "Network Neighborhood"],
      ["News", "Hall of Fame"],
    ] as const) {
      await user.click(inside.getByRole("tab", { name: tab }));
      expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
      // The launcher stays on My Games: the others are windows of their own.
      expect(inside.getByRole("tab", { name: "My Games" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(inside.getByRole("tab", { name: tab })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    }
    await user.click(inside.getByRole("tab", { name: "My Games" }));
    expect(
      inside.getByRole("listbox", { name: "My Games" }),
    ).toBeInTheDocument();
    // One window each, however often a tab is pressed.
    await user.click(inside.getByRole("tab", { name: "News" }));
    expect(
      store
        .load()
        .windows.map((window) => window.kind)
        .sort(),
    ).toEqual(["friends", "halloffame", "launcher", "network"]);
  });

  it("dials in before the first online program of the session, from the Servers tab too", async () => {
    const user = userEvent.setup();
    const { inside, dialUpSession } = renderLauncher();
    await user.click(inside.getByRole("tab", { name: "Servers" }));
    expect(
      screen.queryByRole("dialog", { name: "Network Neighborhood" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog", { name: "Connect To" })).getByRole(
        "button",
        { name: "Cancel" },
      ),
    );
    expect(dialUpSession.connected).toBe(true);
    expect(
      screen.getByRole("dialog", { name: "Network Neighborhood" }),
    ).toBeInTheDocument();
  });

  it("opens the Hall of Fame on the selected game from its Leaderboard link, and Fuse Messenger from Friends", async () => {
    const user = userEvent.setup();
    const { inside, store } = renderLauncher({ dialUpSession: online() });
    await user.click(inside.getByRole("option", { name: /Fuse Riders/ }));
    await user.click(inside.getByRole("link", { name: "Leaderboard" }));
    expect(
      screen.getByRole("dialog", { name: "Hall of Fame" }),
    ).toBeInTheDocument();
    // Another game's link turns the open window to that game rather than opening a second one.
    await user.click(inside.getByRole("option", { name: /Fuseball/ }));
    await user.click(inside.getByRole("link", { name: "Leaderboard" }));
    expect(
      store.load().windows.filter((window) => window.kind === "halloffame"),
    ).toEqual([expect.objectContaining({ gameId: "fuseball" })]);
    await user.click(inside.getByRole("link", { name: "Friends" }));
    expect(
      screen.getByRole("dialog", { name: "Fuse Messenger" }),
    ).toBeInTheDocument();
  });

  it("FRIENDS & CHAT opens Fuse Messenger and ADD A GAME... a message box", async () => {
    const user = userEvent.setup();
    const { inside } = renderLauncher({ dialUpSession: online() });
    await user.click(inside.getByRole("button", { name: "FRIENDS & CHAT" }));
    expect(
      screen.getByRole("dialog", { name: "Fuse Messenger" }),
    ).toBeInTheDocument();
    await user.click(inside.getByRole("button", { name: "ADD A GAME..." }));
    // The message box is titled after the launcher, so two dialogs carry the name.
    const boxes = await screen.findAllByRole("dialog", { name: "Fusteam" });
    expect(boxes).toHaveLength(2);
    const message = screen
      .getByText(
        (_content, element) =>
          element?.tagName === "P" && element.textContent === ADD_GAME_MESSAGE,
      )
      .closest("section");
    expect(message).not.toBeNull();
    if (!message) return;
    expect(message.querySelector("svg[data-icon='info']")).not.toBeNull();
    await user.click(within(message).getByRole("button", { name: "OK" }));
    expect(screen.getAllByRole("dialog", { name: "Fusteam" })).toHaveLength(1);
  });

  it("says so when no Fuse games are installed", () => {
    const { inside } = renderLauncher({ games: [] });
    expect(inside.getByRole("listbox", { name: "My Games" })).toHaveTextContent(
      "No games installed",
    );
    expect(
      inside.getByRole("region", { name: "No game selected" }),
    ).toHaveTextContent("No Fuse games are installed on this desktop.");
    expect(inside.queryByRole("button", { name: /^Play/ })).toBeNull();
  });

  it("is reached from Start > Programs > Fusteam and from ?open=fusteam", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [{ kind: "launcher" }] });
    expect(screen.getByRole("dialog", { name: "Fusteam" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Start/ }));
    const menu = screen.getByRole("menu", { name: "Start menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Programs" }));
    const item = within(menu).getByRole("menuitem", { name: "Fusteam" });
    expect(item.querySelector("svg[data-icon='fusteam']")).not.toBeNull();
    await user.click(item);
    expect(screen.getAllByRole("dialog", { name: "Fusteam" })).toHaveLength(1);
  });
});
