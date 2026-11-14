import type { KeyboardEvent } from "react";
import { useCallback, useContext, useMemo, useRef, useState } from "react";

import { StartMenuRegistryContext } from "../desktop/startMenuRegistry";
import type { DiskEntry } from "../disk/diskEntries";
import { SYSTEM32_LOCATION } from "../disk/diskEntries";
import { driveOf, MY_COMPUTER, nameOf } from "../disk/diskPath";
import { formatSize } from "../disk/fileTypes";
import { ACCESS_DENIED_MESSAGE, WINZIP_ERROR_MESSAGE } from "../disk/floppy";
import { useDiskDeps, useDiskManifest, useOverlayPaths } from "../disk/useDisk";
import { matchShortcut } from "../lib/shortcuts";
import { useOpenInNotepad } from "../notepadpp/useOpenInNotepad";
import { usePlaySystemSound } from "../sounds/useSystemSound";
import { useAppState } from "../state/useAppState";
import { useSystem32Folder } from "../system32/explorerContract";
import type { IconName } from "../ui/icons";
import type { MenuPosition } from "../windows/menuPosition";
import { useWindowCommands } from "../windows/useWindowCommands";
import { WindowManagerContext } from "../windows/windowManagerContext";

import type { AddressPlace } from "./AddressBar";
import { decideOpen } from "./openEntry";
import {
  explorerTitle,
  findShellFolder,
  isVirtualFolder,
  listNamespace,
  namespaceAddress,
  namespaceAncestors,
  namespaceExists,
  namespaceIcon,
  namespaceName,
  namespaceParent,
  parseNamespaceAddress,
  shellFolders,
  SYSTEM_FOLDER_TYPE,
} from "./shellNamespace";
import type { SortColumn, SortSpec } from "./sorting";
import {
  DEFAULT_SORT,
  formatModified,
  sortEntries,
  toggleSort,
} from "./sorting";

export type ExplorerViewMode = "large" | "small" | "list" | "details";

/** View > Large Icons, Small Icons, List, Details: the order the Views button steps through. */
export const VIEW_MODES: readonly { mode: ExplorerViewMode; label: string }[] =
  [
    { mode: "large", label: "Large Icons" },
    { mode: "small", label: "Small Icons" },
    { mode: "list", label: "List" },
    { mode: "details", label: "Details" },
  ];

/** The All Folders pane as Explorer first opens it: a third of a 640px screen. */
export const DEFAULT_FOLDERS_WIDTH = 196;

const NEXT_VIEW_MODE: Record<ExplorerViewMode, ExplorerViewMode> = {
  large: "small",
  small: "list",
  list: "details",
  details: "large",
};

/** One step of the Back or Forward button's drop-down. */
export type HistoryStep = { label: string; onSelect: () => void };

export type ExplorerContextMenu = {
  entry: DiskEntry | undefined;
  position: MenuPosition;
};

