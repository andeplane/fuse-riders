import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import type { FakeWebampPlayer } from "../__mocks__/webampPlayer";
import { Desktop } from "../desktop/Desktop";

import { FUSE_TRACKS, fuseSoundtrack } from "./fuseTracks";
import type { MediaErrorInfo } from "./mediaErrorReporting";

/** The nth Webamp player the window created; fails the test when there is none. */
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

async function openWinamp(user: ReturnType<typeof userEvent.setup>) {
  await user.dblClick(desktopIcon("Winamp"));
  return screen.findByRole("dialog", { name: "Winamp" });
}

/** Opens Winamp and waits for the (fake) player to be created and the toolbar enabled. */
async function openReadyWinamp(
  user: ReturnType<typeof userEvent.setup>,
  players: readonly FakeWebampPlayer[],
) {
  const dialog = await openWinamp(user);
  await waitFor(() => expect(players).toHaveLength(1));
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Open files..." }),
    ).toBeEnabled(),
  );
  return dialog;
}

/**
 * The message box among "Winamp"-named dialogs that is not the player window itself:
 * a playback error dialog is titled "Winamp" too, the way a real Windows message box
 * names the app, not the specific window it came from.
 */
async function findMessageBox(playerWindow: HTMLElement) {
  return waitFor(() => {
    const dialogs = screen.getAllByRole("dialog", { name: "Winamp" });
    const messageBox = dialogs.find((element) => element !== playerWindow);
    if (!messageBox) throw new Error("No message box shown yet");
    return messageBox;
  });
}

/** The Webamp tracks the test harness's base (`/fuse-riders/`) resolves the soundtrack to. */
const SOUNDTRACK = fuseSoundtrack("/fuse-riders/").map(({ track }) => track);

