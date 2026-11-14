import { act, fireEvent, screen } from "@testing-library/react";
import { useContext, useState } from "react";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { DesktopUiContext } from "../desktop/desktopUiContext";

import { ScreenSaverContext } from "./screenSaverContext";
import type { ScreenSaverDeps } from "./screenSaverDepsContext";
import { MemoryScreenSaverStore } from "./screenSaverStore";

describe("ScreenSaverProvider", () => {
  it("arms on mount with the stored wait, starts after idle, and wakes on input without passing it through", () => {
    const clock = idleClock();
    const store = new MemoryScreenSaverStore({ waitMinutes: 2 });
    renderWithProviders(<Harness />, {
      screenSaverDeps: clock.deps,
      screenSaverStore: store,
    });
    expect(clock.hasTimer()).toBe(true);
    expect(clock.delay()).toBe(120_000);
    act(() => clock.fireTimer());
    expect(screen.getByText("Active")).toBeInTheDocument();
    const key = new Event("keydown", { cancelable: true });
    act(() => clock.activity(key));
    expect(key.defaultPrevented).toBe(true);
    expect(screen.getByText("Idle")).toBeInTheDocument();
    // Woken: armed again for the next idle period.
    expect(clock.hasTimer()).toBe(true);
  });

  it("re-arms instead of starting while a game window has the keyboard", () => {
    const clock = idleClock();
    renderWithProviders(<Harness />, { screenSaverDeps: clock.deps });
    clock.focusGame(true);
    act(() => clock.fireTimer());
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(clock.hasTimer()).toBe(true);
    expect(clock.delay()).toBe(300_000);
    clock.focusGame(false);
    act(() => clock.fireTimer());
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("saves configuration, disarms with (None), and previews even then only when asked to", () => {
    const clock = idleClock();
    const store = new MemoryScreenSaverStore();
    const { unmount } = renderWithProviders(<Harness />, {
      screenSaverDeps: clock.deps,
      screenSaverStore: store,
    });
    fireEvent.click(screen.getByText("Configure"));
    expect(store.get()).toEqual({
      saver: "pipes",
      waitMinutes: 3,
      pipes: { joints: "ball", teapots: true, multiple: true },
    });
    expect(clock.delay()).toBe(180_000);
    fireEvent.click(screen.getByText("Disable"));
    expect(store.get().saver).toBe("none");
    expect(clock.hasTimer()).toBe(false);
    fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a screen saver before previewing it.",
    );
    fireEvent.click(screen.getByText("Configure"));
    fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(clock.hasTimer()).toBe(false);
    fireEvent.click(screen.getByText("Stop"));
    expect(screen.getByText("Idle")).toBeInTheDocument();
    unmount();
    expect(clock.unsubscribed()).toBe(true);
  });

  it("does not launch or stay active while the tab is hidden, and refuses a hidden preview", () => {
    const clock = idleClock();
    renderWithProviders(<Harness />, { screenSaverDeps: clock.deps });
    clock.hide();
    act(() => clock.fireTimer());
    expect(screen.getByText("Idle")).toBeInTheDocument();
    act(() => clock.activity(new Event("visibilitychange")));
    expect(clock.hasTimer()).toBe(false);
    fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Wake this desktop before starting the screen saver.",
    );
  });

  it("stops and stays off while the shutdown screen is up", () => {
    const clock = idleClock();
    renderWithProviders(<Harness />, { screenSaverDeps: clock.deps });
    fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByText("Active")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Shut down"));
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(clock.hasTimer()).toBe(false);
    fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Wake this desktop before starting the screen saver.",
    );
    fireEvent.click(screen.getByText("Wake up"));
    expect(clock.hasTimer()).toBe(true);
  });
});

function Harness() {
  const { snapshot, controls } = useContext(ScreenSaverContext);
  const desktop = useContext(DesktopUiContext);
  const [error, setError] = useState<string | undefined>(undefined);
  const preview = () => {
    try {
      controls.preview();
      setError(undefined);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  };
  return (
    <>
      <span>{snapshot.active ? "Active" : "Idle"}</span>
      {error ? <span role="alert">{error}</span> : null}
      <button
        onClick={() =>
          controls.configure({
            saver: "pipes",
            waitMinutes: 3,
            pipes: { joints: "ball" },
          })
        }
      >
        Configure
      </button>
      <button onClick={() => controls.configure({ saver: "none" })}>
        Disable
      </button>
      <button onClick={preview}>Preview</button>
      <button onClick={() => controls.stop()}>Stop</button>
      <button onClick={() => desktop.setShutdownScreen(true)}>Shut down</button>
      <button onClick={() => desktop.setShutdownScreen(false)}>Wake up</button>
    </>
  );
}

function idleClock() {
  let callback: (() => void) | undefined;
  let activity: (event: Event) => void = () => undefined;
  let delay = 0;
  let visible = true;
  let gameFocused = false;
  let unsubscribed = false;
  const deps: ScreenSaverDeps = {
    setTimeout: (next: () => void, ms: number) => {
      callback = next;
      delay = ms;
      return globalThis.setTimeout(() => undefined, 100_000);
    },
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => {
      callback = undefined;
      globalThis.clearTimeout(handle);
    },
    subscribeActivity: (next: (event: Event) => void) => {
      activity = next;
      return () => {
        unsubscribed = true;
      };
    },
    isVisible: () => visible,
    isGameFocused: () => gameFocused,
    loadPipes: () => new Promise(() => undefined),
  };
  return {
    deps,
    hasTimer: () => callback !== undefined,
    fireTimer: () => {
      const next = callback;
      callback = undefined;
      next?.();
    },
    delay: () => delay,
    activity: (event: Event) => activity(event),
    unsubscribed: () => unsubscribed,
    hide: () => {
      visible = false;
    },
    focusGame: (focused: boolean) => {
      gameFocused = focused;
    },
  };
}
