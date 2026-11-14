import { act, renderHook } from "@testing-library/react";

import { createWrapper } from "../../__mocks__/renderWithProviders";
import { DEFAULT_STATE } from "../../state/appState";

import { MemoryDialUpSession } from "./dialUpSession";
import { needsDialUp, useDialUpCommands } from "./useDialUpCommands";

describe(needsDialUp.name, () => {
  it("is true for the programs that need the network, and for nothing else", () => {
    expect(needsDialUp({ kind: "network" })).toBe(true);
    expect(needsDialUp({ kind: "friends" })).toBe(true);
    expect(needsDialUp({ kind: "paint" })).toBe(false);
    expect(needsDialUp({ kind: "dialup" })).toBe(false);
  });
});

describe(useDialUpCommands.name, () => {
  it("puts the dialog in front of an online program while offline, and leaves the rest alone", () => {
    const { Wrapper, store } = createWrapper();
    const { result } = renderHook(() => useDialUpCommands(), {
      wrapper: Wrapper,
    });
    act(() => result.current.open({ kind: "paint" }));
    act(() => result.current.open({ kind: "friends" }, { id: "friends" }));
    expect(store.load().windows).toEqual([
      expect.objectContaining({ kind: "paint", id: "w1" }),
      expect.objectContaining({
        kind: "dialup",
        id: "w2",
        then: { kind: "friends" },
      }),
    ]);
  });

  it("opens straight away once the session has connected, under the id asked for", () => {
    const dialUpSession = new MemoryDialUpSession();
    dialUpSession.markConnected();
    const { Wrapper, store } = createWrapper({ dialUpSession });
    const { result } = renderHook(() => useDialUpCommands(), {
      wrapper: Wrapper,
    });
    act(() => result.current.open({ kind: "network" }, { id: "net" }));
    expect(store.load().windows).toEqual([
      expect.objectContaining({ kind: "network", id: "net" }),
    ]);
  });

  it("only focuses a window of the program that is already open, a restored one say", () => {
    const { Wrapper, store } = createWrapper({
      initialState: {
        ...DEFAULT_STATE,
        windows: [
          { id: "w1", kind: "network", minimized: true, maximized: false },
        ],
      },
    });
    const { result } = renderHook(() => useDialUpCommands(), {
      wrapper: Wrapper,
    });
    act(() => result.current.open({ kind: "network" }));
    expect(store.load().windows).toEqual([
      { id: "w1", kind: "network", minimized: false, maximized: false },
    ]);
  });
});
