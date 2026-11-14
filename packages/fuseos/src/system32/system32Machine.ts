/**
 * The "delete SYSTEM32" gag as a pure state machine. Nothing here touches a file system, a
 * timer or the DOM: the reducer maps events to states, `nextDelay` says how long the current
 * state waits before it advances on its own, and the provider (System32Provider.tsx) feeds
 * those waits to an injected scheduler. Everything is cosmetic and lives in memory only.
 */

/** One cosmetic step of the collapse: the class the desktop root gains and what Clippy says about it. */
export type FoldStage = {
  id: string;
  /** Added to the desktop root (and kept by every later stage) while the OS is folding. */
  className: string;
  /** Milliseconds after the previous stage (or after the last confirmation for the first one). */
  delayMs: number;
  /** What the Office Assistant would say when this stage lands; shown by the overlay's caption too. */
  caption: string;
};

/** The ~60 second collapse, in order. Icons go one by one first, then the fonts, the titles, the Start button and Clippy. */
export const FOLD_STAGES: readonly FoldStage[] = [
  {
    id: "icons-1",
    className: "s32-icons-1",
    delayMs: 2_000,
    caption: "Hm. Where did that icon go?",
  },
  {
    id: "icons-2",
    className: "s32-icons-2",
    delayMs: 4_000,
    caption: "Another one. This is fine.",
  },
  {
    id: "icons-3",
    className: "s32-icons-3",
    delayMs: 4_000,
    caption: "The desktop looks roomier, at least.",
  },
  {
    id: "comic-sans",
    className: "s32-comic-sans",
    delayMs: 5_000,
    caption: "Why is everything suddenly so... friendly?",
  },
  {
    id: "titles",
    className: "s32-titles",
    delayMs: 7_000,
    caption: "The window titles are getting creative.",
  },
  {
    id: "start-wobble",
    className: "s32-start-wobble",
    delayMs: 8_000,
    caption: "The Start button has lost its footing.",
  },
  {
    id: "assistant-alarmed",
    className: "s32-assistant-alarmed",
    delayMs: 8_000,
    caption:
      "It looks like you're deleting the operating system. Would you like help?!",
  },
  {
    id: "icons-all",
    className: "s32-icons-all",
    delayMs: 8_000,
    caption: "No icons. No problem. Probably.",
  },
  {
    id: "tilt",
    className: "s32-tilt",
    delayMs: 7_000,
    caption: "Is the screen... leaning?",
  },
  {
    id: "flicker",
    className: "s32-flicker",
    delayMs: 5_000,
    caption: "I have a bad feeling about this.",
  },
];

/** The time from the last "Yes" to the blue screen: the sum of the stage delays plus the last stage's hold. */
export const CRASH_AFTER_LAST_STAGE_MS = 2_000;
export const TOTAL_FOLD_MS =
  FOLD_STAGES.reduce((sum, stage) => sum + stage.delayMs, 0) +
  CRASH_AFTER_LAST_STAGE_MS;

/** How long the blue screen stays before the restart, and how long the restart screen shows. */
export const BSOD_MS = 6_000;
export const RESTART_MS = 2_500;

/** The three escalating questions, in order; "Yes" on the last one starts the fold. */
export const CONFIRMATIONS: readonly { title: string; message: string }[] = [
  {
    title: "Confirm Folder Delete",
    message:
      "Are you sure you want to remove the folder 'SYSTEM32' and all its contents?",
  },
  {
    title: "Confirm Folder Delete",
    message: "FuseOS really likes this folder. Really?",
  },
  {
    title: "Confirm Folder Delete",
    message: "OK, you asked for it.",
  },
];

export type ConfirmStep = 0 | 1 | 2;

export type System32State =
  | { phase: "idle" }
  | { phase: "confirming"; step: ConfirmStep }
  /** `stage` is how many of FOLD_STAGES have landed: 0 before the first, FOLD_STAGES.length after the last. */
  | { phase: "folding"; stage: number }
  | { phase: "crashed" }
  | { phase: "restarting" };

export const IDLE: System32State = { phase: "idle" };

export type System32Event =
  /** The user removed the fake folder in Explorer: ask the first question. */
  | { type: "remove" }
  /** "Yes" on the current question. */
  | { type: "confirm" }
  /** "No" or Escape on a question: nothing happens, as nothing ever does. */
  | { type: "cancel" }
  /** The scheduler says the current wait is over. */
  | { type: "elapsed" }
  /** Skip the questions and the waits and land on a stage directly (demo trigger, screenshots). */
  | { type: "jumpTo"; stage: number }
  /** Straight to the blue screen from a quiet desktop (Start > Run..., `bsod`), then the usual restart. */
  | { type: "crash" }
  /** Any key on the blue screen, or the demo trigger: restart now. */
  | { type: "restart" }
  /** Give up wherever we are (unmount, demo reset) and restore the desktop. */
  | { type: "abort" };

function clampStage(stage: number): number {
  if (!Number.isFinite(stage)) return 0;
  return Math.max(0, Math.min(FOLD_STAGES.length, Math.trunc(stage)));
}

export function reduceSystem32(
  state: System32State,
  event: System32Event,
): System32State {
  switch (event.type) {
    case "remove":
      return state.phase === "idle" ? { phase: "confirming", step: 0 } : state;
    case "confirm": {
      if (state.phase !== "confirming") return state;
      if (state.step === 2) return { phase: "folding", stage: 0 };
      return { phase: "confirming", step: state.step === 0 ? 1 : 2 };
    }
    case "cancel":
      return state.phase === "confirming" ? IDLE : state;
    case "elapsed":
      switch (state.phase) {
        case "folding":
          return state.stage >= FOLD_STAGES.length
            ? { phase: "crashed" }
            : { phase: "folding", stage: state.stage + 1 };
        case "crashed":
          return { phase: "restarting" };
        case "restarting":
          return IDLE;
        default:
          return state;
      }
    case "jumpTo":
      return { phase: "folding", stage: clampStage(event.stage) };
    case "crash":
      return state.phase === "idle" ? { phase: "crashed" } : state;
    case "restart":
      return state.phase === "crashed" ? { phase: "restarting" } : state;
    case "abort":
      return IDLE;
  }
}

/** How long the state waits before `elapsed` should be dispatched; null when it waits for the user. */
export function nextDelay(state: System32State): number | null {
  switch (state.phase) {
    case "folding": {
      const next = FOLD_STAGES[state.stage];
      return next ? next.delayMs : CRASH_AFTER_LAST_STAGE_MS;
    }
    case "crashed":
      return BSOD_MS;
    case "restarting":
      return RESTART_MS;
    default:
      return null;
  }
}

/** The classes the desktop root carries in this state: every stage that has landed, plus the phase. */
export function stageClassNames(state: System32State): string[] {
  switch (state.phase) {
    case "folding":
      return [
        "s32-folding",
        ...FOLD_STAGES.slice(0, state.stage).map((stage) => stage.className),
      ];
    case "crashed":
      return ["s32-crashed"];
    case "restarting":
      return ["s32-restarting"];
    default:
      return [];
  }
}

/** The stage that landed last, for its caption; null before the first or outside the fold. */
export function currentStage(state: System32State): FoldStage | null {
  if (state.phase !== "folding" || state.stage === 0) return null;
  return FOLD_STAGES[state.stage - 1] ?? null;
}

/** Whether the "titles" stage has landed, so window titles should be misspelt. */
export function titlesMangled(state: System32State): boolean {
  if (state.phase !== "folding") return false;
  const index = FOLD_STAGES.findIndex((stage) => stage.id === "titles");
  return index >= 0 && state.stage > index;
}
