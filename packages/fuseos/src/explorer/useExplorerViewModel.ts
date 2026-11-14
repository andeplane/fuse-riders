import type { KeyboardEvent } from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { DesktopUiContext } from "../desktop/desktopUiContext";
import type { DiskEntry } from "../disk/diskEntries";
import {
  listEntries,
  locationExists,
  SYSTEM32_LOCATION,
} from "../disk/diskEntries";
import {
  DRIVE_A,
  driveOf,
  formatAddress,
  MY_COMPUTER,
  parentOf,
  parseAddress,
} from "../disk/diskPath";
import { formatSize } from "../disk/fileTypes";
import {
  CLIPPY_PORN_HELP,
  FLOPPY_JOKE_LOCATION,
  PASSWORD_DIALOG_TITLE,
  PASSWORD_HINT_AFTER,
  PASSWORD_INCORRECT_MESSAGE,
  RICKROLL_TITLE,
} from "../disk/floppy";
import { WINZIP_ERROR_MESSAGE } from "../disk/floppy";
import { useDiskDeps, useDiskManifest, useOverlayPaths } from "../disk/useDisk";
import { matchShortcut } from "../lib/shortcuts";
import { useOpenInNotepad } from "../notepadpp/useOpenInNotepad";
import type { WindowContent } from "../state/appState";
import { useAppState } from "../state/useAppState";
import { useSystem32Folder } from "../system32/explorerContract";
import type { IconName } from "../ui/icons";
import type { MenuPosition } from "../windows/menuPosition";
import { useWindowCommands } from "../windows/useWindowCommands";

import { decideOpen } from "./openEntry";
import type { SortColumn, SortSpec } from "./sorting";
import { DEFAULT_SORT, sortEntries, toggleSort } from "./sorting";

export type ExplorerViewMode = "icons" | "details";

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
  back: () => void;
  forward: () => void;
  up: () => void;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  viewMode: ExplorerViewMode;
  setViewMode: (mode: ExplorerViewMode) => void;
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
  /** A:\\porn's "Enter Network Password" box, while it is up; null otherwise. */
  password: PasswordPrompt | null;
  /** OK in the password box: a wrong one gets the error box (the box stays up), the right one logs on. */
  submitPassword: (text: string) => "granted" | "denied";
  cancelPassword: () => void;
  /** File > Revert to original on a modified file. */
  revert: (entry: DiskEntry) => void;
  /** File > Delete: SYSTEM32 starts the gag's questions; everything else on these drives refuses. */
  remove: (entry: DiskEntry) => void;
  /** Status bar fields. */
  statusText: string;
  statusDetail: string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  close: () => void;
};

/** Where the network password box is: asking, then the two beats of a logon that worked. */
export type PasswordPrompt = { phase: "asking" | "connecting" | "granted" };

/** What A:\\porn's only file opens: the Media Player, playing the real thing. */
export const RICKROLL_PLAYER: WindowContent = {
  kind: "mediaplayer",
  file: RICKROLL_TITLE,
  stream: "rickroll",
};

/** A:\\porn itself or anything under it. */
export function isInJokeFolder(location: string): boolean {
  return (
    location === FLOPPY_JOKE_LOCATION ||
    location.startsWith(`${FLOPPY_JOKE_LOCATION}/`)
  );
}

export const ADDRESS_NOT_FOUND_TITLE = "Explorer";

export const DELETE_DENIED_TITLE = "Error Deleting File";

export function deleteDeniedMessage(name: string): string {
  return `Cannot delete ${name}: Access is denied.\n\nMake sure the disk is not full or write-protected and that the file is not currently in use.`;
}

