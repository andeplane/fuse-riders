import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProviderOptions } from "../__mocks__/renderWithProviders";
import {
  PHONE_DEVICE,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";

import { CODEC_CHECK_AT } from "./playback";

function renderPlayer(
  file: string,
  launches?: string,
  options: ProviderOptions = {},
) {
  const user = userEvent.setup();
  const result = renderWithProviders(<Desktop />, {
    initialOpen: [{ kind: "mediaplayer", file, launches }],
    ...options,
  });
  const title = `${file} - Windows Media Player`;
  const window = () => screen.getByRole("dialog", { name: title });
  const tick = (times = 1) => {
    for (let index = 0; index < times; index += 1)
      act(() => result.mediaPlayerTimers.fire());
  };
  const progress = () =>
    Number(
      within(window())
        .getByRole("progressbar", { name: "Buffered" })
        .getAttribute("aria-valuenow"),
    );
  return { ...result, user, window, tick, progress, title };
}

describe("MediaPlayerWindow", () => {
  it("buffers on the schedule from the moment it opens and fails the codec check", async () => {
    const { user, window, tick, progress, mediaPlayerTimers } = renderPlayer(
      "Debbie_Does_Netcode.avi",
    );
    expect(window()).toHaveTextContent("Buffering... 0%");
    expect(mediaPlayerTimers.size).toBe(1);
    expect(progress()).toBe(0);
    tick(2);
    expect(progress()).toBe(6);
    expect(window()).toHaveTextContent("Buffering... 6%");
    expect(
      within(window()).getByRole("button", { name: "Play" }),
    ).toBeDisabled();
    expect(
      within(window()).getByRole("button", { name: "Stop" }),
    ).toBeEnabled();

    tick(20);
    const box = within(window()).getByRole("dialog", {
      name: "Windows Media Player",
    });
    expect(box).toHaveTextContent('cannot play "Debbie_Does_Netcode.avi"');
    expect(box).toHaveTextContent("Codec not found");
    expect(progress()).toBeLessThan(CODEC_CHECK_AT);
    expect(mediaPlayerTimers.size).toBe(0);
    expect(within(window()).getByText("Cannot play file")).toBeInTheDocument();

    await user.click(within(box).getByRole("button", { name: "OK" }));
    expect(
      within(window()).queryByRole("dialog", { name: "Windows Media Player" }),
    ).toBeNull();
    expect(within(window()).getByText("Stopped")).toBeInTheDocument();
    expect(progress()).toBe(0);

    await user.click(within(window()).getByRole("button", { name: "Play" }));
    expect(window()).toHaveTextContent("Buffering... 0%");
    expect(mediaPlayerTimers.size).toBe(1);
  });

  it("stops and restarts from the transport buttons and the Play menu, cancelling the pending tick", async () => {
    const { user, window, tick, mediaPlayerTimers } = renderPlayer(
      "Hot_Singles_In_Your_Lobby.mpg",
    );
    tick();
    await user.click(within(window()).getByRole("button", { name: "Stop" }));
    expect(mediaPlayerTimers.size).toBe(0);
    expect(within(window()).getByText("Stopped")).toBeInTheDocument();

    await user.click(within(window()).getByRole("menuitem", { name: "Play" }));
    await user.click(
      within(window()).getByRole("menuitemcheckbox", { name: "Play" }),
    );
    expect(mediaPlayerTimers.size).toBe(1);
    await user.click(within(window()).getByRole("menuitem", { name: "Play" }));
    await user.click(
      within(window()).getByRole("menuitemcheckbox", { name: "Stop" }),
    );
    expect(mediaPlayerTimers.size).toBe(0);
  });

  it("shows a running time for the file and the About box, and closes from the File menu", async () => {
    const { user, window, store, title } = renderPlayer(
      "Fifty_Shades_of_Teal.avi",
    );
    expect(window()).toHaveTextContent(/00:00:00 \/ 0[01]:\d\d:\d\d/);
    await user.click(within(window()).getByRole("menuitem", { name: "Help" }));
    await user.click(
      within(window()).getByRole("menuitemcheckbox", {
        name: "About Windows Media Player",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "About Windows Media Player" }),
    ).toHaveTextContent("It never is.");

    await user.click(within(window()).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(window()).getByRole("menuitemcheckbox", { name: "Close" }),
    );
    expect(screen.queryByRole("dialog", { name: title })).toBeNull();
    // Dialogs are transient: the stored state keeps no window at all.
    expect(store.load().windows).toEqual([]);
  });

  it("buffers the beach volleyball file to the end, launches Fuse Volley through the injected launcher and closes", () => {
    const launchGame = vi.fn();
    const { tick, store, title, mediaPlayerTimers } = renderPlayer(
      "Fuse_Volley_Beach_Edition_UNCUT.avi",
      "fuse-volley",
      { mediaPlayerDeps: { launchGame } },
    );
    tick(10);
    expect(launchGame).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: title })).toHaveTextContent(
      "Buffering...",
    );
    tick(30);
    expect(launchGame).toHaveBeenCalledWith("fuse-volley");
    expect(launchGame).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: title })).toBeNull();
    expect(store.load().windows).toEqual([]);
    expect(mediaPlayerTimers.size).toBe(0);
  });

  it("without a launcher, opens the game in a window on this desktop (or focuses its window)", () => {
    const games = [
      {
        id: "fuse-volley",
        name: "Fuse Volley",
        tagline: "Jelly-blob beach volleyball",
        mark: "FV",
        accent: "#16e7ff",
        order: 1,
        path: "fuse-volley/",
      },
    ];
    const { tick, store, title } = renderPlayer(
      "Fuse_Volley_Beach_Edition_UNCUT.avi",
      "fuse-volley",
      { games },
    );
    tick(40);
    expect(screen.queryByRole("dialog", { name: title })).toBeNull();
    expect(store.load().windows).toEqual([
      expect.objectContaining({ kind: "fusegame", gameId: "fuse-volley" }),
    ]);
    expect(
      screen.getByRole("dialog", { name: "Fuse Volley" }),
    ).toBeInTheDocument();
  });

  it("launches through the games launcher: a browser tab where games open in tabs, reported as one", () => {
    const { tick, store, desktopDeps, osAnalytics, title } = renderPlayer(
      "Fuse_Volley_Beach_Edition_UNCUT.avi",
      "fuseball",
      { launchDevice: PHONE_DEVICE },
    );
    tick(40);
    expect(screen.queryByRole("dialog", { name: title })).toBeNull();
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
    expect(store.load().windows).toEqual([]);
    expect(osAnalytics.launches).toEqual([{ game: "fuseball", launch: "tab" }]);
  });

  it("explains when the game behind a video is not installed in this build", async () => {
    const { tick, store, title } = renderPlayer(
      "Fuse_Volley_Beach_Edition_UNCUT.avi",
      "fuse-volley",
      { games: [] },
    );
    tick(40);
    expect(screen.queryByRole("dialog", { name: title })).toBeNull();
    const box = await screen.findByRole("dialog", {
      name: "Windows Media Player",
    });
    expect(box).toHaveTextContent("fuse-volley, which is not installed");
    // Dialogs are transient: the stored state keeps no window at all.
    expect(store.load().windows).toEqual([]);
  });
});
