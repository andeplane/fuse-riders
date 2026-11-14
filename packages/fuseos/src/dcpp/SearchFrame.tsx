import { useState } from "react";

import { ContextMenu } from "../windows/ContextMenu";

import type { SearchState } from "./dcClient";
import { FileIcon } from "./DcppIcons";
import { formatBytes, formatExact } from "./format";
import type { Column } from "./ListView";
import { ListView } from "./ListView";
import type { FileType, SearchQuery, SearchResult } from "./search";
import { FILE_TYPES, sizeInBytes } from "./search";

type Unit = "B" | "kB" | "MB" | "GB";
const UNITS: readonly Unit[] = ["B", "kB", "MB", "GB"];

const isUnit = (value: string): value is Unit =>
  UNITS.some((unit) => unit === value);
const isFileType = (value: string): value is FileType =>
  FILE_TYPES.some((entry) => entry.value === value);
const isSizeMode = (value: string): value is SearchQuery["sizeMode"] =>
  value === "any" || value === "atLeast" || value === "atMost";

const COLUMNS: readonly Column<SearchResult>[] = [
  {
    key: "file",
    label: "File",
    width: 260,
    render: (row) => (
      <span className="dc-iconcell">
        <FileIcon />
        {row.file}
      </span>
    ),
    sort: (row) => row.file,
  },
  {
    key: "user",
    label: "User",
    width: 110,
    render: (row) => row.nick,
    sort: (row) => row.nick,
  },
  {
    key: "type",
    label: "Type",
    width: 45,
    render: (row) => row.type,
    sort: (row) => row.type,
  },
  {
    key: "size",
    label: "Size",
    width: 75,
    align: "right",
    render: (row) => formatBytes(row.size),
    sort: (row) => row.size,
  },
  {
    key: "path",
    label: "Path",
    width: 200,
    render: (row) => row.path,
    sort: (row) => row.path,
  },
  {
    key: "slots",
    label: "Slots",
    width: 45,
    render: (row) => `${row.slots.free}/${row.slots.total}`,
    sort: (row) => row.slots.free,
  },
  {
    key: "connection",
    label: "Connection",
    width: 75,
    render: (row) => row.connection,
    sort: (row) => row.connection,
  },
  {
    key: "hub",
    label: "Hub",
    width: 170,
    render: (row) => row.hub,
    sort: (row) => row.hub,
  },
  {
    key: "exact",
    label: "Exact size",
    width: 105,
    align: "right",
    render: (row) => formatExact(row.size),
    sort: (row) => row.size,
  },
  {
    key: "ip",
    label: "IP",
    width: 100,
    render: (row) => row.ip,
    sort: (row) => row.ip,
  },
];

/** Search: the options panel on the left, the results on the right, a status strip under them. */
export function SearchFrame({
  search,
  hubs,
  onSearch,
  onDownload,
  onFileList,
}: {
  search: SearchState;
  /** The connected hubs, for the Hubs list. */
  hubs: readonly { name: string; address: string }[];
  onSearch: (query: SearchQuery) => void;
  onDownload: (result: SearchResult) => void;
  onFileList: (result: SearchResult) => void;
}) {
  const [text, setText] = useState("");
  const [sizeMode, setSizeMode] = useState<SearchQuery["sizeMode"]>("atLeast");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<Unit>("MB");
  const [type, setType] = useState<FileType>("any");
  const [onlyFree, setOnlyFree] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{
    row: SearchResult;
    x: number;
    y: number;
  }>();

  const submit = () =>
    onSearch({
      text,
      sizeMode: amount.trim() ? sizeMode : "any",
      size: sizeInBytes(amount, unit),
      type,
      onlyFreeSlots: onlyFree,
      hubs: hubs
        .map((hub) => hub.address)
        .filter((address) => !unticked.has(address)),
    });

  return (
    <div className="dc-frame dc-search">
      <div className="dc-search-split">
        <form
          className="dc-search-options"
          aria-label="Search options"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset className="dc-group">
            <legend>Search for</legend>
            <input
              type="text"
              aria-label="Search for"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </fieldset>
          <fieldset className="dc-group">
            <legend>Size</legend>
            <div className="dc-row">
              <select
                aria-label="Size mode"
                value={sizeMode}
                onChange={(event) => {
                  const { value } = event.target;
                  if (isSizeMode(value)) setSizeMode(value);
                }}
              >
                <option value="any">Normal</option>
                <option value="atLeast">At least</option>
                <option value="atMost">At most</option>
              </select>
              <input
                type="text"
                aria-label="Size"
                className="dc-size"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <select
                aria-label="Size unit"
                value={unit}
                onChange={(event) => {
                  const { value } = event.target;
                  if (isUnit(value)) setUnit(value);
                }}
              >
                {UNITS.map((entry) => (
                  <option key={entry}>{entry}</option>
                ))}
              </select>
            </div>
          </fieldset>
          <fieldset className="dc-group">
            <legend>File type</legend>
            <select
              aria-label="File type"
              value={type}
              onChange={(event) => {
                const { value } = event.target;
                if (isFileType(value)) setType(value);
              }}
            >
              {FILE_TYPES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </fieldset>
          <fieldset className="dc-group">
            <legend>Search options</legend>
            <input
              id="dc-onlyfree"
              type="checkbox"
              checked={onlyFree}
              onChange={(event) => setOnlyFree(event.target.checked)}
            />
            <label htmlFor="dc-onlyfree">Only users with free slots</label>
          </fieldset>
          <fieldset className="dc-group dc-hubpick">
            <legend>Hubs</legend>
            <ul aria-label="Hubs to search">
              {hubs.map((hub) => (
                <li key={hub.address}>
                  <input
                    id={`dc-hub-${hub.address}`}
                    type="checkbox"
                    checked={!unticked.has(hub.address)}
                    onChange={(event) => {
                      const next = new Set(unticked);
                      if (event.target.checked) next.delete(hub.address);
                      else next.add(hub.address);
                      setUnticked(next);
                    }}
                  />
                  <label htmlFor={`dc-hub-${hub.address}`}>{hub.name}</label>
                </li>
              ))}
            </ul>
          </fieldset>
          <button type="submit" className="dc-searchbutton">
            Search
          </button>
        </form>
        <ListView
          label="Search results"
          columns={COLUMNS}
          rows={search.results}
          rowKey={(row) => row.id}
          selected={selected}
          onSelect={setSelected}
          onOpen={onDownload}
          onContextMenu={(row, position) => setMenu({ row, ...position })}
        />
      </div>
      <div className="dc-framestatus">
        <span className="dc-cell dc-grow">{search.message || "Ready"}</span>
        <span className="dc-cell">
          {search.status === "done" ? `${search.results.length} items` : ""}
        </span>
      </div>
      {menu ? (
        <ContextMenu
          label="Search result"
          position={{ x: menu.x, y: menu.y }}
          items={[
            {
              label: "Download",
              bold: true,
              onSelect: () => onDownload(menu.row),
            },
            { label: "Download to...", disabled: true },
            { label: "Download whole directory", disabled: true },
            { separator: true },
            { label: "Get file list", onSelect: () => onFileList(menu.row) },
            { label: "Send private message", disabled: true },
          ]}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}