export type ExplorerViewModel = {
  location: string;
  address: string;
  addressIcon: IconName;
  title: string;
  entries: DiskEntry[];
  /** The listing is not ready: the manifest is loading, or A: is seeking. */
  busy: string | undefined;
  /** The manifest could not be read; `retry` asks again. */
  error: string | undefined;
  retry: () => void;
  selected: DiskEntry | undefined;
  select: (entry: DiskEntry | undefined) => void;
  open: (entry: DiskEntry) => void;
  openAddress: (text: string) => void;
  navigate: (location: string) => void;
  /** A click in the folder tree: go there, or run the program a system folder stands for. */
  activate: (entry: DiskEntry) => void;
  back: () => void;
  forward: () => void;
  up: () => void;
  /** Where Back and Forward would go, nearest first, for their drop-downs. */
  backSteps: HistoryStep[];
  forwardSteps: HistoryStep[];
  /** The Address drop-down: the Desktop, My Computer, the drives and the way down to this folder. */
  places: AddressPlace[];
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  viewMode: ExplorerViewMode;
  setViewMode: (mode: ExplorerViewMode) => void;
  /** The Views button itself: the next view in the list. */
  cycleViewMode: () => void;
  sort: SortSpec;
  sortBy: (column: SortColumn) => void;
  foldersPane: boolean;
  toggleFoldersPane: () => void;
  foldersWidth: number;
  setFoldersWidth: (width: number) => void;
  expanded: ReadonlySet<string>;
  toggleExpanded: (location: string) => void;
  /** Folders and drives under a location, for the tree. */
  childrenOf: (location: string) => DiskEntry[];
  contextMenu: ExplorerContextMenu | undefined;
  openContextMenu: (
    entry: DiskEntry | undefined,
    position: MenuPosition,
  ) => void;
  closeContextMenu: () => void;
  winzip: boolean;
  winzipFailed: () => void;
  winzipCancel: () => void;
  /** File > Revert to original on a modified file. */
  revert: (entry: DiskEntry) => void;
  /** Delete: a saved copy goes back to the original; anything else is on a read-only disk. */
  deleteEntry: (entry: DiskEntry) => void;
  /** Properties of an entry, or of this folder when there is none. */
  showProperties: (entry: DiskEntry | undefined) => void;
  /** Status bar fields. */
  statusText: string;
  statusSize: string;
  statusZone: string;
  statusZoneIcon: IconName;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  close: () => void;
};

export const ADDRESS_NOT_FOUND_TITLE = "Explorer";

export function addressNotFoundMessage(text: string): string {
  return `Cannot find '${text}'. Make sure the path is correct and try again.`;
}

export const DELETE_ERROR_TITLE = "Error Deleting File";

export function deleteDeniedMessage(name: string): string {
  return `Cannot delete ${name}: Access is denied.\n\nMake sure the disk is not full or write-protected and that the file is not currently in use.`;
}

/** The text of the Properties box: what the Details columns say about one entry. */
export function propertiesMessage(entry: DiskEntry, address: string): string {
  return [
    `Type: ${entry.typeLabel}`,
    `Location: ${address}`,
    ...(entry.size === undefined ? [] : [`Size: ${formatSize(entry.size)}`]),
    ...(entry.modifiedAt === undefined
      ? []
      : [`Modified: ${formatModified(entry.modifiedAt)}`]),
    ...(entry.modified ? ["Attributes: Saved copy on this computer"] : []),
  ].join("\n");
}

