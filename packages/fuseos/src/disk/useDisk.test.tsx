import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { createTestDiskDeps } from "../__mocks__/disk";

import type { DiskDeps } from "./diskDepsContext";
import { DiskDepsContext, manifestUrl } from "./diskDepsContext";
import { GitHubDiskSource } from "./diskSource";
import { MemoryFloppyJokeGate } from "./floppy";
import {
  treeFor,
  useDiskDeps,
  useDiskManifest,
  useOverlayPaths,
} from "./useDisk";

function wrapperFor(deps: DiskDeps) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DiskDepsContext.Provider value={deps}>
        {children}
      </DiskDepsContext.Provider>
    );
  };
}

describe(useDiskDeps.name, () => {
  it("returns the injected deps, or the production ones when nothing is provided", () => {
    const deps = createTestDiskDeps();
    expect(
      renderHook(() => useDiskDeps(), { wrapper: wrapperFor(deps) }).result
        .current,
    ).toBe(deps);
    const production = renderHook(() => useDiskDeps()).result.current;
    expect(production.source).toBeInstanceOf(GitHubDiskSource);
    expect(production.jokeGate).toBeInstanceOf(MemoryFloppyJokeGate);
    expect(renderHook(() => useDiskDeps()).result.current).toBe(production);
    expect(manifestUrl("/fuse-riders/")).toBe(
      "/fuse-riders/fuseos/repo-tree.json",
    );
  });
});

describe(useDiskManifest.name, () => {
  it("loads once, builds one tree per manifest and shares it", async () => {
    const deps = createTestDiskDeps();
    const { result } = renderHook(() => useDiskManifest(), {
      wrapper: wrapperFor(deps),
    });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("not ready");
    expect(result.current.tree.fileCount).toBe(9);
    expect(treeFor(result.current.manifest)).toBe(result.current.tree);
  });

  it("reports a failure and retries on request", async () => {
    const deps = createTestDiskDeps({ source: { manifestFailures: 1 } });
    const { result } = renderHook(() => useDiskManifest(), {
      wrapper: wrapperFor(deps),
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({
      message: expect.stringContaining("503"),
    });
    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});

describe(useOverlayPaths.name, () => {
  it("starts from what is saved and follows writes and removes", async () => {
    const deps = createTestDiskDeps({ overlay: { "b.txt": "B" } });
    const { result, unmount } = renderHook(() => useOverlayPaths(deps.overlay));
    await waitFor(() => expect([...result.current]).toEqual(["b.txt"]));
    await act(async () => {
      await deps.overlay.write("a.txt", "A");
    });
    expect([...result.current].sort()).toEqual(["a.txt", "b.txt"]);
    await act(async () => {
      await deps.overlay.remove("b.txt");
    });
    expect([...result.current]).toEqual(["a.txt"]);
    unmount();
    await deps.overlay.write("c.txt", "C");
    expect([...result.current]).toEqual(["a.txt"]);
  });
});
