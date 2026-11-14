import { Rnd } from 'react-rnd';

import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, TASKBAR_HEIGHT } from './windowManager';
import type { WindowFrameProps } from './windowsDepsContext';

/** Draggable and resizable frame backed by react-rnd. Not used in tests (needs layout). */
export function RndWindowFrame({ id, rect, maximized, resizable = true, scale = 1, zIndex, onFocus, onRectChange, children }: WindowFrameProps) {
  if (maximized) {
    return (
      <div
        data-window-id={id}
        className="pointer-events-auto absolute left-0 top-0 w-full"
        style={{ zIndex, height: `calc(100% - ${TASKBAR_HEIGHT}px)` }}
        onMouseDown={onFocus}
      >
        {children}
      </div>
    );
  }
  return (
    <Rnd
      data-window-id={id}
      className="pointer-events-auto"
      position={{ x: rect.x, y: rect.y }}
      size={{ width: rect.width, height: rect.height }}
      minWidth={MIN_WINDOW_WIDTH}
      minHeight={MIN_WINDOW_HEIGHT}
      enableResizing={resizable}
      bounds="parent"
      scale={scale}
      dragHandleClassName="title-bar"
      style={{ zIndex }}
      onMouseDown={onFocus}
      onDragStop={(_event, data) => onRectChange({ ...rect, x: data.x, y: data.y })}
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
