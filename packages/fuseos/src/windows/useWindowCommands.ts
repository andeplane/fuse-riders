import { useCallback, useMemo } from "react";

import type { WindowContent } from "../state/appState";
import { useAppState } from "../state/useAppState";

export type WindowCommands = {
  open: (content: WindowContent, id?: string) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  showError: (title: string, message: string) => void;
  showInfo: (title: string, message: string) => void;
};

/** Commands over the stored window list. Safe to call from any view model. */
export function useWindowCommands(): WindowCommands {
  const { dispatch } = useAppState();
  const open = useCallback(
    (content: WindowContent, id?: string) =>
      dispatch({ type: "open", content, id }),
    [dispatch],
  );
  const close = useCallback(
    (id: string) => dispatch({ type: "close", id }),
    [dispatch],
  );
  const focus = useCallback(
    (id: string) => dispatch({ type: "focus", id }),
    [dispatch],
  );
  const minimize = useCallback(
    (id: string) => dispatch({ type: "minimize", id }),
    [dispatch],
  );
  const toggleMaximize = useCallback(
    (id: string) => dispatch({ type: "toggleMaximize", id }),
    [dispatch],
  );
  const showError = useCallback(
    (title: string, message: string) =>
      open({ kind: "dialog", title, message, icon: "warning" }),
    [open],
  );
  const showInfo = useCallback(
    (title: string, message: string) =>
      open({ kind: "dialog", title, message, icon: "info" }),
    [open],
  );
  return useMemo(
    () => ({
      open,
      close,
      focus,
      minimize,
      toggleMaximize,
      showError,
      showInfo,
    }),
    [open, close, focus, minimize, toggleMaximize, showError, showInfo],
  );
}
