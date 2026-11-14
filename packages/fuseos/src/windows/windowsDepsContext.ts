import type { ComponentType, ReactNode } from "react";
import { createContext } from "react";

import { RndWindowFrame } from "./RndWindowFrame";
import type { Rect, Size } from "./windowManager";

export type WindowFrameProps = {
  id: string;
  /** Logical desktop pixels per CSS pointer pixel when a retro resolution is fitted. */
  scale?: number;
  rect: Rect;
  maximized: boolean;
  resizable?: boolean;
  active: boolean;
  zIndex: number;
  onFocus: () => void;
  onRectChange: (rect: Rect) => void;
  children: ReactNode;
};

export type WindowsDeps = {
  WindowFrame: ComponentType<WindowFrameProps>;
  getViewport: () => Size;
  subscribeViewport: (onChange: () => void) => () => void;
};

export const defaultWindowsDeps: WindowsDeps = {
  WindowFrame: RndWindowFrame,
  getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  subscribeViewport: (onChange) => {
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  },
};

export const WindowsDepsContext =
  createContext<WindowsDeps>(defaultWindowsDeps);
