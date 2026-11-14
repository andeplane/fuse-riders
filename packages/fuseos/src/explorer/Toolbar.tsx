import { useState } from "react";

import type { ContextMenuItem } from "../windows/ContextMenu";
import { ContextMenu } from "../windows/ContextMenu";
import type { MenuPosition } from "../windows/menuPosition";

import { PixelIcon } from "./PixelIcon";
import type { PixelIconName } from "./pixelIcons";

export type ToolbarButtonDef = {
  label: string;
  icon: PixelIconName;
  /** Absent for a command this desktop does not have (the disk is read only): the button is always grey. */
  onClick?: () => void;
  disabled?: boolean;
  /** The drop-down beside the button (Back's history, the views); absent means no arrow. */
  menu?: ContextMenuItem[];
};

export type ToolbarProps = { groups: ToolbarButtonDef[][] };

/** Where a button's drop-down opens: flush under its bottom left corner. */
function menuPositionUnder(element: Element): MenuPosition {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

/**
 * Explorer's "Standard Buttons" band: flat buttons with a 20px picture over a text label, in groups
 * split by an etched bar, some with a drop-down arrow of their own.
 */
export function Toolbar({ groups }: ToolbarProps) {
  const [menu, setMenu] = useState<
    { label: string; position: MenuPosition } | undefined
  >(undefined);
  const openButton = groups
    .flat()
    .find((button) => button.label === menu?.label);

  return (
    <div
      className="explorer-toolbar"
      role="toolbar"
      aria-label="Explorer toolbar"
    >
      {groups.map((group, index) => (
        <div key={index} className="explorer-toolbar-group">
          {index > 0 ? (
            <span className="explorer-toolbar-separator" aria-hidden />
          ) : null}
          {group.map((button) => {
            const disabled = button.disabled || button.onClick === undefined;
            const menuDisabled =
              button.menu === undefined || button.menu.length === 0;
            return (
              <span key={button.label} className="explorer-toolbar-item">
                <button
                  type="button"
                  className="flat explorer-toolbar-button"
                  aria-label={button.label}
                  disabled={disabled}
                  onClick={button.onClick}
                >
                  <PixelIcon name={button.icon} disabled={disabled} />
                  <span className="explorer-toolbar-label">{button.label}</span>
                </button>
                {button.menu === undefined ? null : (
                  <button
                    type="button"
                    className="flat explorer-toolbar-arrow"
                    aria-label={`${button.label} menu`}
                    aria-haspopup="menu"
                    aria-expanded={menu?.label === button.label}
                    disabled={menuDisabled}
                    onClick={(event) =>
                      setMenu({
                        label: button.label,
                        position: menuPositionUnder(
                          event.currentTarget.parentElement ??
                            event.currentTarget,
                        ),
                      })
                    }
                  />
                )}
              </span>
            );
          })}
        </div>
      ))}
      {menu && openButton?.menu ? (
        <ContextMenu
          label={`${menu.label} menu`}
          position={menu.position}
          items={openButton.menu}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}
