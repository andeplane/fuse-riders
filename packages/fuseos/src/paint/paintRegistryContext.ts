import { createContext } from "react";

import type { PaintControls } from "./paintControls";

export type { PaintStatus } from "./paintControls";

/**
 * Tool, colours, size and unsaved state are transient, so every mounted Paint window
 * publishes its live controls here by window id: the Office Assistant reads its status
 * and drives the same toolbox, palette and canvas the mouse does.
 */
export const PaintRegistryContext = createContext<Map<string, PaintControls>>(
  new Map(),
);
