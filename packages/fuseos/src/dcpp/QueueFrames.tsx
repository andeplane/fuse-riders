import { useState } from "react";

import { ContextMenu } from "../windows/ContextMenu";

import type { FinishedItem, QueueItem } from "./dcClient";
import { FileIcon, FolderIcon } from "./DcppIcons";
import { formatBytes, formatDuration, formatExact, formatSpeed } from "./format";
import type { Column } from "./ListView";
import { ListView } from "./ListView";

const time = (ms: number) => {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** The Download Queue's Status column: DC++'s words for each state. */
export function queueStatus(item: QueueItem): string {
  switch (item.state) {
    case "running":
      return "Running...";
    case "connecting":
      return "Waiting (User online)";
    case "waiting":
      return "Waiting (No slots available)";
    case "failed":
      return item.error ?? "Failed";
    case "done":
      return "Finished";
  }
}

const QUEUE_COLUMNS: readonly Column<QueueItem>[] = [
  {
    key: "file",
    label: "Filename",
    width: 250,
    render: (item) => (
      <span className="dc-iconcell">
        <FileIcon />
        {item.file}
      </span>
    ),
    sort: (item) => item.file,
  },
  { key: "status", label: "Status", width: 170, render: queueStatus, sort: queueStatus },
  {
    key: "size",
    label: "Size",
    width: 75,
    align: "right",
    render: (item) => formatBytes(item.size),
    sort: (item) => item.size,
  },
  {
    key: "downloaded",
    label: "Downloaded",
    width: 130,
    align: "right",
    render: (item) =>
      `${formatBytes(item.downloaded)} (${((item.downloaded / Math.max(1, item.size)) * 100).toFixed(2)}%)`,
    sort: (item) => item.downloaded,
  },
  { key: "priority", label: "Priority", width: 60, render: () => "Normal" },
  {
    key: "users",
    label: "Users",
    width: 150,
    render: (item) =>
      `${item.nick} (${item.state === "failed" ? "Offline" : "Online"})`,
    sort: (item) => item.nick,
  },
  { key: "path", label: "Path", width: 200, render: (item) => item.path, sort: (item) => item.path },
  {
    key: "exact",
    label: "Exact size",
    width: 105,
    align: "right",
    render: (item) => formatExact(item.size),
    sort: (item) => item.size,
  },
  { key: "errors", label: "Errors", width: 140, render: (item) => item.error ?? "" },
  { key: "added", label: "Added", width: 115, render: (item) => time(item.added), sort: (item) => item.added },
];

/** Download Queue: the folders on the left (the sharers' paths), the queued files on the right. */
export function QueueFrame({
  queue,
  onRetry,
  onRemove,
}: {
  queue: readonly QueueItem[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [folder, setFolder] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<{ item: QueueItem; x: number; y: number }>();
  const pending = queue.filter((item) => item.state !== "done");
  const folders = [...new Set(pending.map((item) => item.path))].sort();
  const shown = folder
    ? pending.filter((item) => item.path === folder)
    : pending;
  return (
    <div className="dc-frame dc-queue">
      <div className="dc-tree-split">
        <ul className="dc-tree" role="tree" aria-label="Queued folders">
          <li role="treeitem" aria-selected={folder === undefined}>
            <button type="button" className="flat" onClick={() => setFolder(undefined)}>
              <FolderIcon open />
              Download Queue
            </button>
            <ul role="group">
              {folders.map((path) => (
                <li key={path} role="treeitem" aria-selected={folder === path}>
                  <button type="button" className="flat" onClick={() => setFolder(path)}>
                    <FolderIcon />
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        </ul>
        <ListView
          label="Queued files"
          className="dc-queue-list"
          columns={QUEUE_COLUMNS}
          rows={shown}
          rowKey={(item) => item.id}
          selected={selected}
          onSelect={setSelected}
          onContextMenu={(item, position) => setMenu({ item, ...position })}
          rowClass={(item) => `dc-q-${item.state}`}
        />
      </div>
      <div className="dc-framestatus">
        <span className="dc-cell dc-grow">Ready</span>
        <span className="dc-cell">Items: {shown.length}</span>
        <span className="dc-cell">
          Size: {formatBytes(shown.reduce((sum, item) => sum + item.size, 0))}
        </span>
      </div>
      {menu ? (
        <ContextMenu
          label="Queued file"
          position={{ x: menu.x, y: menu.y }}
          items={[
            { label: "Search for alternates", disabled: true },
            {
              label: "Force attempt",
              disabled: menu.item.state === "running",
              onSelect: () => onRetry(menu.item.id),
            },
            { label: "Set priority", disabled: true },
            { separator: true },
            { label: "Remove", onSelect: () => onRemove(menu.item.id) },
          ]}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}

const FINISHED_COLUMNS: readonly Column<FinishedItem>[] = [
  { key: "time", label: "Time", width: 115, render: (item) => time(item.time), sort: (item) => item.time },
  {
    key: "file",
    label: "Filename",
    width: 230,
    render: (item) => (
      <span className="dc-iconcell">
        <FileIcon />
        {item.file}
      </span>
    ),
    sort: (item) => item.file,
  },
  { key: "path", label: "Path", width: 220, render: (item) => item.path, sort: (item) => item.path },
  { key: "nick", label: "Nick", width: 110, render: (item) => item.nick, sort: (item) => item.nick },
  { key: "hub", label: "Hub", width: 150, render: (item) => item.hub, sort: (item) => item.hub },
  {
    key: "size",
    label: "Size",
    width: 75,
    align: "right",
    render: (item) => formatBytes(item.size),
    sort: (item) => item.size,
  },
  {
    key: "speed",
    label: "Speed",
    width: 80,
    align: "right",
    render: (item) => formatSpeed(item.speed),
    sort: (item) => item.speed,
  },
];

/** Finished Downloads; double-click opens the file (Notepad++ for the repository, Winamp for music). */
export function FinishedFrame({
  finished,
  onOpen,
  onClear,
}: {
  finished: readonly FinishedItem[];
  onOpen: (id: string) => void;
  onClear: () => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<{ item: FinishedItem; x: number; y: number }>();
  const bytes = finished.reduce((sum, item) => sum + item.size, 0);
  const speed =
    finished.length === 0
      ? 0
      : finished.reduce((sum, item) => sum + item.speed, 0) / finished.length;
  return (
    <div className="dc-frame dc-finished">
      <ListView
        label="Finished downloads"
        columns={FINISHED_COLUMNS}
        rows={finished}
        rowKey={(item) => item.id}
        selected={selected}
        onSelect={setSelected}
        onOpen={(item) => onOpen(item.id)}
        onContextMenu={(item, position) => setMenu({ item, ...position })}
      />
      <div className="dc-framestatus">
        <span className="dc-cell dc-grow">Ready</span>
        <span className="dc-cell">Items: {finished.length}</span>
        <span className="dc-cell">Size: {formatBytes(bytes)}</span>
        <span className="dc-cell">Speed: {formatSpeed(speed)}</span>
      </div>
      {menu ? (
        <ContextMenu
          label="Finished download"
          position={{ x: menu.x, y: menu.y }}
          items={[
            { label: "Open", bold: true, onSelect: () => onOpen(menu.item.id) },
            { label: "Open folder", disabled: true },
            { separator: true },
            { label: "Remove all", onSelect: onClear },
          ]}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}

/** The Transfers pane's Status cell: a filled bar with the text over it while running, plain text otherwise. */
function TransferStatus({ item, now }: { item: QueueItem; now: number }) {
  if (item.state !== "running") return <>{item.status}</>;
  const ratio = item.downloaded / Math.max(1, item.size);
  const seconds = Math.max(0, Math.round((now - (item.startedAt ?? now)) / 1000));
  const text = `Downloaded ${formatBytes(item.downloaded)} (${(ratio * 100).toFixed(1)}%) in ${formatDuration(seconds)}`;
  return (
    <span className="dc-progress" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-label={text}>
      <span className="dc-progress-text">{text}</span>
      <span className="dc-progress-fill" style={{ width: `${ratio * 100}%` }}>
        <span className="dc-progress-text" aria-hidden>
          {text}
        </span>
      </span>
    </span>
  );
}

/** The Transfers pane under the MDI area: every download that is not finished. */
export function TransferView({
  queue,
  now,
  onRemove,
  onRetry,
}: {
  queue: readonly QueueItem[];
  now: number;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<{ item: QueueItem; x: number; y: number }>();
  const rows = queue.filter((item) => item.state !== "done");
  const columns: readonly Column<QueueItem>[] = [
    {
      key: "user",
      label: "User",
      width: 120,
      render: (item) => (
        <span className="dc-iconcell">
          <span className="dc-dl-arrow" aria-hidden>
            ▼
          </span>
          {item.nick}
        </span>
      ),
    },
    { key: "hub", label: "Hub", width: 130, render: (item) => item.hub },
    {
      key: "status",
      label: "Status",
      width: 300,
      render: (item) => <TransferStatus item={item} now={now} />,
    },
    {
      key: "left",
      label: "Time left",
      width: 65,
      align: "right",
      render: (item) =>
        item.state === "running" && item.speed > 0
          ? formatDuration((item.size - item.downloaded) / item.speed)
          : "",
    },
    {
      key: "speed",
      label: "Speed",
      width: 75,
      align: "right",
      render: (item) => (item.state === "running" ? formatSpeed(item.speed) : ""),
    },
    { key: "file", label: "File", width: 220, render: (item) => item.file },
    {
      key: "size",
      label: "Size",
      width: 75,
      align: "right",
      render: (item) => formatBytes(item.size),
    },
    { key: "path", label: "Path", width: 160, render: (item) => item.path },
    { key: "ip", label: "IP", width: 100, render: (item) => item.ip },
    {
      key: "ratio",
      label: "Ratio",
      width: 45,
      render: (item) => (item.downloaded > 0 ? "1.00" : ""),
    },
  ];
  return (
    <div className="dc-transfers">
      <ListView
        label="Transfers"
        columns={columns}
        rows={rows}
        rowKey={(item) => item.id}
        selected={selected}
        onSelect={setSelected}
        onContextMenu={(item, position) => setMenu({ item, ...position })}
        rowClass={(item) => `dc-t-${item.state}`}
      />
      {menu ? (
        <ContextMenu
          label="Transfer"
          position={{ x: menu.x, y: menu.y }}
          items={[
            { label: "Get file list", disabled: true },
            {
              label: "Force attempt",
              disabled: menu.item.state === "running",
              onSelect: () => onRetry(menu.item.id),
            },
            { separator: true },
            { label: "Remove user from queue", onSelect: () => onRemove(menu.item.id) },
            { label: "Close connection", onSelect: () => onRemove(menu.item.id) },
          ]}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}
