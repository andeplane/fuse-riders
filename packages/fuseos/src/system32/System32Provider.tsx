import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";

import { BlueScreen, RestartScreen } from "./BlueScreen";
import { mangleTitle } from "./mangleTitle";
import { System32ConfirmDialog } from "./System32ConfirmDialog";
import type { FoldDemo } from "./system32Deps";
import { System32DepsContext } from "./system32Deps";
import type { System32State } from "./system32Machine";
import {
  BSOD_MS,
  currentStage,
  FOLD_STAGES,
  IDLE,
  nextDelay,
  reduceSystem32,
  stageClassNames,
  titlesMangled,
} from "./system32Machine";

/** What the rest of the desktop sees: the state, and the few things it may do to it. */
export type System32Handle = {
  state: System32State;
  /** The fake folder is no longer there: Explorer hides its entry while this is true. */
  folderGone: boolean;
  /** Explorer calls this when the user removes the fake SYSTEM32 folder; the first question opens. */
  removeSystem32: () => void;
  /** "Yes" on the open question. */
  confirm: () => void;
  /** "No" on the open question. */
  cancel: () => void;
  /** Any key on the blue screen. */
  restart: () => void;
  /** Straight to the blue screen and the restart, from a quiet desktop (Start > Run..., `bsod`). */
  crash: () => void;
};

const noop = () => undefined;

/** Outside a provider (a component test, a storybook) nothing ever folds. */
export const idleSystem32Handle: System32Handle = {
  state: IDLE,
  folderGone: false,
  removeSystem32: noop,
  confirm: noop,
  cancel: noop,
  restart: noop,
  crash: noop,
};

export const System32Context =
  createContext<System32Handle>(idleSystem32Handle);

export function useSystem32(): System32Handle {
  return useContext(System32Context);
}

/** The title a window should show right now: misspelt once the "titles" stage has landed. */
export function useSystem32Title(title: string): string {
  const { state } = useSystem32();
  return titlesMangled(state) ? mangleTitle(title) : title;
}

function initialState(demo: FoldDemo | undefined): System32State {
  switch (demo?.kind) {
    case "now":
      return { phase: "confirming", step: 0 };
    case "stage":
      return reduceSystem32(IDLE, { type: "jumpTo", stage: demo.stage });
    case "bsod":
      return { phase: "crashed" };
    default:
      return IDLE;
  }
}

export type System32ProviderProps = { children: ReactNode };

/**
 * Owns the fold: runs the state machine on the injected scheduler, puts the stage classes on the
 * root it renders around the desktop, and draws the questions, the blue screen and the restart.
 * Unmounting it (or the restart) restores everything: no state outlives the component.
 */
export function System32Provider({ children }: System32ProviderProps) {
  const deps = useContext(System32DepsContext);
  const [state, dispatch] = useReducer(reduceSystem32, deps.demo, initialState);

  // `?fold=stage:N` is for looking at a stage: hold it there rather than running on to the crash.
  const held =
    deps.demo?.kind === "stage" &&
    state.phase === "folding" &&
    state.stage === Math.min(deps.demo.stage, FOLD_STAGES.length);

  useEffect(() => {
    if (held) return;
    const delay = nextDelay(state);
    if (delay === null) return;
    const { scheduler, showBsod } = deps;
    if (state.phase === "crashed" && showBsod) {
      // The host's blue screen decides when the restart follows; a plain call gets the default hold.
      let live = true;
      const shown = showBsod();
      if (shown instanceof Promise) {
        void shown.then(
          () => live && dispatch({ type: "elapsed" }),
          () => live && dispatch({ type: "elapsed" }),
        );
        return () => {
          live = false;
        };
      }
      const handle = scheduler.setTimeout(
        () => dispatch({ type: "elapsed" }),
        BSOD_MS,
      );
      return () => scheduler.clearTimeout(handle);
    }
    const handle = scheduler.setTimeout(
      () => dispatch({ type: "elapsed" }),
      delay,
    );
    return () => scheduler.clearTimeout(handle);
  }, [state, deps, held]);

  const removeSystem32 = useCallback(() => dispatch({ type: "remove" }), []);
  const confirm = useCallback(() => dispatch({ type: "confirm" }), []);
  const cancel = useCallback(() => dispatch({ type: "cancel" }), []);
  const restart = useCallback(() => dispatch({ type: "restart" }), []);
  const crash = useCallback(() => dispatch({ type: "crash" }), []);

  const handle = useMemo<System32Handle>(
    () => ({
      state,
      folderGone: state.phase !== "idle" && state.phase !== "confirming",
      removeSystem32,
      confirm,
      cancel,
      restart,
      crash,
    }),
    [state, removeSystem32, confirm, cancel, restart, crash],
  );

  const stage = currentStage(state);
  return (
    <System32Context.Provider value={handle}>
      <div
        className={["s32-root", ...stageClassNames(state)].join(" ")}
        data-system32={state.phase}
      >
        {children}
        {state.phase === "confirming" ? (
          <System32ConfirmDialog
            step={state.step}
            onYes={confirm}
            onNo={cancel}
          />
        ) : null}
        {stage ? (
          <p
            className="s32-caption win98"
            data-testid="s32-caption"
            aria-live="polite"
            key={stage.id}
          >
            {stage.caption}
          </p>
        ) : null}
        {state.phase === "crashed" && !deps.showBsod ? (
          <BlueScreen onAnyKey={restart} />
        ) : null}
        {state.phase === "restarting" ? <RestartScreen /> : null}
      </div>
    </System32Context.Provider>
  );
}
