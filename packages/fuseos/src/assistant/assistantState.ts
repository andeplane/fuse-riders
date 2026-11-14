import type { WindowState } from "../state/appState";

/** How the character behaves: the animation family the current event asks for. */
export type AssistantMood = "idle" | "happy" | "thinking" | "idea" | "sorry";

export const ASSISTANT_MOODS: readonly AssistantMood[] = [
  "idle",
  "happy",
  "thinking",
  "idea",
  "sorry",
];

export function isAssistantMood(value: unknown): value is AssistantMood {
  return (
    typeof value === "string" && ASSISTANT_MOODS.some((mood) => mood === value)
  );
}

/** Why the balloon says what it says: the first-visit greeting, a tip, a narrated tool call, a remark from the chat, or a notice from the desktop. */
export type SpeechKind = "greeting" | "tip" | "narration" | "say" | "notice";

export type AssistantSpeech = {
  kind: SpeechKind;
  text: string;
  mood: AssistantMood;
  /** Bumped on every change so the balloon can tell a repeat from the same text. */
  seq: number;
};

/** One tool invocation reported by the chat (Phase B's intent runner), narrated or listed inline. */
export type ToolCallReport = {
  name: string;
  /** Plain words for the user, e.g. "Searching for pump...". */
  sentence: string;
  phase: "started" | "finished" | "failed";
  /** Where the call came from: narrated in the balloon (`sidebar`, the default) or listed inline in the chat. */
  origin?: "sidebar" | "chat";
};

/** A Clippy animation to play; `seq` restarts it even when the name repeats. */
export type AnimationRequest = { name: string; seq: number };

export type AssistantState = {
  speech: AssistantSpeech | null;
  /** Tool calls in flight; the character thinks while any is running. */
  busy: number;
  /** Index into ASSISTANT_TIPS of the tip shown last. */
  tipIndex: number;
  /** The animation the last event asked for. */
  play: AnimationRequest | null;
  /** Tool calls of the current in-app chat turn, in order, for the inline status lines. */
  turnCalls: ToolCallReport[];
};

export type AssistantAction =
  | { type: "toolCall"; report: ToolCallReport }
  | { type: "say"; text: string; mood?: AssistantMood }
  | { type: "notice"; text: string; mood?: AssistantMood }
  | { type: "greet" }
  | { type: "nextTip" }
  | { type: "dismiss" }
  /** The character appears (Greeting) or is about to go (GoodBye). */
  | { type: "show" }
  | { type: "hide" }
  /** The pointer is over the character. */
  | { type: "wave" }
  /** The user sent a chat message: a new turn starts. */
  | { type: "chatSent" }
  /** The chat is downloading or loading the model (Processing until the first token arrives). */
  | { type: "chatLoading" }
  /** The chat finished answering. */
  | { type: "chatAnswered"; failed?: boolean };

export const GREETING =
  "It looks like you're here to play. Would you like help?";

export const ASSISTANT_TIPS: readonly string[] = [
  "Every Fuse game on the desktop opens in a window of its own; double click one to start it.",
  'Tell me "Open Fuseball" and I will start it for you; any game or app on this desktop works.',
  'Say "Play some music" and I will fire up Winamp with the Fuse soundtrack.',
  "Start, Programs, Games, Retro Games has DOOM, Wolfenstein 3D, Commander Keen, Duke Nukem 3D, Minesweeper, Solitaire, SkiFree and Micropolis.",
  "Add ?open=fuseball to the address to boot straight into a game; several ids separated by commas open several windows.",
  'Ask me "Which games are there?" for the full list, taglines included.',
  "Paint is the real thing: brushes, shapes, fill and text on a 640x400 canvas.",
  "Control Panel, Display changes the background, icon spacing, colours and font size.",
  "My brain is a small model that downloads once (about 300 MB) and then runs on your graphics card. Nothing you type leaves this device; Control Panel, Assistant swaps or forgets it.",
  "Right click me for Options, or to hide me. Start, Help, Office Assistant brings me back.",
  'Pick Clippy Pro in Control Panel, Assistant and I work through a whole chore: "Open Paint, maximize it and play some music".',
];

/** The question a tip suggests, quoted inside its text, e.g. "Open Paint and draw a cat."; undefined when the tip suggests nothing to send. */
export function tipPrompt(text: string): string | undefined {
  const match = /"([^"]+)"/.exec(text);
  return match?.[1]?.trim() || undefined;
}

export const INITIAL_ASSISTANT_STATE: AssistantState = {
  speech: null,
  busy: 0,
  tipIndex: -1,
  play: null,
  turnCalls: [],
};

export const ASSISTANT_TOOL = "assistant";

/** The assistant's own tool is not narrated: narrating "Saying hello" would replace the hello. */
export function isAssistantTool(name: string): boolean {
  return name === ASSISTANT_TOOL || name.startsWith(`${ASSISTANT_TOOL}_`);
}

/** The Clippy animation for a mood, when the chat speaks or a tool ends. */
export const MOOD_ANIMATIONS: Record<AssistantMood, string> = {
  idle: "RestPose",
  happy: "Congratulate",
  thinking: "Thinking",
  idea: "GetAttention",
  sorry: "Alert",
};

