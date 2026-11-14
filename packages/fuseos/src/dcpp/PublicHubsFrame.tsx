import { useState } from "react";

import { ContextMenu } from "../windows/ContextMenu";

import { formatBytes } from "./format";
import type { Hub } from "./hubs";
import { filterHubs, publicHubs } from "./hubs";
import type { Column } from "./ListView";
import { ListView } from "./ListView";

export const HUBLIST_URL = "http://www.hublist.org/PublicHubList.config.bz2";

const COLUMNS: readonly Column<Hub>[] = [
  { key: "name", label: "Name", width: 230, render: (hub) => hub.name, sort: (hub) => hub.name },
  {
    key: "description",
    label: "Description",
    width: 290,
    render: (hub) => hub.description,
    sort: (hub) => hub.description,
  },
  {
    key: "users",
    label: "Users",
    width: 50,
    align: "right",
    render: (hub) => hub.users,
    sort: (hub) => hub.users,
  },
  {
    key: "address",
    label: "Address",
    width: 190,
    render: (hub) => hub.address,
    sort: (hub) => hub.address,
  },
  {
    key: "shared",
    label: "Shared",
    width: 80,
    align: "right",
    render: (hub) => formatBytes(hub.shared),
    sort: (hub) => hub.shared,
  },
  {
    key: "minShare",
    label: "Min share",
    width: 80,
    align: "right",
    render: (hub) => formatBytes(hub.minShare),
    sort: (hub) => hub.minShare,
  },
];

/** Public Hubs as 0.401 laid it out: the hublist.org list, Filter and Manual connect address boxes, Refresh and Connect. */
export function PublicHubsFrame({
  hubs,
  onConnect,
  onRefresh,
}: {
  hubs: readonly Hub[];
  onConnect: (address: string) => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState("");
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<{ hub: Hub; x: number; y: number }>();
  const listed = publicHubs(hubs);
  const shown = filterHubs(listed, filter);
  const users = listed.reduce((sum, hub) => sum + hub.users, 0);
  return (
    <div className="dc-frame dc-publichubs">
      <ListView
        label="Public hubs"
        columns={COLUMNS}
        rows={shown}
        rowKey={(hub) => hub.address}
        selected={selected}
        onSelect={setSelected}
        onOpen={(hub) => onConnect(hub.address)}
        onContextMenu={(hub, position) => setMenu({ hub, ...position })}
      />
      <div className="dc-hubbar">
        <fieldset className="dc-group dc-filter">
          <legend>Filter</legend>
          <input
            type="text"
            aria-label="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </fieldset>
        <fieldset className="dc-group dc-filter">
          <legend>Manual connect address</legend>
          <input
            type="text"
            aria-label="Manual connect address"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && manual.trim()) onConnect(manual.trim());
            }}
          />
        </fieldset>
        <div className="dc-hubbuttons">
          <button type="button" onClick={onRefresh}>
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              const target = manual.trim() || selected;
              if (target) onConnect(target);
            }}
          >
            Connect
          </button>
        </div>
      </div>
      <div className="dc-framestatus">
        <span className="dc-cell dc-grow">
          Hub list downloaded... ({HUBLIST_URL})
        </span>
        <span className="dc-cell">Hubs: {listed.length}</span>
        <span className="dc-cell">Users: {users}</span>
      </div>
      {menu ? (
        <ContextMenu
          label="Hub"
          position={{ x: menu.x, y: menu.y }}
          items={[
            { label: "Connect", bold: true, onSelect: () => onConnect(menu.hub.address) },
            { label: "Add To Favorites", disabled: true },
            { label: "Copy address to clipboard", disabled: true },
          ]}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}
