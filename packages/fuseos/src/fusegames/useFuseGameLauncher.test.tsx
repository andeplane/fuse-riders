import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PHONE_DEVICE,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { MemoryFuseOsPrefsStore } from "../settings/fuseosPrefsStore";
import { useAppState } from "../state/useAppState";

import { useFuseGameLauncher } from "./useFuseGameLauncher";

function Launcher({ gameId }: { gameId: string }) {
  const { launch, launchMode } = useFuseGameLauncher();
  const { state } = useAppState();
  return (
    <div>
      <button type="button" onClick={() => launch(gameId)}>
        Launch {gameId}
      </button>
      <output data-testid="mode">{launchMode()}</output>
      <output data-testid="windows">
        {state.windows.map((window) => window.id).join(",")}
      </output>
    </div>
  );
}

describe(useFuseGameLauncher.name, () => {
  it("opens a window on a desktop, focuses it the second time, and reports one launch", async () => {
    const user = userEvent.setup();
    const { store, osAnalytics, desktopDeps } = renderWithProviders(
      <Launcher gameId="fuseball" />,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("window");
    await user.click(screen.getByRole("button", { name: "Launch fuseball" }));
    await user.click(screen.getByRole("button", { name: "Launch fuseball" }));
    expect(screen.getByTestId("windows")).toHaveTextContent("w1");
    expect(store.load().windows).toEqual([
      expect.objectContaining({ kind: "fusegame", gameId: "fuseball" }),
    ]);
    expect(osAnalytics.launches).toEqual([
      { game: "fuseball", launch: "window" },
    ]);
    expect(desktopDeps.openExternal).not.toHaveBeenCalled();
  });

  it("opens a browser tab on a phone, with the game's muted address, and no window", async () => {
    const user = userEvent.setup();
    const { store, osAnalytics, desktopDeps } = renderWithProviders(
      <Launcher gameId="fuse-riders" />,
      { launchDevice: PHONE_DEVICE, muted: true },
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("tab");
    await user.click(
      screen.getByRole("button", { name: "Launch fuse-riders" }),
    );
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuse-riders/?mute",
    );
    expect(store.load().windows).toEqual([]);
    expect(osAnalytics.launches).toEqual([
      { game: "fuse-riders", launch: "tab" },
    ]);
  });

  it("lets a stored choice win over the device", async () => {
    const user = userEvent.setup();
    const prefsStore = new MemoryFuseOsPrefsStore({ gameLaunch: "tab" });
    const { desktopDeps } = renderWithProviders(
      <Launcher gameId="fuseball" />,
      { prefsStore },
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("tab");
    await user.click(screen.getByRole("button", { name: "Launch fuseball" }));
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
  });

  it("opens a window for an unknown game, which explains itself, and reports nothing", async () => {
    const user = userEvent.setup();
    const { store, osAnalytics, desktopDeps } = renderWithProviders(
      <Launcher gameId="pong" />,
      { launchDevice: PHONE_DEVICE },
    );
    await user.click(screen.getByRole("button", { name: "Launch pong" }));
    expect(desktopDeps.openExternal).not.toHaveBeenCalled();
    expect(store.load().windows).toEqual([
      expect.objectContaining({ kind: "fusegame", gameId: "pong" }),
    ]);
    expect(osAnalytics.launches).toEqual([]);
  });
});
