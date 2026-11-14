import { Rnd } from "react-rnd";

import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from "./windowManager";
import type { WindowFrameProps } from "./windowsDepsContext";

/** Draggable and resizable frame backed by react-rnd. Not used in tests (needs layout). */
export function RndWindowFrame({
  id,
  rect,
  maximized,
  resizable = true,
  scale = 1,
  zIndex,
  onFocus,
  onRectChange,
  children,
}: WindowFrameProps) {
  // One element for both states: swapping the frame for another on maximize would remount everything inside it,
  // and a game's page (an iframe) would load again from its front door, out of the room it was in.
  // The host already stops above the taskbar (Desktop.tsx, `bottom-7`), so a maximized window fills it.
  return (
    <Rnd
      data-window-id={id}
      className="pointer-events-auto"
      position={maximized ? { x: 0, y: 0 } : { x: rect.x, y: rect.y }}
      size={
        maximized
          ? { width: "100%", height: "100%" }
          : { width: rect.width, height: rect.height }
      }
      minWidth={MIN_WINDOW_WIDTH}
      minHeight={MIN_WINDOW_HEIGHT}
      enableResizing={resizable && !maximized}
      disableDragging={maximized}
      bounds="parent"
      scale={scale}
      dragHandleClassName="title-bar"
      style={{ zIndex }}
      onMouseDown={onFocus}
      onDragStop={(_event, data) =>
        onRectChange({ ...rect, x: data.x, y: data.y })
      }
      onResizeStop={(_event, _direction, element, _delta, position) =>
        onRectChange({
          x: position.x,
          y: position.y,
          width: element.offsetWidth,
          height: element.offsetHeight,
        })
      }
    >
      {children}
    </Rnd>
  );
}
