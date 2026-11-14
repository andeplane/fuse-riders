import { useCallback, useContext, useMemo, useState } from "react";

import { usePlaySystemSound } from "../sounds/useSystemSound";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { DeleteConfirmation } from "./ConfirmDeleteDialog";
import type { RecycleBinItem } from "./recycleBinItems";
import type { RecycleBinColumn, RecycleBinSort } from "./recycleBinSorting";
import {
  DEFAULT_RECYCLE_BIN_SORT,
  sortRecycleBinItems,
  toggleSort,
} from "./recycleBinSorting";
import {
  binContents,
  RecycleBinStoreContext,
  useRecycleBinState,
  withoutItems,
} from "./recycleBinStore";

/** What the pending "Are you sure?" box will do on Yes. */
export type PendingDelete = {
  confirmation: DeleteConfirmation;
  ids: readonly string[];
};

export type RecycleBinViewModel = {
  /** The bin's contents in the current sort order. */
  items: RecycleBinItem[];
  sort: RecycleBinSort;
  sortBy: (column: RecycleBinColumn) => void;
  selected: ReadonlySet<string>;
  /** Click selects only that item; Ctrl+click toggles it within the selection. */
  select: (id: string, toggle?: boolean) => void;
  clearSelection: () => void;
  selectAll: () => void;
  invertSelection: () => void;
  /** Puts the selected files "back": they leave the bin, no questions asked, as Windows did. */
  restoreSelected: () => void;
  /** Deletes the selected files for good, after the confirmation box. */
  deleteSelected: () => void;
  /** Empties the whole bin, after the confirmation box. */
  emptyBin: () => void;
  pendingDelete: PendingDelete | null;
  confirmDelete: () => void;
  cancelDelete: () => void;
  /** Double click: a video opens the media player, anything else cannot be opened from the bin. */
  open: (item: RecycleBinItem) => void;
  /** The status bar: "13 object(s)" and the total size. */
  statusText: string;
  statusDetail: string;
  close: () => void;
};

/** Explorer's status bar total: bytes to the nearest KB, MB or GB. */
export function formatTotalSize(bytes: number): string {
  const KB = 1024;
  if (bytes < KB) return `${bytes} bytes`;
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(1)}KB`;
  if (bytes < KB * KB * KB) return `${(bytes / KB / KB).toFixed(1)}MB`;
  return `${(bytes / KB / KB / KB).toFixed(2)}GB`;
}

export function useRecycleBinViewModel(windowId: string): RecycleBinViewModel {
  const store = useContext(RecycleBinStoreContext);
  const state = useRecycleBinState();
  const commands = useWindowCommands();
  const playSystemSound = usePlaySystemSound();
  const [sort, setSort] = useState(DEFAULT_RECYCLE_BIN_SORT);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );

  const contents = useMemo(() => binContents(state), [state]);
  const items = useMemo(
    () => sortRecycleBinItems(contents, sort),
    [contents, sort],
  );
  // A selection only ever names files still in the bin.
  const liveSelected = useMemo(() => {
    const live = new Set(contents.map((item) => item.id));
    return new Set([...selected].filter((id) => live.has(id)));
  }, [contents, selected]);

  const remove = useCallback(
    (ids: readonly string[]) => {
      store.set(withoutItems(store.get(), ids));
      setSelected(new Set());
    },
    [store],
  );

  const askToDelete = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      const only =
        ids.length === 1
          ? contents.find((item) => item.id === ids[0])
          : undefined;
      setPendingDelete({
        ids,
        confirmation: only
          ? { kind: "one", name: only.name }
          : { kind: "many", count: ids.length },
      });
    },
    [contents],
  );

  const open = useCallback(
    (item: RecycleBinItem) => {
      if (item.open.kind === "video") {
        commands.open({
          kind: "mediaplayer",
          file: item.name,
          launches: item.open.launches,
        });
        return;
      }
      commands.showError(
        "Cannot open file",
        `Cannot open '${item.name}': the file is in the Recycle Bin.\n\nRestore it first, or accept that some things are deleted for a reason.`,
      );
    },
    [commands],
  );

  const totalSize = contents.reduce((sum, item) => sum + item.size, 0);
  const selectedSize = contents
    .filter((item) => liveSelected.has(item.id))
    .reduce((sum, item) => sum + item.size, 0);

  return {
    items,
    sort,
    sortBy: (column) => setSort((current) => toggleSort(current, column)),
    selected: liveSelected,
    select: (id, toggle = false) =>
      setSelected((current) => {
        if (!toggle) return new Set([id]);
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    clearSelection: () => setSelected(new Set()),
    selectAll: () => setSelected(new Set(contents.map((item) => item.id))),
    invertSelection: () =>
      setSelected(
        new Set(
          contents
            .filter((item) => !liveSelected.has(item.id))
            .map((item) => item.id),
        ),
      ),
    restoreSelected: () => {
      if (liveSelected.size > 0) remove([...liveSelected]);
    },
    deleteSelected: () => askToDelete([...liveSelected]),
    emptyBin: () => askToDelete(contents.map((item) => item.id)),
    pendingDelete,
    confirmDelete: () => {
      if (pendingDelete) {
        remove(pendingDelete.ids);
        // The paper crumples once the files are really gone (Control Panel > Sounds, "Empty Recycle Bin").
        playSystemSound("recycle");
      }
      setPendingDelete(null);
    },
    cancelDelete: () => setPendingDelete(null),
    open,
    statusText:
      liveSelected.size > 0
        ? `${liveSelected.size} object(s) selected`
        : `${contents.length} object(s)`,
    statusDetail: formatTotalSize(
      liveSelected.size > 0 ? selectedSize : totalSize,
    ),
    close: () => commands.close(windowId),
  };
}
