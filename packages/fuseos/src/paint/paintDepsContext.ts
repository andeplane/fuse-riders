import { createContext } from "react";

import type { PaintFileDeps } from "./paintFiles";
import { createBrowserPaintFileDeps } from "./paintFiles";
import type { PaintSurface } from "./paintSurface";
import { createCanvasSurface } from "./paintSurface";

/** Browser pieces Paint needs, injected so tests run without a 2D context, a file picker or downloads. */
export type PaintDeps = {
  createSurface: (canvas: HTMLCanvasElement) => PaintSurface;
  /** File > Open, File > Save and opening an image by URL. */
  files: PaintFileDeps;
};

export const defaultPaintDeps: PaintDeps = {
  createSurface: createCanvasSurface,
  files: createBrowserPaintFileDeps(),
};

export const PaintDepsContext = createContext<PaintDeps>(defaultPaintDeps);
