import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { fromMarkerTool } from "../agenttools/agentTool";
import { DesktopUiContext } from "../desktop/desktopUiContext";
import { FuseGamesContext } from "../fusegames/registry";
import type { ChatBackend, ChatMessage } from "../llm/llmChat";
import { requestChecklist } from "../llm/intent";
import { buildAgentPrompt, buildSystemPrompt } from "../llm/systemPrompt";
import type { AssistantTool, ToolCallEvent } from "../llm/tools";
import { useAppState } from "../state/useAppState";
import type { MenuPosition } from "../windows/menuPosition";
import { useWindowCommands } from "../windows/useWindowCommands";

import { AssistantDepsContext } from "./assistantDepsContext";
import type {
  AnimationRequest,
  AssistantSpeech,
  ToolCallReport,
} from "./assistantState";
import {
  assistantZIndex,
  currentMood,
  tipPrompt,
  visibleSpeech,
} from "./assistantState";
import { useRegisteredAssistantTools } from "./assistantToolsContext";
import { useDesktopTools } from "./desktopTools";
import type { SpriteAgent } from "./spritePlayer";

/** Marker tools of windows that a typed tool already covers in the agent loop (Notepad++'s `[edit:<path>]`: `edit_file`). */
export const SUPERSEDED_IN_AGENT: readonly string[] = ["edit"];

export const NO_CHAT_REASON =
  "Clippy cannot answer questions here: no chat is wired into this desktop. The tips still work.";
/** How long the GoodBye animation gets before the character is hidden. */
export const GOODBYE_MS = 1800;

export type GreetingAnswer = "yes" | "tip" | "no";

export type OfficeAssistantViewModel = {
  visible: boolean;
  balloonOpen: boolean;
  openBalloon: () => void;
  closeBalloon: () => void;
  toggleBalloon: () => void;
  /** Plays GoodBye, then hides the character (persisted). */
  hide: () => void;
  /** The Clippy frame table and sounds, once loaded. */
  agent: SpriteAgent | undefined;
  sounds: Record<string, string> | undefined;
  request: AnimationRequest | null;
  busy: boolean;
  animate: boolean;
  playSounds: boolean;
  /** Pointer over the character. */
  wave: () => void;
  speech: AssistantSpeech | null;
  dismissSpeech: () => void;
  nextTip: () => void;
  /** The question the current tip suggests, when it does; "Try this" sends it. */
  tipSuggestion: string | undefined;
  tryTip: () => void;
  showTips: boolean;
  greeting: boolean;
  answerGreeting: (answer: GreetingAnswer) => void;
  chat: {
    available: boolean;
    unavailableReason?: string;
    messages: ChatMessage[];
    isStreaming: boolean;
    progress: string | null;
    error: string | null;
    /** Who answers: the model, or the rules (with why) in a browser without WebGPU. */
    backend: ChatBackend;
    /** The tool calls of the current turn, for the inline status lines. */
    calls: readonly ToolCallReport[];
    /** Every tool a reply may invoke: the desktop's and the ones windows registered. */
    tools: readonly AssistantTool[];
  };
  ask: (text: string) => Promise<void>;
  newChat: () => void;
  stopChat: () => void;
  menu: MenuPosition | null;
  openMenu: (position: MenuPosition) => void;
  closeMenu: () => void;
  /** Control Panel, Assistant. */
  openOptions: () => void;
  zIndex: number;
};

