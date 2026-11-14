import { act, render, screen } from "@testing-library/react";
import { useContext } from "react";

import type { AppStateDeps } from "./appStateContext";
import { AppStateContext, AppStateDepsContext } from "./appStateContext";
import { AppStateProvider } from "./AppStateProvider";
import { MemoryStateStore } from "./stateStore";
import { activeWindowId } from "./appState";

function Probe() {
  const { state, dispatch } = useContext(AppStateContext);
  return (
    <div>
      <span data-testid="kinds">
        {state.windows.map((window) => window.kind).join(",")}
      </span>
      <button
        onClick={() => dispatch({ type: "open", content: { kind: "paint" } })}
      >
        open
      </button>
    </div>
  );
}

function GameProbe() {
  const { state, dispatch } = useContext(AppStateContext);
  return (
    <>
      <button
        onClick={() =>
          dispatch({
            type: "open",
            content: { kind: "fusegame", gameId: "fuse-birds" },
          })
        }
      >
        birds
      </button>
      <button onClick={() => dispatch({ type: "focus", id: "w1" })}>
        riders
      </button>
      <button
        onClick={() =>
          dispatch({ type: "minimize", id: activeWindowId(state)! })
        }
      >
        minimize
      </button>
      <button
        onClick={() => dispatch({ type: "close", id: activeWindowId(state)! })}
      >
        close
      </button>
    </>
  );
}

/** Timers the test fires by hand. */
function manualDeps(): AppStateDeps & { fire: () => void } {
  const pending: (() => void)[] = [];
  return {
    setTimeout: (callback) => {
      pending.push(callback);
      return globalThis.setTimeout(() => undefined, 0);
    },
    clearTimeout: () => undefined,
    syncDelayMs: 150,
    focusedGame: () => undefined,
    fire: () => pending.splice(0).forEach((callback) => callback()),
  };
}

describe(AppStateProvider.name, () => {
  it("publishes game changes for activation, keyboard focus, minimize and close fallback", () => {
    const focused: string[] = [];
    const deps = {
      ...manualDeps(),
      focusedGame: (gameId: string) => focused.push(gameId),
    };
    render(
      <AppStateDepsContext.Provider value={deps}>
        <AppStateProvider
          store={new MemoryStateStore()}
          initialOpen={[{ kind: "fusegame", gameId: "fuse-riders" }]}
        >
          <GameProbe />
        </AppStateProvider>
      </AppStateDepsContext.Provider>,
    );
    act(() => screen.getByText("birds").click());
    act(() => screen.getByText("riders").click());
    act(() => screen.getByText("minimize").click());
    act(() => screen.getByText("close").click());
    expect(focused).toEqual([
      "fuse-riders",
      "fuse-birds",
      "fuse-riders",
      "fuse-birds",
      "fuseos",
    ]);
  });
  it("seeds from the store and opens the deep link's windows on top, before the first render", () => {
    const store = new MemoryStateStore({
      version: 1,
      windows: [
        { id: "w1", kind: "winamp", minimized: false, maximized: false },
      ],
    });
    render(
      <AppStateProvider
        store={store}
        initialOpen={[{ kind: "fusegame", gameId: "fuseball" }]}
      >
        <Probe />
      </AppStateProvider>,
    );
    expect(screen.getByTestId("kinds")).toHaveTextContent("winamp,fusegame");
  });

  it("saves every change through the debounced timer, once per distinct state", () => {
    const store = new MemoryStateStore();
    const deps = manualDeps();
    render(
      <AppStateDepsContext.Provider value={deps}>
        <AppStateProvider store={store}>
          <Probe />
        </AppStateProvider>
      </AppStateDepsContext.Provider>,
    );
    act(() => deps.fire());
    expect(store.saved).toBe(1);
    act(() => screen.getByText("open").click());
    expect(store.saved).toBe(1);
    act(() => deps.fire());
    expect(store.saved).toBe(2);
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "paint",
    ]);
  });
});