export function useExplorerViewModel(
  windowId: string,
  location: string,
): ExplorerViewModel {
  const { dispatch } = useAppState();
  const commands = useWindowCommands();
  const deps = useDiskDeps();
  const manifest = useDiskManifest();
  const overlayPaths = useOverlayPaths(deps.overlay);
  const openInNotepad = useOpenInNotepad();
  const registrations = useContext(StartMenuRegistryContext);
  const { viewport } = useContext(WindowManagerContext);
  const folders = useMemo(() => shellFolders(registrations), [registrations]);

  const [history, setHistory] = useState<{ back: string[]; forward: string[] }>(
    { back: [], forward: [] },
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ExplorerViewMode>("list");
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  const [foldersPane, setFoldersPane] = useState(true);
  const [foldersWidth, setFoldersWidth] = useState(DEFAULT_FOLDERS_WIDTH);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set([MY_COMPUTER]),
  );
  const [contextMenu, setContextMenu] = useState<
    ExplorerContextMenu | undefined
  >(undefined);
  const [winzip, setWinzip] = useState(false);
  // The floppy seeks when A: is entered from another drive; a subfolder of A: is already spinning.
  const [seeking, setSeeking] = useState(false);
  const seekToken = useRef(0);

  const tree = manifest.status === "ready" ? manifest.tree : undefined;
  const committedAt =
    manifest.status === "ready" ? manifest.manifest.committedAt : "";
  // C:\WINDOWS\SYSTEM32 is listed until the delete-SYSTEM32 gag takes it away (docs/fuseos/system32.md).
  const system32 = useSystem32Folder();
  const system32Present = system32.present;
  const playSystemSound = usePlaySystemSound();
  const listingInputs = useMemo(
    () => ({ tree, committedAt, overlayPaths, system32Present }),
    [tree, committedAt, overlayPaths, system32Present],
  );

  const entries = useMemo(() => {
    const listed = listNamespace(location, listingInputs, folders);
    // The Desktop and My Computer keep Windows' own order until a column is clicked.
    return isVirtualFolder(location) && sort === DEFAULT_SORT
      ? listed
      : sortEntries(listed, sort);
  }, [location, listingInputs, folders, sort]);
  const childrenOf = useCallback(
    (parent: string) =>
      listNamespace(parent, listingInputs, folders).filter(
        (entry) => entry.kind !== "file",
      ),
    [listingInputs, folders],
  );

  const setLocation = useCallback(
    (next: string) =>
      dispatch({
        type: "patch",
        id: windowId,
        patch: (window) =>
          window.kind === "explorer" ? { ...window, location: next } : window,
      }),
    [dispatch, windowId],
  );

  const go = useCallback(
    (next: string, record: boolean) => {
      if (next === location) return;
      if (record)
        setHistory((current) => ({
          back: [...current.back, location],
          forward: [],
        }));
      setSelected(null);
      setLocation(next);
      // The tree opens down to the folder being shown, as Explorer's does.
      setExpanded((current) => {
        const above = namespaceAncestors(next).slice(0, -1);
        if (above.every((ancestor) => current.has(ancestor))) return current;
        return new Set([...current, ...above]);
      });
      if (driveOf(next) === "A" && driveOf(location) !== "A") {
        // The drive spins up and seeks (Control Panel > Sounds, "Floppy drive") while the listing waits.
        playSystemSound("floppy");
        const token = (seekToken.current += 1);
        setSeeking(true);
        void deps.floppySeek().finally(() => {
          if (seekToken.current === token) setSeeking(false);
        });
      } else if (driveOf(next) !== undefined) {
        // Any other folder or drive: one short head seek. The Desktop and My Computer are not on a disk.
        playSystemSound("seek");
      }
    },
    [location, setLocation, deps, playSystemSound],
  );

  const navigate = useCallback((next: string) => go(next, true), [go]);

  /** Moves `steps` places through the history: negative is Back, positive is Forward. */
  const travel = useCallback(
    (steps: number) => {
      const trail = [...history.back, location, ...history.forward];
      const index = history.back.length + steps;
      const target = trail[index];
      if (target === undefined) return;
      setHistory({
        back: trail.slice(0, index),
        forward: trail.slice(index + 1),
      });
      go(target, false);
    },
    [history, location, go],
  );
  const back = useCallback(() => travel(-1), [travel]);
  const forward = useCallback(() => travel(1), [travel]);

  const parent = namespaceParent(location);
  const up = useCallback(() => {
    if (parent !== undefined) navigate(parent);
  }, [parent, navigate]);

  const openAddress = useCallback(
    (text: string) => {
      const parsed = parseNamespaceAddress(text);
      if (
        parsed !== undefined &&
        namespaceExists(parsed, tree, system32Present)
      )
        navigate(parsed);
      else
        commands.showError(
          ADDRESS_NOT_FOUND_TITLE,
          addressNotFoundMessage(text.trim()),
        );
    },
    [tree, system32Present, navigate, commands],
  );

  const open = useCallback(
    (entry: DiskEntry) => {
      const shellFolder = findShellFolder(entry.location, folders);
      if (shellFolder) {
        shellFolder.open(commands, viewport);
        return;
      }
      const decision = decideOpen(entry);
      switch (decision.type) {
        case "navigate":
          navigate(decision.location);
          return;
        case "jokeFolder":
          if (deps.jokeGate.tryOpen() === "denied")
            commands.showError(
              nameOf(decision.location),
              ACCESS_DENIED_MESSAGE,
            );
          else navigate(decision.location);
          return;
        case "winzip":
          setWinzip(true);
          return;
        case "notepad":
          openInNotepad(decision.path);
          return;
        case "image": {
          // Paint fetches the picture by URL and shows it read-only (Save downloads a copy).
          const fileName = decision.path.slice(
            decision.path.lastIndexOf("/") + 1,
          );
          void deps.source.imageUrl(decision.path).then(
            (sourceUrl) =>
              commands.open({ kind: "paint", fileName, sourceUrl }),
            (error: unknown) =>
              commands.showError(
                "Paint",
                `Paint cannot open ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
              ),
          );
          return;
        }
        case "error":
          commands.showError(decision.title, decision.message);
          return;
      }
    },
    [
      navigate,
      deps.jokeGate,
      deps.source,
      commands,
      openInNotepad,
      folders,
      viewport,
    ],
  );

  const activate = useCallback(
    (entry: DiskEntry) => {
      const shellFolder = findShellFolder(entry.location, folders);
      if (shellFolder) shellFolder.open(commands, viewport);
      else navigate(entry.location);
    },
    [folders, commands, viewport, navigate],
  );

  const winzipFailed = useCallback(() => {
    setWinzip(false);
    commands.showError("WinZip", WINZIP_ERROR_MESSAGE);
  }, [commands]);

  const revert = useCallback(
    (entry: DiskEntry) => {
      if (driveOf(entry.location) === "C")
        void deps.overlay.remove(entry.location.slice(3));
      else void deps.overlay.remove(entry.location);
    },
    [deps.overlay],
  );

  const selectedEntry = entries.find((entry) => entry.location === selected);

  const removeSystem32 = system32.remove;
  const deleteEntry = useCallback(
    (entry: DiskEntry) => {
      // The one folder that can go: the gag asks its own three questions, so nothing is asked here.
      if (entry.location === SYSTEM32_LOCATION) removeSystem32();
      else if (entry.modified) revert(entry);
      else
        commands.showError(DELETE_ERROR_TITLE, deleteDeniedMessage(entry.name));
    },
    [removeSystem32, revert, commands],
  );

  const showProperties = useCallback(
    (entry: DiskEntry | undefined) => {
      const where = namespaceAddress(location);
      if (entry) {
        commands.showInfo(
          `${entry.name} Properties`,
          propertiesMessage(entry, where),
        );
        return;
      }
      const type = isVirtualFolder(location)
        ? SYSTEM_FOLDER_TYPE
        : parent === MY_COMPUTER
          ? "Drive"
          : "File Folder";
      commands.showInfo(
        `${namespaceName(location)} Properties`,
        `Type: ${type}\nLocation: ${where}\nContains: ${entries.length} object(s)`,
      );
    },
    [commands, location, parent, entries.length],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (matchShortcut(event, "explorer.up")) {
        event.preventDefault();
        up();
      } else if (matchShortcut(event, "explorer.properties")) {
        event.preventDefault();
        showProperties(selectedEntry);
      } else if (matchShortcut(event, "explorer.open")) {
        if (selectedEntry) {
          event.preventDefault();
          open(selectedEntry);
        }
      } else if (matchShortcut(event, "explorer.delete")) {
        if (selectedEntry) {
          event.preventDefault();
          deleteEntry(selectedEntry);
        }
      } else if (matchShortcut(event, "explorer.clearSelection")) {
        setSelected(null);
      } else if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowLeft"
      ) {
        // explorer.moveSelection: one branching handler for all four arrows (see lib/shortcuts.ts).
        event.preventDefault();
        const forwardKey =
          event.key === "ArrowDown" || event.key === "ArrowRight";
        const index = entries.findIndex((entry) => entry.location === selected);
        const next =
          index < 0
            ? entries[forwardKey ? 0 : entries.length - 1]
            : entries[
                Math.max(
                  0,
                  Math.min(entries.length - 1, index + (forwardKey ? 1 : -1)),
                )
              ];
        if (next) setSelected(next.location);
      }
    },
    [up, open, showProperties, deleteEntry, selectedEntry, entries, selected],
  );

  const busy =
    manifest.status === "loading" && driveOf(location) === "C"
      ? "Reading drive C:..."
      : seeking
        ? "Reading drive A:..."
        : undefined;
  const error =
    manifest.status === "error" && driveOf(location) === "C"
      ? manifest.message
      : undefined;

  const shown = busy || error ? [] : entries;
  const statusText =
    busy ??
    (selectedEntry ? "1 object(s) selected" : `${shown.length} object(s)`);
  // The middle panel: the selection's size, or the files of the folder added up.
  const sizes = (selectedEntry ? [selectedEntry] : shown).flatMap((entry) =>
    entry.size === undefined ? [] : [entry.size],
  );
  const statusSize =
    sizes.length === 0
      ? ""
      : formatSize(sizes.reduce((total, size) => total + size, 0));
  // The zone, as Windows calls it: C: is a copy of the repository at one commit, the rest is this computer.
  const fromRepository =
    manifest.status === "ready" && driveOf(location) === "C";
  const statusZone = fromRepository
    ? `${manifest.manifest.repo} @ ${manifest.manifest.sha.slice(0, 7)}`
    : "My Computer";

  const stepsFrom = (trail: readonly string[], direction: 1 | -1) =>
    trail.map((place, index) => ({
      label: namespaceName(place),
      onSelect: () => travel(direction * (index + 1)),
    }));
  const backSteps = stepsFrom([...history.back].reverse(), -1);
  const forwardSteps = stepsFrom(history.forward, 1);

  // The way down to this folder, then the other places directly under My Computer.
  const trail = namespaceAncestors(location);
  const places: AddressPlace[] = [
    ...trail,
    ...childrenOf(MY_COMPUTER)
      .map((entry) => entry.location)
      .filter(
        (place) =>
          !trail.includes(place) &&
          findShellFolder(place, folders) === undefined,
      ),
  ].map((place) => ({
    label: namespaceName(place),
    onSelect: () => navigate(place),
  }));

  return {
    location,
    address: namespaceAddress(location),
    addressIcon: namespaceIcon(location),
    title: explorerTitle(location),
    entries: shown,
    busy,
    error,
    retry: manifest.retry,
    selected: selectedEntry,
    select: (entry) => setSelected(entry?.location ?? null),
    open,
    openAddress,
    navigate,
    activate,
    back,
    forward,
    up,
    backSteps,
    forwardSteps,
    places,
    canBack: history.back.length > 0,
    canForward: history.forward.length > 0,
    canUp: parent !== undefined,
    viewMode,
    setViewMode,
    cycleViewMode: () => setViewMode((current) => NEXT_VIEW_MODE[current]),
    sort,
    sortBy: (column) => setSort((current) => toggleSort(current, column)),
    foldersPane,
    toggleFoldersPane: () => setFoldersPane((open) => !open),
    foldersWidth,
    setFoldersWidth,
    expanded,
    toggleExpanded: (target) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(target)) next.delete(target);
        else next.add(target);
        return next;
      }),
    childrenOf,
    contextMenu,
    openContextMenu: (entry, position) => {
      if (entry) setSelected(entry.location);
      setContextMenu({ entry, position });
    },
    closeContextMenu: () => setContextMenu(undefined),
    winzip,
    winzipFailed,
    winzipCancel: () => setWinzip(false),
    revert,
    deleteEntry,
    showProperties,
    statusText,
    statusSize,
    statusZone,
    statusZoneIcon: fromRepository ? "drive" : "computer",
    onKeyDown,
    close: () => commands.close(windowId),
  };
}
