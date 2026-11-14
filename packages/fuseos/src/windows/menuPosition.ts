/** Viewport coordinates of a context menu's top left corner. */
export type MenuPosition = { x: number; y: number };

/** Whether a key press asks for the context menu of the selection: Shift+F10 or the menu key. */
export function isContextMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

/** Where a keyboard-opened menu goes: just inside the top left corner of the element. */
export function menuPositionFor(element: Element): MenuPosition {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + 16, y: rect.top + 16 };
}

/** Where a pointer-opened menu goes: at the pointer. */
export function menuPositionAt(event: { clientX: number; clientY: number }): MenuPosition {
  return { x: event.clientX, y: event.clientY };
}
