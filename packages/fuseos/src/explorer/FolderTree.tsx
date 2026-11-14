import type { DiskEntry } from "../disk/diskEntries";
import { MY_COMPUTER } from "../disk/diskPath";
import type { IconName } from "../ui/icons";
import { Win98Icon } from "../ui/icons";

export type FolderTreeProps = {
  width: number;
  currentLocation: string;
  expanded: ReadonlySet<string>;
  /** The folders (and drives) directly under a location; files never show in the tree. */
  childrenOf: (location: string) => DiskEntry[];
  onToggle: (location: string) => void;
  onNavigate: (location: string) => void;
};

type NodeProps = Omit<FolderTreeProps, "width"> & {
  location: string;
  name: string;
  icon: IconName;
  depth: number;
};

function TreeNode({
  location,
  name,
  icon,
  depth,
  currentLocation,
  expanded,
  childrenOf,
  onToggle,
  onNavigate,
}: NodeProps) {
  const isExpanded = expanded.has(location);
  const isCurrent = currentLocation === location;
  const children = isExpanded ? childrenOf(location) : [];
  return (
    <li>
      <div
        className="flex items-center gap-1"
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          className="flat h-4 w-4 shrink-0 border border-[grey] bg-white p-0 text-[10px] leading-none"
          aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
          onClick={() => onToggle(location)}
        >
          {isExpanded ? "-" : "+"}
        </button>
        <a
          href="#"
          aria-current={isCurrent ? "page" : undefined}
          className={`flex items-center gap-1 whitespace-nowrap px-0.5 ${isCurrent ? "selected-label" : ""}`}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(location);
          }}
        >
          <Win98Icon
            name={isCurrent && icon === "folder" ? "folderOpen" : icon}
          />
          {name}
        </a>
      </div>
      {isExpanded ? (
        <ul>
          {children.map((child) => (
            <TreeNode
              key={child.location}
              location={child.location}
              name={child.name}
              icon={child.icon}
              depth={depth + 1}
              currentLocation={currentLocation}
              expanded={expanded}
              childrenOf={childrenOf}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** The "Folders" pane: My Computer, the drives and whatever has been expanded. */
export function FolderTree({ width, ...props }: FolderTreeProps) {
  return (
    <div
      className="flex shrink-0 flex-col border-r border-white"
      style={{ width }}
    >
      <div className="border-b border-[grey] px-1 py-0.5">Folders</div>
      <ul className="tree-view flex-1 overflow-auto" aria-label="Folders">
        <TreeNode
          location={MY_COMPUTER}
          name="My Computer"
          icon="computer"
          depth={0}
          {...props}
        />
      </ul>
    </div>
  );
}
