import type { DiskEntry } from "../disk/diskEntries";
import type { IconName } from "../ui/icons";
import { Win98Icon } from "../ui/icons";

import { DESKTOP } from "./shellNamespace";

export type FolderTreeProps = {
  width: number;
  currentLocation: string;
  expanded: ReadonlySet<string>;
  /** The folders (and drives) directly under a location; files never show in the tree. */
  childrenOf: (location: string) => DiskEntry[];
  onToggle: (location: string) => void;
  /** A click on a folder: navigate there, or run the program a system folder stands for. */
  onActivate: (entry: DiskEntry) => void;
  /** The x in the pane's header. */
  onClose: () => void;
};

type NodeProps = Omit<FolderTreeProps, "width" | "onClose"> & {
  entry: DiskEntry;
  depth: number;
  /** For each ancestor below the root: whether its dotted line continues past this row. */
  guides: readonly boolean[];
  isFirst: boolean;
  isLast: boolean;
};

const DESKTOP_ENTRY: DiskEntry = {
  location: DESKTOP,
  name: "Desktop",
  kind: "folder",
  icon: "desktop",
  typeLabel: "System Folder",
  modified: false,
};

function nodeIcon(entry: DiskEntry, isCurrent: boolean): IconName {
  return isCurrent && entry.icon === "folder" ? "folderOpen" : entry.icon;
}

function TreeNode({
  entry,
  depth,
  guides,
  isFirst,
  isLast,
  currentLocation,
  expanded,
  childrenOf,
  onToggle,
  onActivate,
}: NodeProps) {
  const { location, name } = entry;
  const children = childrenOf(location);
  const hasChildren = children.length > 0;
  // The Desktop has no button of its own: it is always open.
  const isExpanded = hasChildren && (depth === 0 || expanded.has(location));
  const isCurrent = currentLocation === location;
  // Windows draws no lines at the root: the first folder under the Desktop has nothing above it.
  const branch = [
    "explorer-tree-branch",
    depth === 1 && isFirst ? "first" : "",
    isLast ? "last" : "",
  ].join(" ");
  return (
    <li role="none">
      <div className="explorer-tree-row">
        {guides.map((continues, index) => (
          <span
            key={index}
            className={`explorer-tree-guide ${continues ? "line" : ""}`}
            aria-hidden
          />
        ))}
        {depth > 0 ? (
          <span className={branch}>
            {hasChildren ? (
              <button
                type="button"
                className="flat explorer-tree-toggle"
                data-expanded={isExpanded ? "true" : "false"}
                aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
                onClick={() => onToggle(location)}
              />
            ) : null}
          </span>
        ) : null}
        <a
          href="#"
          role="treeitem"
          aria-current={isCurrent ? "page" : undefined}
          aria-expanded={hasChildren ? isExpanded : undefined}
          className="explorer-tree-item"
          onClick={(event) => {
            event.preventDefault();
            onActivate(entry);
          }}
          onDoubleClick={() => {
            if (hasChildren && depth > 0) onToggle(location);
          }}
        >
          <Win98Icon name={nodeIcon(entry, isCurrent)} />
          <span className="explorer-tree-label">{name}</span>
        </a>
      </div>
      {isExpanded ? (
        <ul role="group">
          {children.map((child, index) => (
            <TreeNode
              key={child.location}
              entry={child}
              depth={depth + 1}
              guides={depth > 0 ? [...guides, !isLast] : guides}
              isFirst={index === 0}
              isLast={index === children.length - 1}
              currentLocation={currentLocation}
              expanded={expanded}
              childrenOf={childrenOf}
              onToggle={onToggle}
              onActivate={onActivate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** The "All Folders" Explorer bar: the Desktop, My Computer, the drives and whatever has been expanded. */
export function FolderTree({ width, onClose, ...props }: FolderTreeProps) {
  return (
    <div className="explorer-folders" style={{ width }}>
      <div className="explorer-folders-header">
        <span>All Folders</span>
        <button
          type="button"
          className="flat"
          aria-label="Close All Folders"
          onClick={onClose}
        >
          <svg
            width={8}
            height={7}
            viewBox="0 0 8 7"
            shapeRendering="crispEdges"
            aria-hidden
          >
            <path
              fill="#000"
              d="M0 0h2v1h1v1h2v-1h1v-1h2v1h-1v1h-1v1h-1v1h1v1h1v1h1v1h-2v-1h-1v-1h-2v1h-1v1h-2v-1h1v-1h1v-1h1v-1h-1v-1h-1v-1h-1z"
            />
          </svg>
        </button>
      </div>
      <ul className="explorer-tree" role="tree" aria-label="Folders">
        <TreeNode
          entry={DESKTOP_ENTRY}
          depth={0}
          guides={[]}
          isFirst
          isLast
          {...props}
        />
      </ul>
    </div>
  );
}
