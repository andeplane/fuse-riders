import type { DiskDeps } from "../disk/diskDepsContext";
import type { DiskEntry, ListingInputs } from "../disk/diskEntries";
import { listEntries, locationExists } from "../disk/diskEntries";
import { driveOf, MY_COMPUTER, parentOf } from "../disk/diskPath";
import { treeFor } from "../disk/useDisk";

import type { DiskNode, DiskPort } from "./agentOs";

function sameName(entry: DiskEntry, location: string): boolean {
  return entry.location.toLowerCase() === location.toLowerCase();
}

/**
 * The drives as Explorer lists them, without a window: C: from the build's manifest (fetched on first use and
 * shared with every Explorer window), A: from the floppy's fixed contents. A file is found whatever the case
 * of its name, since a model rarely remembers that it is README.md and not readme.md.
 */
export function createDiskPort(
  deps: Pick<DiskDeps, "source" | "overlay">,
): DiskPort {
  const inputs = async (location: string): Promise<ListingInputs> => {
    const overlayPaths = new Set(await deps.overlay.list());
    // My Computer and the floppy need no manifest, so they list even when GitHub cannot be reached.
    if (driveOf(location) !== "C")
      return { tree: undefined, committedAt: "", overlayPaths };
    const manifest = await deps.source.manifest();
    return {
      tree: treeFor(manifest),
      committedAt: manifest.committedAt,
      overlayPaths,
    };
  };
  return {
    async stat(location): Promise<DiskNode> {
      const listing = await inputs(location);
      if (locationExists(location, listing.tree))
        return { kind: "folder", entries: listEntries(location, listing) };
      const parent = parentOf(location);
      if (parent === undefined || parent === MY_COMPUTER) return undefined;
      const entry = listEntries(parent, listing).find(
        (candidate) =>
          candidate.kind === "file" && sameName(candidate, location),
      );
      return entry ? { kind: "file", entry } : undefined;
    },
  };
}
