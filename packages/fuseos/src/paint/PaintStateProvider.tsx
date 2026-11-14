import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { PaintSession } from "./paintSession";
import type { PaintAction } from "./paintState";
import { INITIAL_PAINT_STATE, PaintShadow, paintReducer } from "./paintState";
import { PaintStateContext } from "./paintStateContext";

/** Per window Paint state: tool, colours, dialogs and the drawing session. Rendered once per Paint window. */
export function PaintStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatchToReact] = useReducer(
    paintReducer,
    INITIAL_PAINT_STATE,
  );
  const [session] = useState(() => new PaintSession());
  const [shadow] = useState(() => new PaintShadow(INITIAL_PAINT_STATE));
  useEffect(() => shadow.sync(state), [shadow, state]);
  const dispatch = useCallback(
    (action: PaintAction) => {
      shadow.apply(action);
      dispatchToReact(action);
    },
    [shadow],
  );
  const value = useMemo(
    () => ({ state, dispatch, session, shadow }),
    [state, dispatch, session, shadow],
  );
  return (
    <PaintStateContext.Provider value={value}>
      {children}
    </PaintStateContext.Provider>
  );
}
