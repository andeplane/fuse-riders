import type { Dispatch } from "react";
import { createContext } from "react";

import type { PaintSession } from "./paintSession";
import type { PaintAction, PaintShadow, PaintState } from "./paintState";

/** One Paint window's state; `dispatch` updates the shadow synchronously and React afterwards. */
export type PaintStore = {
  state: PaintState;
  dispatch: Dispatch<PaintAction>;
  session: PaintSession;
  shadow: PaintShadow;
};

export const PaintStateContext = createContext<PaintStore | undefined>(
  undefined,
);
