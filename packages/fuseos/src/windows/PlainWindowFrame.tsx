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
  // The host already stops above the taskbar (Desktop.tsx, `bottom-7`), so a maximized window fills it.
  const style = maximized
    ? {
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
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