/** What the character does while a tool runs; alternated per call. */
export const WORKING_ANIMATIONS = [
  "Thinking",
  "Searching",
  "Processing",
  "CheckingSomething",
] as const;

function speak(
  state: AssistantState,
  speech: Omit<AssistantSpeech, "seq">,
  animation: string = MOOD_ANIMATIONS[speech.mood],
): AssistantState {
  return play(
    { ...state, speech: { ...speech, seq: (state.speech?.seq ?? 0) + 1 } },
    animation,
  );
}

function workingAnimation(busy: number): string {
  return (
    WORKING_ANIMATIONS[busy % WORKING_ANIMATIONS.length] ??
    WORKING_ANIMATIONS[0]
  );
}

function tipAt(index: number): string {
  return ASSISTANT_TIPS[index] ?? "";
}

function play(state: AssistantState, name: string): AssistantState {
  return { ...state, play: { name, seq: (state.play?.seq ?? 0) + 1 } };
}

export function assistantReducer(
  state: AssistantState,
  action: AssistantAction,
): AssistantState {
  switch (action.type) {
    case "toolCall": {
      const { report } = action;
      if (isAssistantTool(report.name)) return state;
      if (report.origin === "chat") {
        const turnCalls =
          report.phase === "started"
            ? [...state.turnCalls, report]
            : state.turnCalls.map((call) =>
                call.name === report.name && call.phase === "started"
                  ? report
                  : call,
              );
        const busy =
          report.phase === "started"
            ? state.busy + 1
            : Math.max(0, state.busy - 1);
        return report.phase === "started"
          ? play({ ...state, turnCalls, busy }, workingAnimation(state.busy))
          : { ...state, turnCalls, busy };
      }
      if (report.phase === "started") {
        return speak(
          { ...state, busy: state.busy + 1 },
          { kind: "narration", text: report.sentence, mood: "thinking" },
          workingAnimation(state.busy),
        );
      }
      const busy = Math.max(0, state.busy - 1);
      if (report.phase === "failed") {
        return speak(
          { ...state, busy },
          {
            kind: "narration",
            text: `Hmm, that did not work. ${report.sentence}`,
            mood: "sorry",
          },
        );
      }
      // Finished: keep the sentence on screen and let the character explain.
      return speak(
        { ...state, busy },
        { kind: "narration", text: report.sentence, mood: "happy" },
        "Explain",
      );
    }
    case "say":
      return speak(state, {
        kind: "say",
        text: action.text,
        mood: action.mood ?? "happy",
      });
    case "notice":
      return speak(state, {
        kind: "notice",
        text: action.text,
        mood: action.mood ?? "sorry",
      });
    case "greet":
      // The first tip is part of the greeting, so a visitor sees it without asking.
      return speak(
        { ...state, tipIndex: 0 },
        {
          kind: "greeting",
          text: `${GREETING} ${ASSISTANT_TIPS[0]}`,
          mood: "idea",
        },
        "Greeting",
      );
    case "nextTip": {
      const tipIndex = (state.tipIndex + 1) % ASSISTANT_TIPS.length;
      return speak(
        { ...state, tipIndex },
        { kind: "tip", text: tipAt(tipIndex), mood: "idea" },
      );
    }
    case "dismiss":
      return { ...state, speech: null };
    case "show": {
      // A tip is on screen whenever the balloon opens with nothing else to say.
      if (state.speech) return play(state, "Greeting");
      const tipIndex = (state.tipIndex + 1) % ASSISTANT_TIPS.length;
      return speak(
        { ...state, tipIndex },
        { kind: "tip", text: tipAt(tipIndex), mood: "idea" },
        "Greeting",
      );
    }
    case "hide":
      return play(state, "GoodBye");
    case "wave":
      return state.busy > 0 ? state : play(state, "Wave");
    case "chatSent":
      return play({ ...state, turnCalls: [] }, "Writing");
    case "chatLoading":
      return play(state, "Processing");
    case "chatAnswered":
      return play(
        state,
        action.failed
          ? "Alert"
          : state.turnCalls.length > 0
            ? "Congratulate"
            : "Explain",
      );
  }
}

/** The mood the character shows now: thinking beats everything while a tool runs. */
export function currentMood(state: AssistantState): AssistantMood {
  if (state.busy > 0) return "thinking";
  return state.speech?.mood ?? "idle";
}

/** What the balloon should say given the user's options: narration and tips can be switched off. */
export function visibleSpeech(
  state: AssistantState,
  options: { narrate: boolean; showTips: boolean },
): AssistantSpeech | null {
  const { speech } = state;
  if (!speech) return null;
  if (speech.kind === "narration" && !options.narrate) return null;
  if (speech.kind === "tip" && !options.showTips) return null;
  return speech;
}

/**
 * The character renders above every window (windows sit at 10 + index) but
 * below any dialog, so a message box is never covered. It comes after the
 * windows in the DOM, so an equal z-index keeps it on top of that window and
 * under the dialog.
 */
export function assistantZIndex(
  windows: readonly Pick<WindowState, "kind" | "minimized">[],
): number {
  const dialogIndex = windows.findIndex(
    (window) => window.kind === "dialog" && !window.minimized,
  );
  if (dialogIndex === -1) return 10 + windows.length;
  return 10 + dialogIndex - 1;
}
