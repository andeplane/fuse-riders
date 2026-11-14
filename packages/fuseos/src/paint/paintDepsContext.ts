import { createContext } from 'react';

import type { PaintSurface } from './paintSurface';
import { createCanvasSurface } from './paintSurface';

/** Browser pieces Paint needs, injected so tests run without a 2D context. */
export type PaintDeps = {
  createSurface: (canvas: HTMLCanvasElement) => PaintSurface;
};

export const defaultPaintDeps: PaintDeps = {
  createSurface: createCanvasSurface,
};

export const PaintDepsContext = createContext<PaintDeps>(defaultPaintDeps);
