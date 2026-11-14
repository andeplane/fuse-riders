import { useContext } from "react";

import type { DesktopIconArt } from "../desktop/DesktopIcon";
import { GameTileIcon } from "../desktop/DesktopIcon";
import { AppIcon, Win98Icon } from "../ui/icons";
import type { MenuDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";

import { JoinRoomDialog } from "./JoinRoomDialog";
import { NetworkDepsContext } from "./networkDeps";
import type {
  NetworkItem,
  NetworkLocation,
  NetworkViewModel,
} from "./useNetworkViewModel";
import {
  ENTIRE_NETWORK_LABEL,
  formatLastPlayed,
  JOIN_ROOM_LABEL,
  ROOT_LABEL,
  useNetworkViewModel,
} from "./useNetworkViewModel";

function ItemIcon({ icon, size }: { icon: DesktopIconArt; size: 16 | 32 }) {
  if (typeof icon === "string" || icon.kind === "image")
    return <AppIcon icon={icon} size={size} />;
  return size === 32 ? (
    <GameTileIcon mark={icon.mark} accent={icon.accent} />
  ) : (
    <span
      aria-hidden
      className="inline-block h-4 w-4 border border-black text-center align-middle text-[8px] font-bold leading-4 text-white"
      style={{ backgroundColor: icon.accent }}
    >
      {icon.mark.slice(0, 2)}
    </span>
  );
}

function sameLocation(a: NetworkLocation, b: NetworkLocation): boolean {
  return (
    a.kind === b.kind &&
    (a.kind !== "workgroup" || b.kind !== "workgroup" || a.gameId === b.gameId)
  );
}

function TreePane({ vm }: { vm: NetworkViewModel }) {
  const node = (
    label: string,
    location: NetworkLocation,
    icon: DesktopIconArt,
  ) => {
    const current = sameLocation(vm.location, location);
    return (
      <a
        href="#"
        aria-current={current ? "location" : undefined}
        className={`inline-flex items-center gap-1 px-0.5 ${current ? "bg-[navy] text-white" : ""}`}
        onClick={(event) => {
          event.preventDefault();
          vm.go(location);
        }}
      >
        <ItemIcon icon={icon} size={16} />
        <span>{label}</span>
      </a>
    );
  };
  return (
    <ul className="tree-view h-full overflow-auto" aria-label="Network tree">
      <li>
        <details open>
          <summary>{node(ROOT_LABEL, { kind: "root" }, "network")}</summary>
          <ul>
            <li>
              <details open>
                <summary>
                  {node(ENTIRE_NETWORK_LABEL, { kind: "entire" }, "network")}
                </summary>
                <ul>
                  {vm.workgroups.map((game) => (
                    <li key={game.id}>
                      {node(
                        game.name,
                        { kind: "workgroup", gameId: game.id },
                        { kind: "tile", mark: game.mark, accent: game.accent },
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          </ul>
        </details>
      </li>
    </ul>
  );
}

function itemProps(vm: NetworkViewModel, item: NetworkItem) {
  const selected = vm.selectedId === item.id;
  return {
    selected,
    onClick: () => vm.select(item.id),
    onDoubleClick: item.open,
    onKeyDown: (event: { key: string; preventDefault(): void }) => {
      if (event.key === "Enter") {
        event.preventDefault();
        item.open();
      } else if (event.key === "Delete" && item.forget) {
        event.preventDefault();
        item.forget();
      }
    },
  };
}

function IconsPane({ vm }: { vm: NetworkViewModel }) {
  return (
    <ul
      role="listbox"
      aria-label="Network items"
      className="flex flex-wrap content-start gap-1 p-2"
    >
      {vm.items.map((item) => {
        const { selected, ...handlers } = itemProps(vm, item);
        return (
          <li key={item.id} role="none" className="w-20">
            <button
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={item.label}
              title={item.type}
              className="flat flex w-full flex-col items-center gap-1 text-center"
              style={{ minWidth: 0, color: "#222" }}
              {...handlers}
            >
              <ItemIcon icon={item.icon} size={32} />
              <span
                className={`px-0.5 leading-tight ${selected ? "bg-[navy] text-white" : ""}`}
              >
                {item.label}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DetailsPane({ vm, now }: { vm: NetworkViewModel; now: number }) {
  return (
    <table className="interactive w-full" aria-label="Network items">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Last played</th>
        </tr>
      </thead>
      <tbody>
        {vm.items.map((item) => {
          const { selected, ...handlers } = itemProps(vm, item);
          return (
            <tr
              key={item.id}
              tabIndex={0}
              aria-selected={selected}
              aria-label={item.label}
              className={selected ? "highlighted" : ""}
              {...handlers}
            >
              <td className="flex items-center gap-1">
                <ItemIcon icon={item.icon} size={16} />
                <span>{item.label}</span>
              </td>
              <td>{item.type}</td>
              <td>
                {item.lastPlayed === undefined
                  ? ""
                  : formatLastPlayed(item.lastPlayed, now)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Explorer-style Network Neighborhood: tree of workgroups (one per Fuse game) on the left, rooms on the right. */
export function NetworkWindow({ windowId }: { windowId: string }) {
  const vm = useNetworkViewModel(windowId);
  const { now } = useContext(NetworkDepsContext);
  const selected = vm.items.find((item) => item.id === vm.selectedId);
  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        { label: "Open", disabled: !selected, onSelect: vm.openSelected },
        { label: JOIN_ROOM_LABEL, onSelect: () => vm.openJoinDialog() },
        { separator: true },
        {
          label: "Forget room",
          disabled: !selected?.forget,
          onSelect: () => selected?.forget?.(),
        },
        {
          label: "Forget all recent rooms",
          disabled: vm.recentRooms.length === 0,
          onSelect: vm.clearRecentRooms,
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
          checked: vm.view === "icons",
          onSelect: () => vm.setView("icons"),
        },
        {
          label: "Details",
          checked: vm.view === "details",
          onSelect: () => vm.setView("details"),
        },
        { separator: true },
        {
          label: "Refresh",
          shortcut: "F5",
          disabled: vm.location.kind !== "workgroup",
          onSelect: vm.refresh,
        },
      ],
    },
    {
      label: "Help",
      items: [{ label: `About ${ROOT_LABEL}`, onSelect: vm.about }],
    },
  ];
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MenuBar menus={menus} />
      <div className="flex shrink-0 items-center gap-1 border-b border-[grey] px-1 py-0.5">
        <button
          type="button"
          className="flat px-2"
          style={{ color: "#222" }}
          disabled={!vm.canGoUp}
          aria-label="Up one level"
          onClick={vm.up}
        >
          <Win98Icon name="folderOpen" /> Up
        </button>
        <button
          type="button"
          className="flat px-2"
          style={{ color: "#222" }}
          onClick={() => vm.openJoinDialog()}
        >
          <Win98Icon name="network" /> {JOIN_ROOM_LABEL}
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-1 py-0.5">
        <label htmlFor={`${windowId}-address`}>Address</label>
        <input
          id={`${windowId}-address`}
          type="text"
          readOnly
          className="flex-1"
          value={vm.path.join("\\")}
        />
      </div>
      <div className="flex min-h-0 flex-1 gap-1 p-1">
        <div className="w-44 shrink-0">
          <TreePane vm={vm} />
        </div>
        <div
          className="sunken-panel min-h-0 flex-1 overflow-auto bg-white"
          onClick={(event) => {
            if (event.target === event.currentTarget) vm.select(null);
          }}
        >
          {vm.view === "icons" ? (
            <IconsPane vm={vm} />
          ) : (
            <DetailsPane vm={vm} now={now()} />
          )}
        </div>
      </div>
      <div className="status-bar shrink-0" role="status">
        <p className="status-bar-field">{vm.items.length} object(s)</p>
        <p className="status-bar-field flex-[2]">
          {vm.liveStatus ??
            (selected ? selected.type : "Rooms you join are remembered here.")}
        </p>
      </div>
      {vm.joinDialog ? (
        <JoinRoomDialog
          dialog={vm.joinDialog}
          games={vm.workgroups}
          onGameChange={vm.setJoinGame}
          onCodeChange={vm.setJoinCode}
          onJoin={vm.submitJoin}
          onCancel={vm.closeJoinDialog}
        />
      ) : null}
    </div>
  );
}
