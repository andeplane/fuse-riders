import type { KeyboardEvent } from "react";

import { keysFor } from "../lib/shortcuts";
import { DRIVE_A, DRIVE_C, driveOf, MY_COMPUTER } from "../disk/diskPath";
import type { ContextMenuItem } from "../windows/ContextMenu";
import { ContextMenu } from "../windows/ContextMenu";
import type { MenuDef, MenuItemDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";
import {
  isContextMenuKey,
  menuPositionAt,
  menuPositionFor,
} from "../windows/menuPosition";
import type { WindowCommands } from "../windows/useWindowCommands";
import { useWindowCommands } from "../windows/useWindowCommands";

import { AddressBar } from "./AddressBar";
import { DetailsView } from "./DetailsView";
import "./explorer.css";
import { FolderTree } from "./FolderTree";
import { IconView } from "./IconView";
import { Throbber } from "./PixelIcon";
import { DESKTOP } from "./shellNamespace";
import { Splitter } from "./Splitter";
import { StatusBar } from "./StatusBar";
import { Toolbar } from "./Toolbar";
import type { ExplorerViewModel } from "./useExplorerViewModel";
import { useExplorerViewModel, VIEW_MODES } from "./useExplorerViewModel";
import { WinZipDialog } from "./WinZipDialog";

export type ExplorerWindowProps = { windowId: string; location: string };

/** View > Large Icons ... Details, shared by the menu bar, the Views button and the pane's own menu. */
function viewItems(vm: ExplorerViewModel) {
  return VIEW_MODES.map(({ mode, label }) => ({
    label,
    checked: vm.viewMode === mode,
    onSelect: () => vm.setViewMode(mode),
  }));
}

function entryMenuItems(
  vm: ExplorerViewModel,
  commands: WindowCommands,
): ContextMenuItem[] {
  const entry = vm.contextMenu?.entry;
  if (!entry)
    return [
      ...viewItems(vm),
      { separator: true },
      { label: "Refresh", onSelect: vm.retry },
      { separator: true },
      { label: "Properties", onSelect: () => vm.showProperties(undefined) },
    ];
  const drive = entry.kind === "drive" ? driveOf(entry.location) : undefined;
  return [
    {
      label: entry.kind === "file" ? "Open" : "Explore",
      bold: true,
      onSelect: () => vm.open(entry),
    },
    // A drive's Properties > Tools, cut down to the one button anyone pressed.
    ...(drive
      ? [
          { separator: true as const },
          {
            label: "Defragment Now...",
            onSelect: () =>
              commands.open({ kind: "defrag", drive, stage: "running" }),
          },
        ]
      : []),
    ...(entry.modified
      ? [
          { separator: true as const },
          { label: "Revert to original", onSelect: () => vm.revert(entry) },
        ]
      : []),
    { separator: true },
    { label: "Delete", onSelect: () => vm.deleteEntry(entry) },
    { separator: true },
    { label: "Properties", onSelect: () => vm.showProperties(entry) },
  ];
}

/** The disk is read only, so the clipboard commands are always grey; they are here because Explorer has them. */
const CLIPBOARD_ITEMS: MenuItemDef[] = [
  { label: "Undo", disabled: true },
  { separator: true },
  { label: "Cut", disabled: true },
  { label: "Copy", disabled: true },
  { label: "Paste", disabled: true },
];

export function ExplorerWindow({ windowId, location }: ExplorerWindowProps) {
  const vm = useExplorerViewModel(windowId, location);
  const commands = useWindowCommands();
  const selected = vm.selected;

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        {
          label: selected && selected.kind !== "file" ? "Explore" : "Open",
          disabled: !selected,
          onSelect: () => {
            if (selected) vm.open(selected);
          },
        },
        {
          label: "Revert to original",
          disabled: !selected?.modified,
          onSelect: () => {
            if (selected) vm.revert(selected);
          },
        },
        { separator: true },
        {
          label: "Delete",
          disabled: !selected,
          onSelect: () => {
            if (selected) vm.deleteEntry(selected);
          },
        },
        {
          label: "Properties",
          shortcut: keysFor("explorer.properties"),
          onSelect: () => vm.showProperties(selected),
        },
        { separator: true },
        { label: "Close", onSelect: vm.close },
      ],
    },
    { label: "Edit", items: CLIPBOARD_ITEMS },
    {
      label: "View",
      items: [
        {
          label: "All Folders",
          checked: vm.foldersPane,
          onSelect: vm.toggleFoldersPane,
        },
        { separator: true },
        ...viewItems(vm),
        { separator: true },
        { label: "Refresh", onSelect: vm.retry },
      ],
    },
    {
      label: "Go",
      items: [
        { label: "Back", disabled: !vm.canBack, onSelect: vm.back },
        { label: "Forward", disabled: !vm.canForward, onSelect: vm.forward },
        {
          label: "Up One Level",
          shortcut: keysFor("explorer.up"),
          disabled: !vm.canUp,
          onSelect: vm.up,
        },
        { separator: true },
        { label: "My Computer", onSelect: () => vm.navigate(MY_COMPUTER) },
      ],
    },
    {
      label: "Favorites",
      items: [
        { label: "Add to Favorites...", disabled: true },
        { separator: true },
        { label: "Desktop", onSelect: () => vm.navigate(DESKTOP) },
        { label: "Fuse Riders (C:)", onSelect: () => vm.navigate(DRIVE_C) },
        { label: "3½ Floppy (A:)", onSelect: () => vm.navigate(DRIVE_A) },
      ],
    },
    {
      label: "Tools",
      items: [
        { label: "Find Files or Folders...", disabled: true },
        { separator: true },
        { label: "Map Network Drive...", disabled: true },
        { label: "Disconnect Network Drive...", disabled: true },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "About Explorer",
          onSelect: () => commands.open({ kind: "about" }),
        },
      ],
    },
  ];

  /** Keyboard access to the context menu: next to the selected entry, or in the pane's corner. */
  const onPaneKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isContextMenuKey(event)) {
      vm.onKeyDown(event);
      return;
    }
    event.preventDefault();
    const target = selected
      ? event.currentTarget.querySelector('[aria-selected="true"]')
      : null;
    vm.openContextMenu(
      selected,
      menuPositionFor(target ?? event.currentTarget),
    );
  };

  return (
    <div className="explorer">
      <div className="explorer-rebar">
        <div className="explorer-band explorer-band-menu">
          <span className="explorer-gripper" aria-hidden />
          <MenuBar menus={menus} />
          <Throbber busy={vm.busy !== undefined} />
        </div>
        <div className="explorer-band explorer-band-toolbar">
          <span className="explorer-gripper" aria-hidden />
          <Toolbar
            groups={[
              [
                {
                  label: "Back",
                  icon: "back",
                  onClick: vm.back,
                  disabled: !vm.canBack,
                  menu: vm.backSteps,
                },
                {
                  label: "Forward",
                  icon: "forward",
                  onClick: vm.forward,
                  disabled: !vm.canForward,
                  menu: vm.forwardSteps,
                },
                {
                  label: "Up",
                  icon: "up",
                  onClick: vm.up,
                  disabled: !vm.canUp,
                },
              ],
              [
                { label: "Cut", icon: "cut" },
                { label: "Copy", icon: "copy" },
                { label: "Paste", icon: "paste" },
              ],
              [{ label: "Undo", icon: "undo" }],
              [
                {
                  label: "Delete",
                  icon: "delete",
                  onClick: selected
                    ? () => vm.deleteEntry(selected)
                    : undefined,
                },
                {
                  label: "Properties",
                  icon: "properties",
                  onClick: () => vm.showProperties(selected),
                },
              ],
              [
                {
                  label: "Views",
                  icon: "views",
                  onClick: vm.cycleViewMode,
                  menu: viewItems(vm),
                },
              ],
            ]}
          />
        </div>
        <div className="explorer-band explorer-band-address">
          <span className="explorer-gripper" aria-hidden />
          <AddressBar
            address={vm.address}
            icon={vm.addressIcon}
            onSubmit={vm.openAddress}
            places={vm.places}
          />
        </div>
      </div>
      <div className="explorer-panes">
        {vm.foldersPane ? (
          <>
            <FolderTree
              width={vm.foldersWidth}
              currentLocation={vm.location}
              expanded={vm.expanded}
              childrenOf={vm.childrenOf}
              onToggle={vm.toggleExpanded}
              onActivate={vm.activate}
              onClose={vm.toggleFoldersPane}
            />
            <Splitter
              label="Resize folders"
              value={vm.foldersWidth}
              min={96}
              max={600}
              onChange={vm.setFoldersWidth}
            />
          </>
        ) : null}
        <div
          className="explorer-contents"
          tabIndex={0}
          aria-label="Folder contents"
          onKeyDown={onPaneKeyDown}
          onClick={(event) => {
            if (event.target === event.currentTarget) vm.select(undefined);
          }}
          onContextMenu={(event) => {
            // Entries stop propagation, so this is the empty space of the pane.
            event.preventDefault();
            vm.openContextMenu(undefined, menuPositionAt(event));
          }}
        >
          {vm.error ? (
            <div className="explorer-notice">
              <p>Drive C: is not ready: {vm.error}</p>
              <button type="button" onClick={vm.retry}>
                Retry
              </button>
            </div>
          ) : vm.busy ? (
            <p className="explorer-notice">{vm.busy}</p>
          ) : vm.entries.length === 0 ? (
            <p className="explorer-notice explorer-notice-empty">
              This folder is empty.
            </p>
          ) : vm.viewMode === "details" ? (
            <DetailsView
              entries={vm.entries}
              selected={selected?.location ?? null}
              sort={vm.sort}
              onSelect={vm.select}
              onOpen={vm.open}
              onSort={vm.sortBy}
              onContextMenu={vm.openContextMenu}
            />
          ) : (
            <IconView
              entries={vm.entries}
              selected={selected?.location ?? null}
              layout={vm.viewMode}
              onSelect={vm.select}
              onOpen={vm.open}
              onContextMenu={vm.openContextMenu}
            />
          )}
        </div>
      </div>
      <StatusBar
        text={vm.statusText}
        size={vm.statusSize}
        zone={vm.statusZone}
        zoneIcon={vm.statusZoneIcon}
      />
      {vm.contextMenu ? (
        <ContextMenu
          label="Context menu"
          position={vm.contextMenu.position}
          items={entryMenuItems(vm, commands)}
          onClose={vm.closeContextMenu}
        />
      ) : null}
      {vm.winzip ? (
        <WinZipDialog onFail={vm.winzipFailed} onCancel={vm.winzipCancel} />
      ) : null}
    </div>
  );
}
