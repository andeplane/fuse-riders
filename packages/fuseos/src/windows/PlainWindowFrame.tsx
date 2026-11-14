import { TASKBAR_HEIGHT } from "./windowManager";
import type { WindowFrameProps } from "./windowsDepsContext";

/** Static frame used in tests: no dragging, no resizing, no layout dependencies. */
export function PlainWindowFrame({
  id,
  rect,
  maximized,
  zIndex,
  onFocus,
  children,
}: WindowFrameProps) {
  const style = maximized
    ? {
        left: 0,
        top: 0,
        width: "100%",
        height: `calc(100% - ${TASKBAR_HEIGHT}px)`,
        zIndex,
      }
    : {
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        zIndex,
      };
  return (
    <div
      data-window-id={id}
      className="pointer-events-auto absolute"
      style={style}
      onMouseDown={onFocus}
    >
      {children}
    </div>
  );
}
