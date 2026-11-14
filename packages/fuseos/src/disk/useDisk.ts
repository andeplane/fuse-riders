import { useContext, useEffect, useState } from "react";

import type { DiskDeps } from "./diskDepsContext";
import { defaultDiskDeps, DiskDepsContext } from "./diskDepsContext";
import type { DiskOverlay } from "./diskOverlay";
import type { RepoManifest } from "./repoTree";
import { RepoTree } from "./repoTree";

export function useDiskDeps(): DiskDeps {
  return useContext(DiskDepsContext) ?? defaultDiskDeps();
}

export type ManifestState =
  | { status: "loading" }
  | { status: "ready"; manifest: RepoManifest; tree: RepoTree }
  | { status: "error"; message: string };

const trees = new WeakMap<RepoManifest, RepoTree>();

/** One tree per manifest object, shared by every window that reads the same source. */
export function treeFor(manifest: RepoManifest): RepoTree {
  let tree = trees.get(manifest);
  if (!tree) {
    tree = new RepoTree(manifest.files);
    trees.set(manifest, tree);
  }
  return tree;
}

/** The C: drive's manifest for this window; `retry` asks the source again after a failure. */
export function useDiskManifest(): ManifestState & { retry: () => void } {
  const { source } = useDiskDeps();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ManifestState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    source.manifest().then(
      (manifest) => {
        if (!cancelled)
          setState({ status: "ready", manifest, tree: treeFor(manifest) });
      },
      (error: unknown) => {
        if (!cancelled)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "The drive is not ready.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, attempt]);

  return { ...state, retry: () => setAttempt((count) => count + 1) };
}

/** Every path with a saved copy in the overlay, kept current as any window saves or reverts. */
export function useOverlayPaths(overlay: DiskOverlay): ReadonlySet<string> {
  const [paths, setPaths] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    void overlay.list().then((list) => {
      if (!cancelled) setPaths(new Set(list));
    });
    const unsubscribe = overlay.subscribe((change) => {
      setPaths((current) => {
        const next = new Set(current);
        if (change.content === undefined) next.delete(change.path);
        else next.add(change.path);
        return next;
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [overlay]);
  return paths;
}
