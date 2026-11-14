/**
 * The chat behind the Office Assistant's balloon, as the balloon sees it. Phase B (B4) puts an in-browser
 * model (`@mlc-ai/web-llm`, loaded lazily on the first question) behind this; until then `useNoChat` answers.
 */
export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  /** The assistant's reply is still streaming in. */
  isStreaming?: boolean;
};

/** The conversation, streaming state and the controls. A React hook so an implementation can own state. */
export type ChatHandle = {
  messages: ChatMessage[];
  send: (text: string) => Promise<void>;
  isStreaming: boolean;
  /** What the assistant is doing while nothing has streamed yet ("Downloading the model 42%"); null when idle. */
  progress: string | null;
  error: string | null;
  reset: () => void;
  abort: () => void;
};

/** What the desktop tells the chat about itself before every request. */
export type ChatOptions = {
  /** A plain-text description of the desktop: the games installed, the windows open. */
  getAppContext: () => string;
};

const NO_CHAT: ChatHandle = {
  messages: [],
  send: async () => undefined,
  isStreaming: false,
  progress: null,
  error: null,
  reset: () => undefined,
  abort: () => undefined,
};

/** The chat hook when no model is wired in: nothing is ever sent. */
export function useNoChat(_options: ChatOptions): ChatHandle {
  return NO_CHAT;
}
