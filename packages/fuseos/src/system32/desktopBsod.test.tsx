import { act, render, renderHook, screen } from "@testing-library/react";
import { createContext, useContext } from "react";

import type { BsodModule, ShowBsod } from "./desktopBsod";
import {
  createUseDesktopBsod,
  desktopBsodModule,
  pickBsodModule,
  useDesktopBsod,
} from "./desktopBsod";
import { MemoryScheduler, System32DepsContext } from "./system32Deps";
import { System32BsodProvider } from "./System32BsodProvider";
import { useSystem32 } from "./System32Provider";

type Controls = { showBsod: ShowBsod };

/** A stand-in for D1's bsodContext module: a context whose default does nothing. */
function fakeBsodModule() {
  const NO_BSOD: Controls = { showBsod: () => undefined };
  const Context = createContext<Controls>(NO_BSOD);
  const module: BsodModule = {
    NO_BSOD,
    useBsod: () => useContext(Context),
  };
  return { module, Context, NO_BSOD };
}

describe("pickBsodModule", () => {
  it("finds D1's module by shape and ignores anything else", () => {
    const { module } = fakeBsodModule();
    expect(pickBsodModule({})).toBeUndefined();
    expect(
      pickBsodModule({
        "../bsod/bsodContext.ts": { useBsod: "no" },
        other: null,
        half: { useBsod: () => undefined, NO_BSOD: {} },
      }),
    ).toBeUndefined();
    expect(pickBsodModule({ "../bsod/bsodContext.ts": module })).toBe(module);
  });
});

describe("createUseDesktopBsod", () => {
  it("has no screen without D1", () => {
    const { result } = renderHook(createUseDesktopBsod(undefined));
    expect(result.current).toBeUndefined();
  });

  it("has no screen when D1 is there but no provider is above", () => {
    const { module } = fakeBsodModule();
    const { result } = renderHook(createUseDesktopBsod(module));
    expect(result.current).toBeUndefined();
  });

  it("hands out the provider's showBsod", () => {
    const { module, Context } = fakeBsodModule();
    const showBsod = vi.fn<ShowBsod>();
    const { result } = renderHook(createUseDesktopBsod(module), {
      wrapper: ({ children }) => (
        <Context.Provider value={{ showBsod }}>{children}</Context.Provider>
      ),
    });
    expect(result.current).toBe(showBsod);
  });

  it("is wired to this build's module, which may or may not carry D1", () => {
    const { result } = renderHook(() => useDesktopBsod());
    // Outside any BsodProvider there is never a screen, with or without D1.
    expect(result.current).toBeUndefined();
    expect(
      desktopBsodModule === undefined ||
        typeof desktopBsodModule.useBsod === "function",
    ).toBe(true);
  });
});

function Crash() {
  const { state } = useSystem32();
  return <span data-testid="phase">{state.phase}</span>;
}

describe("System32BsodProvider", () => {
  it("falls back to the gag's own blue screen where the desktop has none", () => {
    const scheduler = new MemoryScheduler();
    render(
      <System32DepsContext.Provider
        value={{ scheduler, demo: { kind: "bsod" } }}
      >
        <System32BsodProvider>
          <Crash />
        </System32BsodProvider>
      </System32DepsContext.Provider>,
    );
    expect(screen.getByTestId("phase")).toHaveTextContent("crashed");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("keeps a showBsod the deps already carry", () => {
    const scheduler = new MemoryScheduler();
    const showBsod = vi.fn<ShowBsod>(() => undefined);
    render(
      <System32DepsContext.Provider
        value={{ scheduler, showBsod, demo: { kind: "bsod" } }}
      >
        <System32BsodProvider>
          <Crash />
        </System32BsodProvider>
      </System32DepsContext.Provider>,
    );
    expect(showBsod).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    act(() => scheduler.advance(60_000));
  });
});
