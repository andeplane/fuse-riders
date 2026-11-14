import { useState } from "react";

import { ContextMenu } from "../windows/ContextMenu";

import type { FileListView } from "./dcClient";
import { FileIcon, FolderIcon } from "./DcppIcons";
import type { FileListFolder } from "./fileList";
import { countFiles, folderAt } from "./fileList";
import { formatBytes, formatExact } from "./format";
import type { Column } from "./ListView";
import { ListView } from "./ListView";
import type { CatalogueFile } from "./search";
import { extensionOf } from "./search";

type Entry =
  | { kind: "folder"; folder: FileListFolder }
  | { kind: "file"; file: CatalogueFile };

const entryName = (entry: Entry) =>
  entry.kind === "folder" ? entry.folder.name : entry.file.name;
const entrySize = (entry: Entry) =>
  entry.kind === "folder" ? entry.folder.size : entry.file.size;

const COLUMNS: readonly Column<Entry>[] = [
  {
    key: "file",
    label: "File",
    width: 300,
    render: (entry) => (
      <span className="dc-iconcell">
        {entry.kind === "folder" ? <FolderIcon /> : <FileIcon />}
        {entryName(entry)}
      </span>
    ),
    sort: (entry) => `${entry.kind === "folder" ? 0 : 1}${entryName(entry)}`,
  },
  {
    key: "type",
    label: "Type",
    width: 60,
    render: (entry) =>
      entry.kind === "folder" ? "Directory" : extensionOf(entry.file.name),
  },
  {
    key: "size",
    label: "Size",
    width: 80,
    align: "right",
    render: (entry) => formatBytes(entrySize(entry)),
    sort: entrySize,
  },
  {
    key: "exact",
    label: "Exact size",
    width: 120,
    align: "right",
    render: (entry) => formatExact(entrySize(entry)),
    sort: entrySize,
  },
];

function Tree({
  folder,
  current,
  onPick,
  label,
}: {
  folder: FileListFolder;
  current: string;
  onPick: (path: string) => void;
  label: string;
}) {
  const open = current.startsWith(folder.path);
  return (
    <li
      role="treeitem"
      aria-selected={current === folder.path}
      aria-expanded={open}
    >
      <button
        type="button"
        className="flat"
        onClick={() => onPick(folder.path)}
      >
        <FolderIcon open={open} />
        {label}
      </button>
      {open && folder.folders.length > 0 ? (
        <ul role="group">
          {folder.folders.map((child) => (
            <Tree
              key={child.path}
              folder={child}
              current={current}
              onPick={onPick}
              label={child.name}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Another user's file list: the folder tree on the left, the folder's contents on the right. */
export function FileListFrame({
  view,
  onDownload,
}: {
  view: FileListView;
  onDownload: (file: CatalogueFile) => void;
}) {
  const [path, setPath] = useState("");
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<{
    file: CatalogueFile;
    x: number;
    y: number;
  }>();
  const folder = folderAt(view.root, path) ?? view.root;
  const entries: Entry[] = [
    ...folder.folders.map((child): Entry => ({
      kind: "folder",
      folder: child,
    })),
    ...folder.files.map((file): Entry => ({ kind: "file", file })),
  ];
  return (
    <div className="dc-frame dc-filelist">
      <div className="dc-tree-split">
        <ul
          className="dc-tree"
          role="tree"
          aria-label={`${view.nick}'s folders`}
        >
          <Tree
            folder={view.root}
            current={path}
            onPick={setPath}
            label={view.nick}
          />
        </ul>
        <ListView
          label={`${view.nick}'s files`}
          columns={COLUMNS}
          rows={entries}
          rowKey={(entry) =>
            entry.kind === "folder"
              ? `d:${entry.folder.path}`
              : `f:${entry.file.name}`
          }
          selected={selected}
          onSelect={setSelected}
          onOpen={(entry) => {
            if (entry.kind === "folder") setPath(entry.folder.path);
            else onDownload(entry.file);
          }}
          onContextMenu={(entry, position) => {
            if (entry.kind === "file")
              setMenu({ file: entry.file, ...position });
          }}
        />
      </div>
      <div className="dc-framestatus">
        <span className="dc-cell dc-grow">Files: {countFiles(view.root)}</span>
        <span className="dc-cell">Size: {formatBytes(view.root.size)}</span>
        <span className="dc-cell">Items: {entries.length}</span>
        <span className="dc-cell">Size: {formatBytes(folder.size)}</span>
      </div>
      {menu ? (
        <ContextMenu
          label="File"
          position={{ x: menu.x, y: menu.y }}
          items={[
            {
              label: "Download",
              bold: true,
              onSelect: () => onDownload(menu.file),
            },
            { label: "Download to...", disabled: true },
            { label: "View as text", disabled: true },
          ]}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}
