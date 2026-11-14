import type { IconName } from "../ui/icons";
import { Win98Icon } from "../ui/icons";

export type ToolbarButtonDef = {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
};

export type ToolbarProps = { groups: ToolbarButtonDef[][] };

/** Explorer's button bar: Back, Forward, Up, the panes and the views, in groups split by a bar. */
export function Toolbar({ groups }: ToolbarProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-[grey] px-1 py-0.5"
      role="toolbar"
      aria-label="Explorer toolbar"
    >
      {groups.map((group, index) => (
        <div key={index} className="flex items-center gap-0.5">
          {index > 0 ? (
            <span
              className="mx-1 inline-block h-6 w-px border-l border-[grey] border-r-white"
              aria-hidden
            />
          ) : null}
          {group.map((button) => (
            <button
              key={button.label}
              type="button"
              className={`toolbar-button flex flex-col items-center px-1 ${button.pressed ? "pressed" : ""}`}
              aria-label={button.label}
              aria-pressed={button.pressed}
              disabled={button.disabled}
              onClick={button.onClick}
            >
              <Win98Icon name={button.icon} />
              <span className="text-[10px]">{button.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
