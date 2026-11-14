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
};

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
