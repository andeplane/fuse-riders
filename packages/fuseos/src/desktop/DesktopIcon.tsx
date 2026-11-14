import { matchShortcut } from "../lib/shortcuts";
import type { IconName } from "../ui/icons";
import { Win98Icon } from "../ui/icons";
import type { MenuPosition } from "../windows/menuPosition";
import {
  isContextMenuKey,
  menuPositionAt,
  menuPositionFor,
} from "../windows/menuPosition";

/** A Fuse game's tile: its accent square with its one-to-three character mark, like the portal draws it. */
export type GameTile = { kind: "tile"; mark: string; accent: string };

export type DesktopIconArt = IconName | GameTile;

export type DesktopIconProps = {
  label: string;
  icon: DesktopIconArt;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  /** Right click, Shift+F10 or the menu key; the position is in viewport coordinates. */
  onContextMenu?: (position: MenuPosition) => void;
};

/** The generated icon of a Fuse game: an accent square with the mark, crisp at 32px. */
export function GameTileIcon({ mark, accent }: Omit<GameTile, "kind">) {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 32 32"
      aria-hidden
      data-icon="tile"
      style={{ imageRendering: "pixelated" }}
    >
      <rect x={1} y={1} width={30} height={30} fill={accent} stroke="#000" />
      <rect x={3} y={3} width={26} height={2} fill="#fff" fillOpacity={0.5} />
      <text
        x={16}
        y={21}
        textAnchor="middle"
        fontFamily="'Pixelated MS Sans Serif', Arial, sans-serif"
        fontSize={mark.length > 2 ? 10 : 13}
        fontWeight="bold"
        fill="#fff"
        stroke="#000"
        strokeWidth={0.6}
        paintOrder="stroke"
      >
        {mark}
      </text>
    </svg>
  );
}

export function DesktopIcon({
  label,
  icon,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
}: DesktopIconProps) {
  return (
    <button
      type="button"
      className="flat flex w-20 flex-col items-center gap-1 text-center text-white"
      style={{ minWidth: 0, textShadow: "1px 1px #000" }}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu?.(menuPositionAt(event));
      }}
      onKeyDown={(event) => {
        if (matchShortcut(event, "desktop.openIcon")) onOpen();
        if (isContextMenuKey(event)) {
          event.preventDefault();
          onContextMenu?.(menuPositionFor(event.currentTarget));
        }
      }}
    >
      {typeof icon === "string" ? (
        <Win98Icon name={icon} size={32} />
      ) : (
        <GameTileIcon mark={icon.mark} accent={icon.accent} />
      )}
      <span
        className={`px-0.5 leading-tight ${selected ? "selected-label" : ""}`}
      >
        {label}
      </span>
    </button>
  );
}
