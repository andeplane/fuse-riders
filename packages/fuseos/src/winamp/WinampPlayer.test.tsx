import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import type { FakeWebampPlayer } from "../__mocks__/webampPlayer";
import { createFakeWebampPlayer } from "../__mocks__/webampPlayer";
import { Desktop } from "../desktop/Desktop";
import { DEFAULT_STATE } from "../state/appState";
import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";

import { FUSE_TRACKS, fuseSoundtrack } from "./fuseTracks";
import type { MediaErrorInfo } from "./mediaErrorReporting";

/** The nth Webamp player created; fails the test when there is none. */
function playerAt(
  players: readonly FakeWebampPlayer[],
  index: number,
): FakeWebampPlayer {
  const player = players[index];
  if (player === undefined)
    throw new Error(`No Webamp player at index ${index}`);
  return player;
}

function desktopIcon(label: string) {
  return within(screen.getByRole("list", { name: "Desktop icons" })).getByRole(
    "button",
    { name: label },
  );
}

function taskbarButton(label: string) {
  return within(screen.getByRole("toolbar", { name: "Taskbar" })).getByRole(
    "button",
    { name: label },
  );
}

const layer = () => screen.getByTestId("winamp-layer");

/** A test-only button that closes every window through the same commands the chrome uses. */
function CloseAllWindows() {
  const { state } = useAppState();
  const commands = useWindowCommands();
  return (
    <button
      type="button"
      onClick={() =>
        state.windows.forEach((window) => commands.close(window.id))
      }
    >
      Close all windows
    </button>
  );
}

async function openWinamp(user: ReturnType<typeof userEvent.setup>) {
  await user.dblClick(desktopIcon("Winamp"));
  return screen.findByTestId("winamp-layer");
}

/** Opens Winamp and waits for the (fake) player to have rendered. */
async function openReadyWinamp(
  user: ReturnType<typeof userEvent.setup>,
  players: readonly FakeWebampPlayer[],
) {
  await openWinamp(user);
  await waitFor(() => expect(players).toHaveLength(1));
  await waitFor(() =>
    expect(within(layer()).queryByRole("status")).not.toBeInTheDocument(),
  );
  return playerAt(players, 0);
}

/** The Webamp tracks the test harness's base (`/fuse-riders/`) resolves the soundtrack to. */
const SOUNDTRACK = fuseSoundtrack("/fuse-riders/").map(({ track }) => track);

