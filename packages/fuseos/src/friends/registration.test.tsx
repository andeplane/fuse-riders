import { screen } from "@testing-library/react";

import {
  createTestGames,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import {
  FRIENDS_WINDOW_ID,
  START_MENU_REGISTRATIONS,
} from "../desktop/startMenuRegistry";
import { FRIENDS_WINDOW_SIZE, windowMeta } from "../desktop/windowMeta";
import { FuseGameWindow, withRoom } from "../fusegames/FuseGameWindow";
import type { AppState, WindowState } from "../state/appState";
import {
  DEFAULT_STATE,
  isRoomCode,
  isWindowState,
  parseAppState,
  serializeAppState,
} from "../state/appState";
import { deepLinkContents } from "../state/deepLink";
import type { WindowCommands } from "../windows/useWindowCommands";

/** The desktop seams Fuse Messenger registers through: window kind, meta, deep link, Start menu and the room field. */
describe("Fuse Messenger registration", () => {
  const games = createTestGames();
  const window = (content: Partial<WindowState>): unknown => ({
    id: "w1",
    minimized: false,
    maximized: false,
    ...content,
  });

  it("is a window kind that survives storage, titled Fuse Messenger with the messenger icon", () => {
    expect(isWindowState(window({ kind: "friends" }))).toBe(true);
    const state: AppState = {
      ...DEFAULT_STATE,
      windows: [
        {
          id: FRIENDS_WINDOW_ID,
          minimized: false,
          maximized: false,
          kind: "friends",
        },
      ],
    };
    expect(parseAppState(serializeAppState(state))).toEqual(state);
    expect(
      windowMeta(
        { id: "x", minimized: false, maximized: false, kind: "friends" },
        games,
      ),
    ).toEqual({
      title: "Fuse Messenger",
      icon: "messenger",
      resizable: true,
      size: FRIENDS_WINDOW_SIZE,
    });
  });

  it("lets a game window carry a room code, and only a real one", () => {
    expect(isRoomCode("AB42")).toBe(true);
    expect(isRoomCode("ab42")).toBe(false);
    expect(isRoomCode("ABC4")).toBe(false);
    expect(isRoomCode(42)).toBe(false);
    expect(
      isWindowState(
        window({ kind: "fusegame", gameId: "fuseball", room: "AB42" }),
      ),
    ).toBe(true);
    expect(
      isWindowState(
        window({ kind: "fusegame", gameId: "fuseball", room: "nope" }),
      ),
    ).toBe(false);
    expect(
      isWindowState(window({ kind: "fusegame", gameId: "fuseball" })),
    ).toBe(true);
  });

  it("opens on ?open=friends", () => {
    expect(deepLinkContents(["friends"], games)).toEqual([{ kind: "friends" }]);
  });

  it("adds room= to the embed URL whether or not it already has a query", () => {
    expect(withRoom("/fuse-riders/fuseball/", "AB42")).toBe(
      "/fuse-riders/fuseball/?room=AB42",
    );
    expect(withRoom("/fuse-riders/fuseball/?mute", "AB42")).toBe(
      "/fuse-riders/fuseball/?mute&room=AB42",
    );
    expect(withRoom("/fuse-riders/fuseball/", undefined)).toBe(
      "/fuse-riders/fuseball/",
    );
  });

  it("embeds a game on its room when the window asks for one", () => {
    renderWithProviders(
      <FuseGameWindow
        gameId="fuseball"
        room="AB42"
        active
        onActivate={() => undefined}
      />,
      { muted: true },
    );
    expect(screen.getByTitle("Fuseball")).toHaveAttribute(
      "src",
      "/fuse-riders/fuseball/?mute&room=AB42",
    );
  });

  it("is in Start > Programs and opens one window, the same one every time", () => {
    const entry = START_MENU_REGISTRATIONS.find((e) => e.id === "friends")!;
    expect(entry).toMatchObject({
      slot: "programs",
      label: "Fuse Messenger",
      icon: "messenger",
    });
    const open = vi.fn();
    const commands = { open } as Partial<WindowCommands> as WindowCommands;
    entry.open!(commands);
    expect(open).toHaveBeenCalledWith({ kind: "friends" }, FRIENDS_WINDOW_ID);
  });

  it("renders the window from stored state with the tray in the taskbar", async () => {
    renderWithProviders(<Desktop />, {
      initialState: {
        ...DEFAULT_STATE,
        windows: [
          {
            id: FRIENDS_WINDOW_ID,
            minimized: false,
            maximized: false,
            kind: "friends",
          },
        ],
      },
    });
    expect(
      await screen.findByRole("dialog", { name: "Fuse Messenger" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("friends-tray")).toHaveAccessibleName(
      "Fuse Messenger: signed out",
    );
  });
});
