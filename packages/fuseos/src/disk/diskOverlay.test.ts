import { IDBFactory } from "fake-indexeddb";

import type { DiskOverlay, OverlayChange } from "./diskOverlay";
import {
  IndexedDbDiskOverlay,
  MemoryDiskOverlay,
  OVERLAY_DB_NAME,
} from "./diskOverlay";

/** An IndexedDB a browser refuses to open (private mode, a blocked origin). */
class BlockedFactory implements IDBFactory {
  open(): IDBOpenDBRequest {
    throw new Error("blocked");
  }

  deleteDatabase(): IDBOpenDBRequest {
    throw new Error("blocked");
  }

  cmp(): number {
    return 0;
  }

  databases(): Promise<IDBDatabaseInfo[]> {
    return Promise.resolve([]);
  }
}

function contract(name: string, create: () => DiskOverlay) {
  describe(name, () => {
    it("starts empty, writes, reads back, lists sorted and removes", async () => {
      const overlay = create();
      await expect(overlay.list()).resolves.toEqual([]);
      await expect(overlay.read("b.txt")).resolves.toBeUndefined();
      await overlay.write("b.txt", "bee");
      await overlay.write("a.txt", "ay");
      await expect(overlay.read("b.txt")).resolves.toBe("bee");
      await expect(overlay.list()).resolves.toEqual(["a.txt", "b.txt"]);
      await overlay.write("b.txt", "bee 2");
      await expect(overlay.read("b.txt")).resolves.toBe("bee 2");
      await overlay.remove("b.txt");
      await expect(overlay.read("b.txt")).resolves.toBeUndefined();
      await expect(overlay.list()).resolves.toEqual(["a.txt"]);
      await overlay.remove("never-there");
      await expect(overlay.list()).resolves.toEqual(["a.txt"]);
    });

    it("tells subscribers about every write and remove until they unsubscribe", async () => {
      const overlay = create();
      const seen: OverlayChange[] = [];
      const unsubscribe = overlay.subscribe((change) => seen.push(change));
      await overlay.write("x", "1");
      await overlay.remove("x");
      unsubscribe();
      await overlay.write("y", "2");
      expect(seen).toEqual([
        { path: "x", content: "1" },
        { path: "x", content: undefined },
      ]);
    });
  });
}

contract(MemoryDiskOverlay.name, () => new MemoryDiskOverlay());
contract(
  IndexedDbDiskOverlay.name,
  () => new IndexedDbDiskOverlay(new IDBFactory()),
);

describe(MemoryDiskOverlay.name, () => {
  it("can start with saved files", async () => {
    const overlay = new MemoryDiskOverlay({ "a.txt": "A" });
    await expect(overlay.list()).resolves.toEqual(["a.txt"]);
    await expect(overlay.read("a.txt")).resolves.toBe("A");
  });
});

describe(IndexedDbDiskOverlay.name, () => {
  it("persists across instances over the same database", async () => {
    const factory = new IDBFactory();
    await new IndexedDbDiskOverlay(factory).write("kept.txt", "still here");
    const again = new IndexedDbDiskOverlay(factory);
    await expect(again.read("kept.txt")).resolves.toBe("still here");
    await expect(again.list()).resolves.toEqual(["kept.txt"]);
  });

  it("ignores rows that are not text and reports a database that will not open", async () => {
    const factory = new IDBFactory();
    const overlay = new IndexedDbDiskOverlay(factory);
    await overlay.write("ok.txt", "fine");
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(OVERLAY_DB_NAME, 1);
      request.onsuccess = () => {
        const store = request.result
          .transaction("files", "readwrite")
          .objectStore("files");
        store.put({ path: "odd.bin", content: 42 });
        store.transaction.oncomplete = () => {
          request.result.close();
          resolve();
        };
        store.transaction.onerror = () => reject(new Error("put failed"));
      };
      request.onerror = () => reject(new Error("open failed"));
    });
    await expect(overlay.read("odd.bin")).resolves.toBeUndefined();
    await expect(overlay.read("ok.txt")).resolves.toBe("fine");

    await expect(
      new IndexedDbDiskOverlay(new BlockedFactory()).list(),
    ).rejects.toThrow("blocked");
  });
});