describe("Winamp", () => {
  it("opens from the desktop icon, mounts the player and says what is queued and that local files stay on the device", async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    const dialog = await openReadyWinamp(user, winampPlayers);
    expect(
      within(dialog).getByText(
        `${FUSE_TRACKS.length} tracks from the Fuse games are queued. Local files never leave this device.`,
      ),
    ).toBeInTheDocument();
    expect(playerAt(winampPlayers, 0).renderedInto).toHaveLength(1);
  });

  it("queues the whole Fuse soundtrack, with tags and lengths, without playing anything", async () => {
    const user = userEvent.setup();
    const { winampPlayers, winampRegistry } = renderWithProviders(<Desktop />);
    await openReadyWinamp(user, winampPlayers);
    const player = playerAt(winampPlayers, 0);
    expect(player.tracks).toEqual(SOUNDTRACK);
    expect(player.tracks).toHaveLength(20);
    expect(player.tracks[0]).toMatchObject({
      url: "/fuse-riders/music/pixel-sax-parade.m4a",
      metaData: { title: "Pixel Sax Parade" },
      duration: 189.72,
    });
    // Nothing may sound before the user presses something.
    expect(player.getMediaStatus()).toBe("STOPPED");
    // The Office Assistant sees the queue by name, before and after pressing play.
    const [controls] = [...winampRegistry.values()];
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
    await openReadyWinamp(user, winampPlayers);
    const urls = playerAt(winampPlayers, 0).tracks.map((track) => track.url);
    expect(urls[0]).toBe("./music/pixel-sax-parade.m4a");
    expect(urls).toContain("./killer-fuse/audio/music/match-day.mp3");
  });

  it("mounts the player into a non-statically positioned node, which Webamp requires", async () => {
    // Webamp throws "The DOM node passed to renderInto must have a non-static position" and the
    // window shows nothing but that error, so the mount's position is part of the contract.
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    const mount = playerAt(winampPlayers, 0).renderedInto[0];
    expect(mount).toBeDefined();
    // Asserted on the inline style, not a class: Tailwind's stylesheet is not loaded in tests, so a
    // `relative` class would leave position empty here and this test would pass without proving anything.
    expect(mount).toHaveStyle({ position: "relative" });
  });

  it("gives the complete player stack its intrinsic height before Webamp centres it", async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    const dialog = await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    const mount = playerAt(winampPlayers, 0).renderedInto[0];
    // Webamp centres the entire 275x348 main/equalizer/playlist stack at render time.
    // A short flex mount gives the main transport a negative top that cannot be scrolled to.
    expect(mount).toHaveStyle({
      width: "275px",
      height: "348px",
      flexShrink: "0",
    });
    expect(dialog.parentElement).toHaveStyle({
      width: "320px",
      height: "440px",
    });
  });

  it("reuses the open window instead of stacking a duplicate", async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(1));
    await user.dblClick(desktopIcon("Winamp"));
    expect(screen.getAllByRole("dialog", { name: "Winamp" })).toHaveLength(1);
    expect(winampPlayers).toHaveLength(1);
  });

  it("also opens from Start > Programs > Accessories > Winamp", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.click(screen.getByRole("button", { name: /Start/ }));
    const menu = screen.getByRole("menu", { name: "Start menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Programs" }));
    await user.click(
      within(menu).getByRole("menuitem", { name: "Accessories" }),
    );
    await user.click(within(menu).getByRole("menuitem", { name: "Winamp" }));
    expect(
      await screen.findByRole("dialog", { name: "Winamp" }),
    ).toBeInTheDocument();
  });

  it("adds locally picked files after the soundtrack and starts the first of them", async () => {
    const user = userEvent.setup();
    const { winampPlayers, winampDeps } = renderWithProviders(<Desktop />);
    const dialog = await openReadyWinamp(user, winampPlayers);

    const file = new File(["data"], "song.mp3", { type: "audio/mpeg" });
    await user.upload(within(dialog).getByLabelText("Open audio files"), file);

    const player = playerAt(winampPlayers, 0);
    await waitFor(() =>
      expect(player.tracks).toEqual([
        ...SOUNDTRACK,
        { url: "blob:song.mp3", defaultName: "song.mp3" },
      ]),
    );
    expect(winampDeps.createObjectURL).toHaveBeenCalledWith(file);
    expect(player.getMediaStatus()).toBe("PLAYING");
    expect(player.currentIndex).toBe(SOUNDTRACK.length);
  });

  it("does not interrupt a playing track when more files are picked", async () => {
    const user = userEvent.setup();
    const { winampPlayers } = renderWithProviders(<Desktop />);
    const dialog = await openReadyWinamp(user, winampPlayers);
    const player = playerAt(winampPlayers, 0);
    player.setCurrentTrack(3);
    player.play();

    await user.upload(
      within(dialog).getByLabelText("Open audio files"),
      new File(["data"], "song.mp3", { type: "audio/mpeg" }),
    );

    await waitFor(() =>
      expect(player.tracks).toHaveLength(SOUNDTRACK.length + 1),
    );
    expect(player.currentIndex).toBe(3);
    expect(player.getMediaStatus()).toBe("PLAYING");
  });

  it("puts the Fuse soundtrack back and plays it from the top on the button, dropping local files", async () => {
    const user = userEvent.setup();
    const { winampPlayers, winampDeps } = renderWithProviders(<Desktop />);
    const dialog = await openReadyWinamp(user, winampPlayers);
    const player = playerAt(winampPlayers, 0);
    await user.upload(
      within(dialog).getByLabelText("Open audio files"),
      new File(["data"], "song.mp3", { type: "audio/mpeg" }),
    );
    await waitFor(() =>
      expect(player.tracks).toHaveLength(SOUNDTRACK.length + 1),
    );
    player.pause();

    await user.click(
      within(dialog).getByRole("button", { name: "Fuse soundtrack" }),
    );

    expect(player.tracks).toEqual(SOUNDTRACK);
    expect(player.currentIndex).toBe(0);
    expect(player.getMediaStatus()).toBe("PLAYING");
    expect(winampDeps.revokeObjectURL).toHaveBeenCalledWith("blob:song.mp3");
    // Closing later does not revoke the same url a second time.
    await user.click(within(dialog).getByLabelText("Close"));
    expect(winampDeps.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("disposes the player and revokes every object URL when the window closes, and starts fresh on reopen", async () => {
    const user = userEvent.setup();
    const { winampPlayers, winampDeps } = renderWithProviders(<Desktop />);
    const dialog = await openReadyWinamp(user, winampPlayers);
    const file = new File(["data"], "song.mp3", { type: "audio/mpeg" });
    await user.upload(within(dialog).getByLabelText("Open audio files"), file);
    await waitFor(() =>
      expect(playerAt(winampPlayers, 0).tracks).toHaveLength(
        SOUNDTRACK.length + 1,
      ),
    );

    await user.click(within(dialog).getByLabelText("Close"));
    expect(screen.queryByRole("dialog", { name: "Winamp" })).toBeNull();
    expect(playerAt(winampPlayers, 0).disposed).toBe(true);
    expect(winampDeps.revokeObjectURL).toHaveBeenCalledWith("blob:song.mp3");

    // Reopening starts a fresh player with just the soundtrack; the old one is not reused.
    const again = await openWinamp(user);
    await waitFor(() => expect(winampPlayers).toHaveLength(2));
    expect(within(again).queryByText(/song.mp3/)).toBeNull();
    expect(playerAt(winampPlayers, 1)).not.toBe(playerAt(winampPlayers, 0));
    await waitFor(() =>
      expect(playerAt(winampPlayers, 1).tracks).toEqual(SOUNDTRACK),
    );
  });

  it("says so when Winamp is not available in this preview", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      winampDeps: { createPlayer: undefined },
    });
    const dialog = await openWinamp(user);
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Winamp is not available in this preview.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Open files..." }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Fuse soundtrack" }),
    ).toBeDisabled();
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
    const dialog = await openWinamp(user);
    await waitFor(() =>
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        "Winamp could not start: chunk failed to load",
      ),
    );
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
    const playerWindow = await openReadyWinamp(user, winampPlayers);
    const file = new File(["data"], "song.mp3", { type: "audio/mpeg" });
    await user.upload(
      within(playerWindow).getByLabelText("Open audio files"),
      file,
    );
    await waitFor(() =>
      expect(playerAt(winampPlayers, 0).getMediaStatus()).toBe("PLAYING"),
    );

    reportError?.({ cause: "csp", directive: "media-src" });

    const messageBox = await findMessageBox(playerWindow);
    expect(messageBox).toHaveTextContent("song.mp3");
    expect(messageBox).toHaveTextContent("content security policy");
    expect(messageBox).toHaveTextContent("media-src");
    await user.click(within(messageBox).getByRole("button", { name: "OK" }));
    expect(screen.queryByText(/content security policy/)).toBeNull();
    // The player window itself is untouched by the error dialog closing.
    expect(screen.getByRole("dialog", { name: "Winamp" })).toBe(playerWindow);
  });

  it("names a soundtrack track by title and game when it fails to load", async () => {
    const user = userEvent.setup();
    let reportError: ((info: MediaErrorInfo) => void) | undefined;
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      winampDeps: {
        subscribeMediaErrors: (onError) => {
          reportError = onError;
          return () => undefined;
        },
      },
    });
    const playerWindow = await openReadyWinamp(user, winampPlayers);
    const player = playerAt(winampPlayers, 0);
    player.setCurrentTrack(19);
    player.play();

    reportError?.({ cause: "unknown" });

    const messageBox = await findMessageBox(playerWindow);
    expect(messageBox).toHaveTextContent('"Victory (Killer Fuse)"');
    expect(messageBox).toHaveTextContent("blocked or failed to load");
  });

  it("shows a generic message box for a load failure that is not reported as a CSP violation", async () => {
    const user = userEvent.setup();
    let reportError: ((info: MediaErrorInfo) => void) | undefined;
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      winampDeps: {
        subscribeMediaErrors: (onError) => {
          reportError = onError;
          return () => undefined;
        },
      },
    });
    const playerWindow = await openReadyWinamp(user, winampPlayers);
    const file = new File(["data"], "broken.mp3", { type: "audio/mpeg" });
    await user.upload(
      within(playerWindow).getByLabelText("Open audio files"),
      file,
    );
    await waitFor(() =>
      expect(playerAt(winampPlayers, 0).getMediaStatus()).toBe("PLAYING"),
    );

    reportError?.({ cause: "unknown" });

    const messageBox = await findMessageBox(playerWindow);
    expect(messageBox).toHaveTextContent("broken.mp3");
    expect(messageBox).toHaveTextContent("blocked or failed to load");
  });

  it("shows only one message box for repeated failures of the same track", async () => {
    const user = userEvent.setup();
    let reportError: ((info: MediaErrorInfo) => void) | undefined;
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      winampDeps: {
        subscribeMediaErrors: (onError) => {
          reportError = onError;
          return () => undefined;
        },
      },
    });
    const playerWindow = await openReadyWinamp(user, winampPlayers);
    const file = new File(["data"], "song.mp3", { type: "audio/mpeg" });
    await user.upload(
      within(playerWindow).getByLabelText("Open audio files"),
      file,
    );
    await waitFor(() =>
      expect(playerAt(winampPlayers, 0).getMediaStatus()).toBe("PLAYING"),
    );

    reportError?.({ cause: "csp", directive: "media-src" });
    await findMessageBox(playerWindow);
    // A second raw browser event for the same still-current track (e.g. both the CSP
    // report and the element's own error event firing for one failed load).
    reportError?.({ cause: "unknown" });

    // The player window plus exactly one message box, never two.
    expect(screen.getAllByRole("dialog", { name: "Winamp" })).toHaveLength(2);
  });

  it("ignores a media error that arrives before any track has loaded", async () => {
    const user = userEvent.setup();
    let reportError: ((info: MediaErrorInfo) => void) | undefined;
    const { winampPlayers } = renderWithProviders(<Desktop />, {
      winampDeps: {
        subscribeMediaErrors: (onError) => {
          reportError = onError;
          return () => undefined;
        },
      },
    });
    await openReadyWinamp(user, winampPlayers);
    reportError?.({ cause: "unknown" });
    expect(screen.getAllByRole("dialog", { name: "Winamp" })).toHaveLength(1);
  });
});
