import { act, renderHook, screen } from "@testing-library/react";

import { createWrapper } from "../__mocks__/renderWithProviders";
import { useAgentTools } from "../agenttools/useAgentTools";

import { runNotFoundMessage } from "./runCommand";
import { RUN_EMPTY_MESSAGE } from "./useRunExecutor";

/** Clippy's agent on the test desktop: the Shell mounts `RunAgentProvider`, so the `run` tool is there. */
function renderAgent() {
  const context = createWrapper();
  const hook = renderHook(() => useAgentTools(), {
    wrapper: context.Wrapper,
  });
  const run = (command: string) => {
    const port = hook.result.current.os.run;
    if (!port) throw new Error("no run port");
    let result: unknown;
    act(() => {
      result = port.run(command);
    });
    return result;
  };
  return { ...context, ...hook, run };
}

describe("RunAgentProvider", () => {
  it("gives Clippy a run tool backed by Start > Run...'s own command runner", () => {
    const { result } = renderAgent();
    expect(result.current.os.run).toBeDefined();
    expect(result.current.tools.map((tool) => tool.name)).toContain("run");
  });

  it("keeps one port while the desktop changes, so Clippy's tools and conversation survive", () => {
    const { result, run } = renderAgent();
    const port = result.current.os.run;
    run("winamp");
    expect(result.current.os.run).toBe(port);
  });

  it("runs programs, games and web addresses, and answers the way the dialog would", () => {
    const { run, store, desktopDeps, osAnalytics } = renderAgent();
    expect(run("winamp")).toEqual({ ok: true, message: "Ran winamp" });
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "winamp",
    ]);
    expect(run("fuseball")).toEqual({ ok: true, message: "Started fuseball" });
    expect(osAnalytics.launches).toEqual([
      { game: "fuseball", launch: "window" },
    ]);
    expect(run("https://fusegames.ai/")).toEqual({
      ok: true,
      message: "Opened https://fusegames.ai/ in a new tab",
    });
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "https://fusegames.ai/",
    );
    expect(run("quake")).toEqual({
      ok: false,
      message: runNotFoundMessage("quake"),
    });
    expect(run("  ")).toEqual({ ok: false, message: RUN_EMPTY_MESSAGE });
  });

  it("dials in for Network Neighborhood and raises a blue screen for bsod", () => {
    const { run, store } = renderAgent();
    expect(run("network")).toEqual({ ok: true, message: "Ran network" });
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "dialup",
    ]);
    expect(run("bsod")).toEqual({
      ok: true,
      message: "Raised the Blue Screen of Death",
    });
    // The desktop's own blue screen (`src/bsod`), not the SYSTEM32 gag's: nothing folds.
    expect(
      screen.getByRole("alertdialog", { name: "Windows fatal exception" }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-system32]")).toHaveAttribute(
      "data-system32",
      "idle",
    );
  });
});
