import type { AgentTool } from "../agenttools/agentTool";

import type {
  AgentChecklistItem,
  AgentCompletion,
  AgentCompletionRequest,
  AgentTimers,
} from "./agentLoop";
import type { AssistantTool, ToolCallEvent } from "./tools";

/**
 * The chat behind the Office Assistant's balloon, as the balloon sees it. In FuseOS an in-browser model
 * (`@mlc-ai/web-llm`, loaded lazily on the first question) answers through `useClippyChat`; a browser without
 * WebGPU gets the rule-based intent engine instead, and `useNoChat` is the hook for a host with no chat at all.
 */
export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  /** The assistant's reply is still streaming in. */
  isStreaming?: boolean;
};

/** What answers: nothing, the rules, or a model (which may still have to be downloaded). */
export type ChatBackend =
  | { kind: "none" }
  | { kind: "rules"; reason: string }
  | { kind: "model"; modelId: string; label: string };

/** The conversation, streaming state and the controls. A React hook so an implementation can own state. */
export type ChatHandle = {
  messages: ChatMessage[];
  send: (text: string) => Promise<void>;
  isStreaming: boolean;
  /** What the assistant is doing while nothing has streamed yet ("Downloading the model 42%"); null when idle. */
  progress: string | null;
  error: string | null;
  backend: ChatBackend;
  reset: () => void;
  abort: () => void;
};

/** What the desktop tells the chat about itself before every request. */
export type ChatOptions = {
  /** A plain-text description of the desktop: the games installed, the windows open. */
  getAppContext: () => string;
  /** The assistant's standing instructions (personality, the games, the tools); the app context is appended. */
  getSystemPrompt?: () => string;
  /** The tools a reply may invoke through `[name:argument]` markers; see `llm/tools.ts`. */
  tools?: readonly AssistantTool[];
  /** Reports each tool call as it starts and ends, for the balloon and the character. */
  onToolCall?: (event: ToolCallEvent) => void;
  /** What the agent loop needs, for an engine whose model can drive it (`ChatEngine.loopStyle`). */
  agent?: AgentChatOptions;
};

/** The agent loop's side of the desktop: the typed tools, their prompt and the clock for the step timeouts. */
export type AgentChatOptions = {
  tools: readonly AgentTool[];
  /** Clippy's instructions for the loop (`buildAgentPrompt`); the app context is appended. */
  getPrompt: () => string;
  timers: AgentTimers;
  /** The parts of a request the loop holds the model to (`requestChecklist`); none when absent. */
  checklist?: (request: string) => readonly AgentChecklistItem[];
  /** Lets the desktop re-render between steps; defaults to a turn of the event loop. */
  settle?: () => Promise<void>;
  maxSteps?: number;
};

/**
 * How a model's reply acts on the desktop: "markers" is one reply ending in `[name:argument]` markers (the
 * small models and the rules); "json" and "native" are the multi-step agent loop (`agentLoop.ts`).
 */
export type LoopStyle = "markers" | "json" | "native";

/** One line of the conversation as a model sees it. */
export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ReplyRequest = {
  system: string;
  /** The conversation so far, the new question last. */
  messages: readonly LlmMessage[];
  signal: AbortSignal;
  /** Progress before the first token streams ("Downloading the model 42%"). */
  onProgress: (text: string) => void;
};

/**
 * What produces a reply: the web-llm engine or the rule-based intent engine. Both stream text that may carry
 * tool markers, so one hook (`useEngineChat`) renders and executes either.
 */
export interface ChatEngine {
  /** Who answers right now; an engine may change its mind (a model that failed to load falls back to the rules). */
  backend(): ChatBackend;
  reply(request: ReplyRequest): AsyncIterable<string>;
  /** How replies act right now; absent means "markers". A model that failed to load goes back to "markers". */
  loopStyle?(): LoopStyle;
  /**
   * Loads the model ahead of the agent loop, so a download does not count against a step's timeout. Rejects
   * when the model cannot load; `loopStyle()` then says "markers" and the caller asks `reply` instead.
   */
  ready?(onProgress: (text: string) => void): Promise<void>;
  /** One whole reply for the agent loop (the model loads first if `ready` was not awaited). */
  complete?(
    request: AgentCompletionRequest & { onProgress: (text: string) => void },
  ): Promise<AgentCompletion>;
  /** Releases the model; the next reply loads it again. */
  dispose(): void;
}

const NO_CHAT: ChatHandle = {
  messages: [],
  send: async () => undefined,
  isStreaming: false,
  progress: null,
  error: null,
  backend: { kind: "none" },
  reset: () => undefined,
  abort: () => undefined,
};

/** The chat hook when no model is wired in: nothing is ever sent. */
export function useNoChat(_options: ChatOptions): ChatHandle {
  return NO_CHAT;
}
