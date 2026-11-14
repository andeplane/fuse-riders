import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useContext } from "react";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";

import type { PipesHandle, PipesOptions } from "./pipes/pipes";
import { ScreenSaverContext } from "./screenSaverContext";
import type { PipesModule } from "./screenSaverDepsContext";
import { MemoryScreenSaverStore } from "./screenSaverStore";

/** A pipes module that records where and how it was started, and whether it was stopped. */
function fakePipes() {
  const starts: {
    container: HTMLElement;
    options: PipesOptions;
    handle: PipesHandle & { stopped: boolean };
  }[] = [];
  const module: PipesModule = {
    startPipes: (container, options) => {
      const handle = {
        stopped: false,
        stop: () => {
          handle.stopped = true;
        },
        stats: () => ({
          scenes: 1,
          pipes: 1,
          meshes: 1,
          teapots: 0,
          dissolving: false,
          style: "mixed" as const,
        }),
      };
      starts.push({ container, options, handle });
      return handle;
    },
  };
  return { module, starts };
}

function StartPreview() {
  const { controls } = useContext(ScreenSaverContext);
  return (
    <button type="button" onClick={controls.preview}>
      Start preview
    </button>
  );
}

describe("Screen saver overlay", () => {
  it("covers the desktop, loads the pipes lazily into its stage with the stored options, and wakes on a key", async () => {
    const pipes = fakePipes();
    let loads = 0;
    let resolve: ((module: PipesModule) => void) | undefined;
    const store = new MemoryScreenSaverStore({
      pipes: { joints: "cycle", teapots: false, multiple: false },
    });
    renderWithProviders(
      <>
        <Desktop />
        <StartPreview />
      </>,
      {
        screenSaverStore: store,
        screenSaverDeps: {
          loadPipes: () => {
            loads += 1;
            return new Promise<PipesModule>((next) => {
              resolve = next;
            });
          },
        },
      },
    );
    expect(
      screen.queryByRole("dialog", { name: "3D Pipes screen saver" }),
    ).not.toBeInTheDocument();
    expect(loads).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    const overlay = await screen.findByRole("dialog", {
      name: "3D Pipes screen saver",
    });
    expect(overlay).toHaveFocus();
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(within(overlay).getByRole("status")).toHaveTextContent(
      "Loading 3D Pipes...",
    );
    expect(overlay).toHaveAttribute("data-status", "loading");
    resolve?.(pipes.module);
    await waitFor(() =>
      expect(overlay).toHaveAttribute("data-status", "running"),
    );
    expect(loads).toBe(1);
    expect(pipes.starts).toHaveLength(1);
    expect(pipes.starts[0]?.container).toBe(
      screen.getByTestId("screensaver-stage"),
    );
    expect(pipes.starts[0]?.options).toEqual({
      joints: "cycle",
      teapots: false,
      multiple: false,
    });
    expect(within(overlay).queryByRole("status")).not.toBeInTheDocument();

    const key = fireEvent.keyDown(overlay, { key: "a" });
    expect(key).toBe(false);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "3D Pipes screen saver" }),
      ).not.toBeInTheDocument(),
    );
    expect(pipes.starts[0]?.handle.stopped).toBe(true);
    expect(
      screen.getByRole("list", { name: "Desktop icons" }),
    ).toBeInTheDocument();
  });

  it("wakes on a pointer too, and can start again with a fresh scene", async () => {
    const pipes = fakePipes();
    renderWithProviders(
      <>
        <Desktop />
        <StartPreview />
      </>,
      { screenSaverDeps: { loadPipes: () => Promise.resolve(pipes.module) } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    const overlay = await screen.findByRole("dialog", {
      name: "3D Pipes screen saver",
    });
    await waitFor(() => expect(pipes.starts).toHaveLength(1));
    fireEvent.pointerDown(overlay);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "3D Pipes screen saver" }),
      ).not.toBeInTheDocument(),
    );
    expect(pipes.starts[0]?.handle.stopped).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    await screen.findByRole("dialog", { name: "3D Pipes screen saver" });
    await waitFor(() => expect(pipes.starts).toHaveLength(2));
    expect(pipes.starts[1]?.handle.stopped).toBe(false);
  });

  it("says when the pipes cannot start and still wakes on input", async () => {
    renderWithProviders(
      <>
        <Desktop />
        <StartPreview />
      </>,
      {
        screenSaverDeps: {
          loadPipes: () => Promise.reject(new Error("WebGL is not available")),
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    const overlay = await screen.findByRole("dialog", {
      name: "3D Pipes screen saver",
    });
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "3D Pipes cannot start: WebGL is not available",
    );
    expect(overlay).toHaveAttribute("data-status", "failed");
    fireEvent.keyDown(overlay, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "3D Pipes screen saver" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("ignores a module that arrives after the saver was already dismissed", async () => {
    const pipes = fakePipes();
    let resolve: ((module: PipesModule) => void) | undefined;
    renderWithProviders(
      <>
        <Desktop />
        <StartPreview />
      </>,
      {
        screenSaverDeps: {
          loadPipes: () =>
            new Promise<PipesModule>((next) => {
              resolve = next;
            }),
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    const overlay = await screen.findByRole("dialog", {
      name: "3D Pipes screen saver",
    });
    fireEvent.keyDown(overlay, { key: "a" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "3D Pipes screen saver" }),
      ).not.toBeInTheDocument(),
    );
    resolve?.(pipes.module);
    await Promise.resolve();
    expect(pipes.starts).toHaveLength(0);
  });
});