/** Loads something once the character is shown; a failed load leaves it undefined (the sprite then shows a still). */
function useLoaded<T>(load: () => Promise<T>, enabled: boolean): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    if (!enabled || value !== undefined) return undefined;
    let cancelled = false;
    load()
      .then((loaded) => {
        if (!cancelled) setValue(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [load, enabled, value]);
  return value;
}

/**
 * The Office Assistant: the classic paperclip on the desktop whose balloon carries the greeting, tips and the
 * chat. Speech and animation requests live in DesktopUiProvider, hidden/shown in the persisted AppState.
 */
export function useOfficeAssistantViewModel(): OfficeAssistantViewModel {
  const { state, dispatch } = useAppState();
  const ui = useContext(DesktopUiContext);
  const deps = useContext(AssistantDepsContext);
  const games = useContext(FuseGamesContext);
  const commands = useWindowCommands();
  const {
    assistant,
    assistantDispatch,
    assistantOptions,
    setAssistantOptions,
  } = ui;

  const visible = !state.assistantHidden;

  const agent = useLoaded(deps.loadAgent, visible);
  const sounds = useLoaded(deps.loadSounds, visible && assistantOptions.sounds);
  const getAppContext = useCallback(
    () =>
      `FuseOS desktop. Games installed: ${games.games.map((game) => game.name).join(", ") || "none"}. Windows open: ${state.windows.map((window) => window.kind).join(", ") || "none"}.`,
    [games, state.windows],
  );
  const desktopTools = useDesktopTools();
  const registeredTools = useRegisteredAssistantTools();
  const tools = useMemo(
    () => [...desktopTools.tools, ...registeredTools],
    [desktopTools.tools, registeredTools],
  );
  // A small model is told about a few markers only; its context is short.
  const getSystemPrompt = useCallback(
    () =>
      buildSystemPrompt(desktopTools.prompt, [
        ...desktopTools.promptTools,
        ...registeredTools,
      ]),
    [desktopTools.prompt, desktopTools.promptTools, registeredTools],
  );
  const agentLoop = useMemo(() => {
    const agentTools = [
      ...desktopTools.agentTools,
      ...registeredTools
        .filter((tool) => !SUPERSEDED_IN_AGENT.includes(tool.name))
        .map(fromMarkerTool),
    ];
    return {
      tools: agentTools,
      getPrompt: () => buildAgentPrompt(desktopTools.prompt, agentTools),
      timers: { setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout },
      // The rules know what "open Paint and play music" comes to; the loop holds the model to both halves.
      checklist: (request: string) =>
        requestChecklist(request, desktopTools.intents),
    };
  }, [
    desktopTools.agentTools,
    desktopTools.prompt,
    desktopTools.intents,
    registeredTools,
    deps,
  ]);
  const onToolCall = useCallback(
    (event: ToolCallEvent) =>
      assistantDispatch({
        type: "toolCall",
        report: { ...event, origin: "chat" },
      }),
    [assistantDispatch],
  );
  const chat = deps.useChat({
    getAppContext,
    getSystemPrompt,
    tools,
    onToolCall,
    agent: agentLoop,
  });
  const available = deps.chatAvailable;
  const unavailableReason = available ? undefined : NO_CHAT_REASON;

  // The model is downloading or loading: the character processes until the first token.
  const wasLoading = useRef(false);
  useEffect(() => {
    const loading = chat.progress !== null && chat.progress !== "Thinking";
    if (loading && !wasLoading.current)
      assistantDispatch({ type: "chatLoading" });
    wasLoading.current = loading;
  }, [chat.progress, assistantDispatch]);

  // The first visit: greet, and open the balloon, until the greeting is answered.
  useEffect(() => {
    if (visible && !assistantOptions.greeted && assistant.speech === null) {
      assistantDispatch({ type: "greet" });
      ui.setAssistantOpen(true);
    }
    // Only on mount and when shown or greeted changes; a dismissed greeting stays dismissed.
  }, [visible, assistantOptions.greeted]);

  // The chat finished a turn: let the character comment on it.
  const wasStreaming = useRef(chat.isStreaming);
  useEffect(() => {
    if (wasStreaming.current && !chat.isStreaming)
      assistantDispatch({ type: "chatAnswered", failed: chat.error !== null });
    wasStreaming.current = chat.isStreaming;
  }, [chat.isStreaming, chat.error, assistantDispatch]);

  const busy = chat.isStreaming || currentMood(assistant) === "thinking";

  const hide = useCallback(() => {
    ui.setAssistantMenu(null);
    ui.setAssistantOpen(false);
    if (!assistantOptions.animate) {
      dispatch({ type: "setAssistantHidden", hidden: true });
      return;
    }
    assistantDispatch({ type: "hide" });
    deps.setTimeout(
      () => dispatch({ type: "setAssistantHidden", hidden: true }),
      GOODBYE_MS,
    );
  }, [ui, assistantOptions.animate, assistantDispatch, dispatch, deps]);

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "") return;
      if (!available) {
        assistantDispatch({ type: "notice", text: NO_CHAT_REASON });
        return;
      }
      assistantDispatch({ type: "chatSent" });
      await chat.send(trimmed);
    },
    [available, assistantDispatch, chat],
  );
  const tipSuggestion =
    assistant.speech &&
    (assistant.speech.kind === "tip" || assistant.speech.kind === "greeting")
      ? tipPrompt(assistant.speech.text)
      : undefined;

  const answerGreeting = useCallback(
    (answer: GreetingAnswer) => {
      setAssistantOptions({ greeted: true });
      if (answer === "tip") {
        assistantDispatch({ type: "nextTip" });
        return;
      }
      assistantDispatch({ type: "dismiss" });
      if (answer === "no") ui.setAssistantOpen(false);
      else if (!available)
        assistantDispatch({ type: "notice", text: NO_CHAT_REASON });
    },
    [setAssistantOptions, assistantDispatch, ui, available],
  );

  return {
    visible,
    balloonOpen: ui.assistantOpen,
    openBalloon: () => ui.setAssistantOpen(true),
    closeBalloon: () => ui.setAssistantOpen(false),
    toggleBalloon: () => ui.setAssistantOpen(!ui.assistantOpen),
    hide,
    agent,
    sounds,
    request: assistant.play,
    busy,
    animate: assistantOptions.animate,
    playSounds: assistantOptions.sounds,
    wave: () => assistantDispatch({ type: "wave" }),
    speech: visibleSpeech(assistant, assistantOptions),
    dismissSpeech: () => assistantDispatch({ type: "dismiss" }),
    nextTip: () => assistantDispatch({ type: "nextTip" }),
    tipSuggestion,
    tryTip: () => {
      if (!tipSuggestion) return;
      assistantDispatch({ type: "dismiss" });
      void ask(tipSuggestion);
    },
    showTips: assistantOptions.showTips,
    greeting: assistant.speech?.kind === "greeting",
    answerGreeting,
    chat: {
      available,
      unavailableReason,
      messages: chat.messages,
      isStreaming: chat.isStreaming,
      progress: chat.progress,
      error: chat.error,
      backend: chat.backend,
      calls: assistant.turnCalls,
      tools,
    },
    ask,
    newChat: () => {
      chat.reset();
      assistantDispatch({ type: "dismiss" });
    },
    stopChat: chat.abort,
    menu: ui.assistantMenu,
    openMenu: (position) => ui.setAssistantMenu(position),
    closeMenu: () => ui.setAssistantMenu(null),
    openOptions: () =>
      commands.open({ kind: "controlpanel", applet: "assistant" }),
    zIndex: assistantZIndex(state.windows),
  };
}
