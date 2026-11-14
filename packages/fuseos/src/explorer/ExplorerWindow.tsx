import type { KeyboardEvent } from "react";

import { keysFor } from "../lib/shortcuts";
import { MY_COMPUTER } from "../disk/diskPath";
import type { ContextMenuItem } from "../windows/ContextMenu";
import { ContextMenu } from "../windows/ContextMenu";
import type { MenuDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";
import {
  isContextMenuKey,
  menuPositionAt,
  menuPositionFor,
} from "../windows/menuPosition";
import { useWindowCommands } from "../windows/useWindowCommands";

import { AddressBar } from "./AddressBar";
import { DetailsView } from "./DetailsView";
import { FolderTree } from "./FolderTree";
import { IconView } from "./IconView";
import { Splitter } from "./Splitter";
import { StatusBar } from "./StatusBar";
import { Toolbar } from "./Toolbar";
import type { ExplorerViewModel } from "./useExplorerViewModel";
import { useExplorerViewModel } from "./useExplorerViewModel";
import { WinZipDialog } from "./WinZipDialog";

export type ExplorerWindowProps = { windowId: string; location: string };

function entryMenuItems(vm: ExplorerViewModel): ContextMenuItem[] {
  const entry = vm.contextMenu?.entry;
  if (!entry)
    return [
      {
        label: "Large Icons",
        checked: vm.viewMode === "icons",
        onSelect: () => vm.setViewMode("icons"),
      },
      {
        label: "Details",
        checked: vm.viewMode === "details",
        onSelect: () => vm.setViewMode("details"),
      },
      { separator: true },
      { label: "Refresh", onSelect: vm.retry },
    ];
  return [
    {
      label: entry.kind === "file" ? "Open" : "Explore",
      bold: true,
      onSelect: () => vm.open(entry),
    },
    ...(entry.modified
      ? [
          { separator: true as const },
          { label: "Revert to original", onSelect: () => vm.revert(entry) },
        ]
      : []),
  ];
}

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
        { label: "Close", onSelect: vm.close },
      ],
    },
    {
      label: "View",
      items: [
        {
          label: "Large Icons",
          checked: vm.viewMode === "icons",
          onSelect: () => vm.setViewMode("icons"),
        },
        {
          label: "Details",
          checked: vm.viewMode === "details",
          onSelect: () => vm.setViewMode("details"),
        },
        { separator: true },
        {
          label: "Folders",
          checked: vm.foldersPane,
          onSelect: vm.toggleFoldersPane,
        },
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
    <div className="relative flex h-full min-h-0 flex-col">
      <MenuBar menus={menus} />
      <Toolbar
        groups={[
          [
            {
              label: "Back",
              icon: "folderOpen",
              onClick: vm.back,
              disabled: !vm.canBack,
            },
            {
              label: "Forward",
              icon: "folder",
              onClick: vm.forward,
              disabled: !vm.canForward,
            },
            {
              label: "Up",
              icon: "folderOpen",
              onClick: vm.up,
              disabled: !vm.canUp,
            },
          ],
          [
            {
              label: "Folders",
              icon: "explorer",
              onClick: vm.toggleFoldersPane,
              pressed: vm.foldersPane,
            },
          ],
          [
            {
              label: "Icons",
              icon: "programs",
              onClick: () => vm.setViewMode("icons"),
              pressed: vm.viewMode === "icons",
            },
            {
              label: "Details",
              icon: "documents",
              onClick: () => vm.setViewMode("details"),
              pressed: vm.viewMode === "details",
            },
          ],
        ]}
      />
      <AddressBar
        address={vm.address}
        icon={vm.addressIcon}
        onSubmit={vm.openAddress}
      />
      <div className="flex min-h-0 flex-1">
        {vm.foldersPane ? (
          <>
            <FolderTree
              width={vm.foldersWidth}
              currentLocation={vm.location}
              expanded={vm.expanded}
              childrenOf={vm.childrenOf}
              onToggle={vm.toggleExpanded}
              onNavigate={vm.navigate}
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
          className="sunken-panel min-w-0 flex-1 overflow-auto bg-white outline-none"
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
            <div className="flex flex-col items-start gap-2 p-4">
              <p>Drive C: is not ready: {vm.error}</p>
              <button type="button" onClick={vm.retry}>
                Retry
              </button>
            </div>
          ) : vm.busy ? (
            <p className="p-4">{vm.busy}</p>
          ) : vm.entries.length === 0 ? (
            <p className="p-4 text-[grey]">This folder is empty.</p>
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
              onSelect={vm.select}
              onOpen={vm.open}
              onContextMenu={vm.openContextMenu}
            />
          )}
        </div>
      </div>
      <StatusBar text={vm.statusText} detail={vm.statusDetail} />
      {vm.contextMenu ? (
        <ContextMenu
          label="Context menu"
          position={vm.contextMenu.position}
          items={entryMenuItems(vm)}
          onClose={vm.closeContextMenu}
        />
      ) : null}
      {vm.winzip ? (
        <WinZipDialog onFail={vm.winzipFailed} onCancel={vm.winzipCancel} />
      ) : null}
    </div>
  );
}