describe("Winamp", () => {
  it("runs frameless on the desktop layer: no FuseOS window, Webamp rendered into a positioned mount above the frames", async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    const player = await openReadyWinamp(user, winampPlayers);
    expect(screen.queryByRole("dialog", { name: "Winamp" })).toBeNull();
    expect(screen.getByRole("region", { name: "Winamp" })).toBe(layer());
    // Winamp stacks like any other window: 10 + its place in the window order (it is the only one open).
    expect(layer()).toHaveStyle({ zIndex: 10 });
    expect(layer()).toHaveClass("winamp-layer");
    const mount = player.renderedInto[0];
    expect(mount).toBe(screen.getByTestId("winamp-mount"));
    // Webamp throws "The DOM node passed to renderInto must have a non-static position"; asserted on the
    // inline style since Tailwind's stylesheet is not loaded in tests.
    expect(mount).toHaveStyle({ position: "absolute" });
    expect(within(layer()).queryByRole("button")).toBeNull();
    expect(within(layer()).queryByText(/soundtrack/i)).toBeNull();
    // The taskbar still lists it, so it can be minimized and restored like a window.
    expect(taskbarButton("Winamp")).toBeInTheDocument();
  });

  it("stacks with the other windows: a window opened after Winamp is in front, clicking Webamp brings Winamp back, and a window click puts it behind again", async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    await openReadyWinamp(user, winampPlayers);
    const winampZ = () => Number(layer().style.zIndex);
    await user.dblClick(desktopIcon("Paint"));
    const paint = await screen.findByRole("dialog", { name: /Paint/ });
    const paintFrame = paint.closest<HTMLElement>("[style*='z-index']");
    const paintZ = () => Number(paintFrame?.style.zIndex);
    expect(paintZ()).toBeGreaterThan(winampZ());
    expect(taskbarButton("Winamp")).not.toHaveAttribute("aria-pressed", "true");

    // Any pointer-down inside Webamp's windows brings Winamp to the front and presses its taskbar button.
    await user.pointer({
      keys: "[MouseLeft>]",
      target: screen.getByTestId("winamp-mount"),
    });
    expect(winampZ()).toBeGreaterThan(paintZ());
    expect(taskbarButton("Winamp")).toHaveAttribute("aria-pressed", "true");

    await user.click(within(paint).getByText(/Paint/, { selector: "*" }));
    expect(paintZ()).toBeGreaterThan(winampZ());
  });

  it("keeps Winamp under the taskbar and the Start menu whatever its place in the order", async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    await openReadyWinamp(user, winampPlayers);
    expect(Number(layer().style.zIndex)).toBeLessThan(40);
  });

  it("queues the whole Fuse soundtrack, with tags and lengths, without playing anything", async () => {
    const user = userEvent.setup();
    const { winampPlayers, winampRegistry } = renderWithProviders(<Desktop />);
    const player = await openReadyWinamp(user, winampPlayers);
    expect(player.tracks).toEqual(SOUNDTRACK);
    expect(player.tracks).toHaveLength(FUSE_TRACKS.length);
    expect(player.tracks[0]).toMatchObject({
      url: "/fuse-riders/music/pixel-sax-parade.m4a",
      metaData: { title: "Pixel Sax Parade" },
      duration: 189.72,
    });
    // Nothing may sound before the user presses something.
    expect(player.getMediaStatus()).toBe("STOPPED");
    // The Office Assistant sees the queue by name, before and after pressing play.
    const controls = winampRegistry.first();
    expect(controls?.status()).toMatchObject({
      trackCount: 20,
      currentTrack: undefined,
      playing: false,
    });
    expect(controls?.status().tracks[0]).toBe("Pixel Sax Parade (Fuse Radio)");
    expect(controls?.status().tracks[19]).toBe("Victory (Killer Fuse)");
    controls?.play();
    expect(controls?.status()).toMatchObject({
      playing: true,
      currentTrack: "Pixel Sax Parade (Fuse Radio)",
    });
  });

  it("resolves the soundtrack against whatever base the OS is served from", async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      winampDeps: { base: "./" },
    });
    const player = await openReadyWinamp(user, winampPlayers);
    const urls = player.tracks.map((track) => track.url);
    expect(urls[0]).toBe("./music/pixel-sax-parade.m4a");
    expect(urls).toContain("./killer-fuse/audio/music/match-day.mp3");
  });

  it("names a file picked in Webamp's own dialog by its file name", async () => {
    const user = userEvent.setup();
    const { winampPlayers, winampRegistry } = renderWithProviders(<Desktop />);
    const player = await openReadyWinamp(user, winampPlayers);
    act(() => player.pickFiles(["song.mp3"]));
    expect(winampRegistry.first()?.status()).toMatchObject({
      trackCount: SOUNDTRACK.length + 1,
      currentTrack: "song.mp3",
      playing: true,
    });
  });

  it("reuses the running player instead of starting a second", async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    await openReadyWinamp(user, winampPlayers);
    await user.dblClick(desktopIcon("Winamp"));
    expect(screen.getAllByTestId("winamp-layer")).toHaveLength(1);
    expect(winampPlayers).toHaveLength(1);
  });

  it("also opens from Start > Programs > Accessories > Winamp and restores from ?open=winamp over a stored desktop", async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      initialState: {
        ...DEFAULT_STATE,
        windows: [
          { id: "w1", kind: "winamp", minimized: false, maximized: false },
        ],
      },
      initialOpen: [{ kind: "winamp" }],
    });
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    expect(screen.getAllByTestId("winamp-layer")).toHaveLength(1);
    act(() => playerAt(winampPlayers, 0).pressClose());
    await waitFor(() =>
      expect(screen.queryByTestId("winamp-layer")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Start/ }));
    const menu = screen.getByRole("menu", { name: "Start menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Programs" }));
    await user.click(
      within(menu).getByRole("menuitem", { name: "Accessories" }),
    );
    await user.click(within(menu).getByRole("menuitem", { name: "Winamp" }));
    expect(await screen.findByTestId("winamp-layer")).toBeInTheDocument();
    await waitFor(() => expect(winampPlayers).toHaveLength(2));
  });

  it("closes the desktop's Winamp entry from Webamp's own close button, disposing the player, and starts fresh on reopen", async () => {
    const user = userEvent.setup();
    const { winampPlayers, winampRegistry, store } = renderWithProviders(
      <Desktop />,
    );
    const player = await openReadyWinamp(user, winampPlayers);
    act(() => player.pickFiles(["song.mp3"]));
    expect(winampRegistry.size()).toBe(1);

    act(() => player.pressClose());
    await waitFor(() =>
      expect(screen.queryByTestId("winamp-layer")).not.toBeInTheDocument(),
    );
    expect(store.load().windows).toEqual([]);
    expect(player.disposed).toBe(true);
    expect(winampRegistry.size()).toBe(0);

    // Reopening starts a fresh player with just the soundtrack; the old one is not reused.
    await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(2));
    expect(playerAt(winampPlayers, 1)).not.toBe(player);
    await waitFor(() =>
      expect(playerAt(winampPlayers, 1).tracks).toEqual(SOUNDTRACK),
    );
  });

  it("minimizes from Webamp's own button, keeps playing out of sight, and comes back from the taskbar", async () => {
    const user = userEvent.setup();
    const { winampPlayers, store } = renderWithProviders(<Desktop />);
    const player = await openReadyWinamp(user, winampPlayers);
    act(() => player.play());

    act(() => player.pressMinimize());
    await waitFor(() => expect(store.load().windows[0]?.minimized).toBe(true));
    expect(layer()).toHaveStyle({ display: "none" });
    expect(layer()).toHaveAttribute("aria-hidden", "true");
    expect(player.getMediaStatus()).toBe("PLAYING");
    expect(player.disposed).toBe(false);

    await user.click(taskbarButton("Winamp"));
    await waitFor(() => expect(store.load().windows[0]?.minimized).toBe(false));
    expect(layer()).not.toHaveStyle({ display: "none" });
    expect(layer()).toHaveAttribute("aria-hidden", "false");
    // The same player, not a new one.
    expect(winampPlayers).toHaveLength(1);

    // The taskbar button minimizes the active Winamp again, as it does any window.
    await user.click(taskbarButton("Winamp"));
    await waitFor(() => expect(store.load().windows[0]?.minimized).toBe(true));
  });

  it("says so in the middle of the desktop when Winamp is not available in this preview", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      winampDeps: { createPlayer: undefined },
    });
    await openWinamp(user);
    expect(within(layer()).getByRole("status")).toHaveTextContent(
      "Winamp is not available in this preview.",
    );
  });

  it("reports why Winamp could not start", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      winampDeps: {
        createPlayer: async () => {
          throw new Error("chunk failed to load");
        },
      },
    });
    await openWinamp(user);
    await waitFor(() =>
      expect(within(layer()).getByRole("status")).toHaveTextContent(
        "Winamp could not start: chunk failed to load",
      ),
    );
  });

  it("disposes a player that finishes loading after Winamp was closed", async () => {
    const user = userEvent.setup();
    let resolvePlayer: ((player: FakeWebampPlayer) => void) | undefined;
    const { store, winampRegistry } = renderWithProviders(
      <>
        <Desktop />
        <CloseAllWindows />
      </>,
      {
        winampDeps: {
          createPlayer: () =>
            new Promise<FakeWebampPlayer>((resolve) => {
              resolvePlayer = resolve;
            }),
        },
      },
    );
    await openWinamp(user);
    expect(within(layer()).getByRole("status")).toHaveTextContent(
      "Starting Winamp...",
    );
    await user.click(screen.getByRole("button", { name: "Close all windows" }));
    expect(screen.queryByTestId("winamp-layer")).not.toBeInTheDocument();
    expect(store.load().windows).toEqual([]);

    const late = createFakeWebampPlayer();
    act(() => resolvePlayer?.(late));
    await waitFor(() => expect(late.disposed).toBe(true));
    expect(late.renderedInto).toEqual([]);
    expect(winampRegistry.size()).toBe(0);
  });

  it("shows a Win98 message box naming the content security policy when a track is blocked from playing", async () => {
    const user = userEvent.setup();
    let reportError: ((info: MediaErrorInfo) => void) | undefined;
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      winampDeps: {
        subscribeMediaErrors: (onError) => {
          reportError = onError;
          return () => {
            reportError = undefined;
          };
        },
      },
    });
    const player = await openReadyWinamp(user, winampPlayers);
    act(() => player.pickFiles(["song.mp3"]));
    expect(player.getMediaStatus()).toBe("PLAYING");

    act(() => reportError?.({ cause: "csp", directive: "media-src" }));

    const messageBox = await screen.findByRole("dialog", { name: "Winamp" });
    expect(messageBox).toHaveTextContent("song.mp3");
    expect(messageBox).toHaveTextContent("content security policy");
    expect(messageBox).toHaveTextContent("media-src");
    await user.click(within(messageBox).getByRole("button", { name: "OK" }));
    expect(screen.queryByText(/content security policy/)).toBeNull();
    // The player itself is untouched by the error dialog closing.
    expect(layer()).toBeInTheDocument();
    expect(player.disposed).toBe(false);
  });

  it("names a soundtrack track by title and game when it fails to load, once per track", async () => {
    const user = userEvent.setup();
    let reportError: ((info: MediaErrorInfo) => void) | undefined;
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      winampDeps: {
        subscribeMediaErrors: (onError) => {
          reportError = onError;
          return () => {
            reportError = undefined;
          };
        },
      },
    });
    const player = await openReadyWinamp(user, winampPlayers);
    // Nothing loaded yet: an error has no track to blame and is ignored.
    act(() => reportError?.({ cause: "unknown" }));
    expect(screen.queryByRole("dialog", { name: "Winamp" })).toBeNull();

    act(() => player.play());
    act(() => reportError?.({ cause: "unknown" }));
    act(() => reportError?.({ cause: "unknown" }));
    const boxes = await screen.findAllByRole("dialog", { name: "Winamp" });
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toHaveTextContent(
      'Winamp could not play "Pixel Sax Parade (Fuse Radio)". The browser blocked or failed to load this file.',
    );
  });
});
