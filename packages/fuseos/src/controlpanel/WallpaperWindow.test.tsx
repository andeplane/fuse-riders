import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

function renderWallpaperWindow(
  options: Parameters<typeof renderWithProviders>[1] = {},
) {
  const state: AppState = {
    ...DEFAULT_STATE,
    windows: [
      { id: "w1", minimized: false, maximized: false, kind: "wallpaper" },
    ],
  };
  return renderWithProviders(<Desktop />, { ...options, initialState: state });
}

describe("WallpaperWindow", () => {
  it("keeps settings in a keyboard-scrollable region and the window buttons outside it while using the camera", async () => {
    const user = userEvent.setup();
    renderWallpaperWindow();
    const dialog = await screen.findByRole("dialog", {
      name: "Change desktop background",
    });
    const settings = within(dialog).getByRole("region", {
      name: "Background settings",
    });
    expect(settings).toHaveAttribute("tabindex", "0");
    expect(settings).not.toContainElement(
      within(dialog).getByRole("button", { name: "OK" }),
    );
    expect(settings).not.toContainElement(
      within(dialog).getByRole("button", { name: "Apply" }),
    );

    await user.click(
      within(settings).getByRole("button", { name: "Camera..." }),
    );
    const camera = await within(settings).findByRole("group", {
      name: "Camera",
    });
    const video = within(camera).getByTestId("camera-preview");
    expect(video).toHaveStyle({ maxHeight: "160px", objectFit: "contain" });
    expect(within(settings).queryByLabelText("Wallpaper preview")).toBeNull();
    expect(
      within(camera).getByRole("button", { name: "Capture" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "OK" }),
    ).toBeInTheDocument();
  });

  it("stops a camera stream that arrives after the window has closed", async () => {
    const user = userEvent.setup();
    const pending = deferred<MediaStream>();
    const stop = vi.fn();
    renderWallpaperWindow({ mediaDeps: { openCamera: () => pending.promise } });
    const dialog = await screen.findByRole("dialog", {
      name: "Change desktop background",
    });
    await user.click(within(dialog).getByRole("button", { name: "Camera..." }));
    await user.click(within(dialog).getByRole("button", { name: "OK" }));

    await act(async () => pending.resolve(cameraStream(stop)));
    expect(stop).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("dialog", { name: "Change desktop background" }),
    ).toBeNull();
  });

  it("allows cancelling a pending camera request and stops its late stream", async () => {
    const user = userEvent.setup();
    const pending = deferred<MediaStream>();
    const stop = vi.fn();
    renderWallpaperWindow({ mediaDeps: { openCamera: () => pending.promise } });
    const dialog = await screen.findByRole("dialog", {
      name: "Change desktop background",
    });
    await user.click(within(dialog).getByRole("button", { name: "Camera..." }));
    const camera = within(dialog).getByRole("group", { name: "Camera" });
    expect(
      within(camera).getByRole("button", { name: "Capture" }),
    ).toBeDisabled();
    await user.click(within(camera).getByRole("button", { name: "Cancel" }));

    await act(async () => pending.resolve(cameraStream(stop)));
    expect(stop).toHaveBeenCalledOnce();
    expect(within(dialog).queryByRole("group", { name: "Camera" })).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Camera..." }),
    ).toBeEnabled();
  });

  it("does not apply a captured photo after camera cancellation", async () => {
    const user = userEvent.setup();
    const pending = deferred<string>();
    const stop = vi.fn();
    const { wallpaperStore } = renderWallpaperWindow({
      mediaDeps: {
        openCamera: async () => cameraStream(stop),
        captureFrame: () => pending.promise,
      },
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Change desktop background",
    });
    await user.click(within(dialog).getByRole("button", { name: "Camera..." }));
    const camera = await within(dialog).findByRole("group", { name: "Camera" });
    await user.click(within(camera).getByRole("button", { name: "Capture" }));
    expect(
      within(camera).getByRole("button", { name: "Capture" }),
    ).toBeDisabled();
    await user.click(within(camera).getByRole("button", { name: "Cancel" }));

    await act(async () => pending.resolve("data:image/jpeg;base64,LATE"));
    expect(wallpaperStore.get()).toBeUndefined();
    expect(stop).toHaveBeenCalledOnce();
    expect(within(dialog).getByText("(None)")).toBeInTheDocument();
  });

  it("sets the wallpaper from a file and clears it back to the solid colour, over the shared store", async () => {
    const user = userEvent.setup();
    const { wallpaperStore } = renderWallpaperWindow();
    const dialog = await screen.findByRole("dialog", {
      name: "Change desktop background",
    });
    expect(within(dialog).getByText("(None)")).toBeInTheDocument();

    const file = new File(["x"], "photo.png", { type: "image/png" });
    await user.upload(within(dialog).getByLabelText("Browse..."), file);
    await waitFor(() =>
      expect(
        within(dialog).getByRole("img", { name: "Current wallpaper" }),
      ).toHaveAttribute("src", "data:image/jpeg;base64,FILE"),
    );
    expect(wallpaperStore.get()).toBe("data:image/jpeg;base64,FILE");

    await user.click(within(dialog).getByRole("button", { name: "None" }));
    expect(within(dialog).getByText("(None)")).toBeInTheDocument();
    expect(wallpaperStore.get()).toBeUndefined();
  });

  it("closes on OK and on Cancel, and leaves a wallpaper picked before either applied", async () => {
    const user = userEvent.setup();
    const { wallpaperStore } = renderWallpaperWindow();
    const dialog = await screen.findByRole("dialog", {
      name: "Change desktop background",
    });
    const file = new File(["x"], "photo.png", { type: "image/png" });
    await user.upload(within(dialog).getByLabelText("Browse..."), file);
    await waitFor(() =>
      expect(wallpaperStore.get()).toBe("data:image/jpeg;base64,FILE"),
    );

    await user.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(
      screen.queryByRole("dialog", { name: "Change desktop background" }),
    ).toBeNull();
    expect(wallpaperStore.get()).toBe("data:image/jpeg;base64,FILE");
  });

  it("reuses the open window instead of opening a second one", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.click(screen.getByRole("button", { name: /Start/ }));
      const menu = screen.getByRole("menu", { name: "Start menu" });
      await user.click(
        within(menu).getByRole("menuitem", { name: "Programs" }),
      );
      await user.click(
        within(menu).getByRole("menuitem", { name: "Accessories" }),
      );
      await user.click(
        within(menu).getByRole("menuitem", {
          name: "Change desktop background",
        }),
      );
      await screen.findByRole("dialog", { name: "Change desktop background" });
    }
    expect(
      screen.getAllByRole("dialog", { name: "Change desktop background" }),
    ).toHaveLength(1);
  });
});

function cameraStream(stop: () => void): MediaStream {
  return { getTracks: () => [{ stop }] } as Partial<MediaStream> as MediaStream;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise not initialized");
  };
  const promise = new Promise<T>((fulfil: (value: T) => void) => {
    resolve = fulfil;
  });
  return { promise, resolve };
}
