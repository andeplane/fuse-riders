import type { MapRepository, MapSummary } from "./contracts.js";
import sandboxUrl from "../../maps/sandbox-12.json?url";
import labUrl from "../../maps/combat-lab-12.json?url";
import skirmishUrl from "../../maps/skirmish-24.json?url";

const catalog: MapSummary[] = [
  {
    id: "skirmish-24",
    title: "Synaptic Reach",
    description:
      "A 24 × 20 arena with equal starts and multiple attack routes.",
    width: 24,
    height: 20,
    url: skirmishUrl,
  },
  {
    id: "sandbox-12",
    title: "Slate Basin",
    description: "An open 12 × 12 field for growing your network.",
    width: 12,
    height: 12,
    url: sandboxUrl,
  },
  {
    id: "combat-lab-12",
    title: "The Conduit",
    description: "A contained assay for supply, pressure and a branch cut.",
    width: 12,
    height: 12,
    url: labUrl,
  },
];

export function createBrowserMapRepository(
  fetcher: typeof fetch,
): MapRepository {
  return {
    async list(signal) {
      if (signal.aborted)
        throw new DOMException("Map request cancelled", "AbortError");
      return catalog.map((item) => ({ ...item }));
    },
    async load(id, signal) {
      const entry = catalog.find((item) => item.id === id);
      if (!entry) throw new Error(`Unknown map: ${id}`);
      const response = await fetcher(entry.url, { signal });
      if (!response.ok)
        throw new Error(`Map request failed (${response.status})`);
      const text = await response.text();
      if (text.length > 256 * 1024) throw new Error("Map file exceeds 256 KiB");
      return JSON.parse(text) as unknown;
    },
  };
}

export const browserMapCatalog = catalog;