export function addressNotFoundMessage(text: string): string {
  return `Cannot find '${text}'. Make sure the path is correct and try again.`;
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
  const system32 = useSystem32Folder();
  const { assistantDispatch } = useContext(DesktopUiContext);

  const [history, setHistory] = useState<{ back: string[]; forward: string[] }>(
    { back: [], forward: [] },
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ExplorerViewMode>("details");
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  const [foldersPane, setFoldersPane] = useState(true);
  const [foldersWidth, setFoldersWidth] = useState(180);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set([MY_COMPUTER]),
  );
  const [contextMenu, setContextMenu] = useState<
    ExplorerContextMenu | undefined
  >(undefined);
  const [winzip, setWinzip] = useState(false);
  const [password, setPassword] = useState<PasswordPrompt | null>(null);
  // The floppy seeks when A: is entered from another drive; a subfolder of A: is already spinning.
  const [seeking, setSeeking] = useState(false);
  const seekToken = useRef(0);

  const tree = manifest.status === "ready" ? manifest.tree : undefined;
  const committedAt =
    manifest.status === "ready" ? manifest.manifest.committedAt : "";
  const system32Present = system32.present;
  const listingInputs = useMemo(
    () => ({ tree, committedAt, overlayPaths, system32Present }),
    [tree, committedAt, overlayPaths, system32Present],
  );

  const entries = useMemo(
    () => sortEntries(listEntries(location, listingInputs), sort),
    [location, listingInputs, sort],
  );
  const childrenOf = useCallback(
    (parent: string) =>
      listEntries(parent, listingInputs).filter(
        (entry) => entry.kind !== "file",
      ),
    [listingInputs],
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

  // A:\\porn and anything under it stay behind the password, however they are reached: a double click,
  // the address bar, Back, the folders tree or a window restored from an earlier visit.
  const lockedOut = useCallback(
    (target: string) => isInJokeFolder(target) && !deps.jokeGate.isUnlocked(),
    [deps.jokeGate],
  );
  const restoredInside = lockedOut(location);
  useEffect(() => {
    if (!restoredInside) return;
    setLocation(DRIVE_A);
    setPassword({ phase: "asking" });
  }, [restoredInside, setLocation]);

  const go = useCallback(
    (next: string, record: boolean) => {
      if (next === location) return;
      if (lockedOut(next)) {
        setPassword({ phase: "asking" });
        return;
      }
      if (record)
        setHistory((current) => ({
          back: [...current.back, location],
          forward: [],
        }));
      setSelected(null);
      setLocation(next);
      if (driveOf(next) === "A" && driveOf(location) !== "A") {
        const token = (seekToken.current += 1);
        setSeeking(true);
        void deps.floppySeek().finally(() => {
          if (seekToken.current === token) setSeeking(false);
        });
      }
    },
    [location, setLocation, deps, lockedOut],
  );

  const navigate = useCallback((next: string) => go(next, true), [go]);

  const back = useCallback(() => {
    const previous = history.back[history.back.length - 1];
    if (previous === undefined) return;
    setHistory({
      back: history.back.slice(0, -1),
      forward: [location, ...history.forward],
    });
    go(previous, false);
  }, [history, location, go]);

  const forward = useCallback(() => {
    const [next, ...rest] = history.forward;
    if (next === undefined) return;
    setHistory({ back: [...history.back, location], forward: rest });
    go(next, false);
  }, [history, location, go]);

  const parent = parentOf(location);
  const up = useCallback(() => {
    if (parent !== undefined) navigate(parent);
  }, [parent, navigate]);

  const openAddress = useCallback(
    (text: string) => {
      const parsed = parseAddress(text);
      if (parsed !== undefined && locationExists(parsed, tree, system32Present))
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
      const decision = decideOpen(entry);
      switch (decision.type) {
        case "navigate":
          navigate(decision.location);
          return;
        case "jokeFolder":
          // Behind a network password until someone on this desktop has given it (see `go`).
          navigate(decision.location);
          return;
        case "rickroll":
          commands.open(RICKROLL_PLAYER);
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
    [navigate, deps.source, commands, openInNotepad],
  );

  const submitPassword = useCallback(
    (text: string): "granted" | "denied" => {
      if (deps.jokeGate.tryPassword(text) === "denied") {
        commands.showError(PASSWORD_DIALOG_TITLE, PASSWORD_INCORRECT_MESSAGE);
        // Every third wrong guess, the paperclip notices.
        if (deps.jokeGate.failures() % PASSWORD_HINT_AFTER === 0)
          assistantDispatch({
            type: "say",
            text: CLIPPY_PORN_HELP,
            mood: "idea",
          });
        return "denied";
      }
      setPassword({ phase: "connecting" });
      void deps
        .logonPause("connecting")
        .then(() => {
          setPassword({ phase: "granted" });
          return deps.logonPause("granted");
        })
        .then(() => {
          setPassword(null);
          navigate(FLOPPY_JOKE_LOCATION);
          // The folder's only file plays by itself, as if someone had double-clicked it.
          commands.open(RICKROLL_PLAYER);
        });
      return "granted";
    },
    [deps, commands, assistantDispatch, navigate],
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

  const removeSystem32 = system32.remove;
  const remove = useCallback(
    (entry: DiskEntry) => {
      // The gag asks its own three questions; no confirm here.
      if (entry.location === SYSTEM32_LOCATION) removeSystem32();
      else
        commands.showError(
          DELETE_DENIED_TITLE,
          deleteDeniedMessage(entry.name),
        );
    },
    [removeSystem32, commands],
  );

  const selectedEntry = entries.find((entry) => entry.location === selected);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (matchShortcut(event, "explorer.up")) {
        event.preventDefault();
        up();
      } else if (matchShortcut(event, "explorer.open")) {
        if (selectedEntry) {
          event.preventDefault();
          open(selectedEntry);
        }
      } else if (matchShortcut(event, "explorer.delete")) {
        if (selectedEntry && selectedEntry.kind !== "drive") {
          event.preventDefault();
          remove(selectedEntry);
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
    [up, open, remove, selectedEntry, entries, selected],
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

  const statusText = busy ?? `${entries.length} object(s)`;
  const statusDetail = selectedEntry
    ? selectedEntry.size === undefined
      ? selectedEntry.name
      : `${selectedEntry.name}  ${formatSize(selectedEntry.size)}`
    : manifest.status === "ready" && location !== MY_COMPUTER
      ? `${manifest.manifest.repo} @ ${manifest.manifest.sha.slice(0, 7)}`
      : "";

  return {
    location,
    address: formatAddress(location),
    addressIcon:
      location === MY_COMPUTER
        ? "computer"
        : driveOf(location) === "A" && parent === MY_COMPUTER
          ? "floppy"
          : driveOf(location) === "C" && parent === MY_COMPUTER
            ? "drive"
            : "folderOpen",
    title:
      location === MY_COMPUTER
        ? "My Computer"
        : `Exploring - ${formatAddress(location)}`,
    entries: busy || error ? [] : entries,
    busy,
    error,
    retry: manifest.retry,
    selected: selectedEntry,
    select: (entry) => setSelected(entry?.location ?? null),
    open,
    openAddress,
    navigate,
    back,
    forward,
    up,
    canBack: history.back.length > 0,
    canForward: history.forward.length > 0,
    canUp: parent !== undefined,
    viewMode,
    setViewMode,
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
    password,
    submitPassword,
    cancelPassword: () => setPassword(null),
    revert,
    remove,
    statusText,
    statusDetail,
    onKeyDown,
    close: () => commands.close(windowId),
  };
}
