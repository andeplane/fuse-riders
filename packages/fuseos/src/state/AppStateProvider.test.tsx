import { act, render, screen } from "@testing-library/react";
import { useContext } from "react";

import type { AppStateDeps } from "./appStateContext";
import { AppStateContext, AppStateDepsContext } from "./appStateContext";
import { AppStateProvider } from "./AppStateProvider";
import { MemoryStateStore } from "./stateStore";

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
    fire: () => pending.splice(0).forEach((callback) => callback()),
  };
}

describe(AppStateProvider.name, () => {
  it("seeds from the store and opens the deep link's windows on top, before the first render", () => {
    const store = new MemoryStateStore({
      version: 1,
      windows: [{ id: "w1", kind: "winamp", minimized: false, maximized: false }],
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
    expect(store.load().windows.map((window) => window.kind)).toEqual(["paint"]);
  });
});
