import { useSyncExternalStore } from "react";

import type {
  AssistantDeps,
  ChatHandle,
  ChatOptions,
} from "../assistant/assistantDepsContext";
import type { SpriteAgent, SpriteAnimation } from "../assistant/spritePlayer";
import type { ChatBackend, ChatMessage } from "../llm/llmChat";

function twoFrames(x: number): SpriteAnimation {
  return {
    frames: [
      { duration: 100, images: [[x, 0]] },
      { duration: 100, images: [[x + 124, 0]] },
    ],
  };
}

const NAMES = [
  "RestPose",
  "Greeting",
  "GoodBye",
  "Wave",
  "Thinking",
  "Searching",
  "Processing",
  "CheckingSomething",
  "Explain",
  "Congratulate",
  "GetAttention",
  "Alert",
  "Writing",
  "Idle1_1",
  "IdleSnooze",
];

/** A tiny Clippy frame table with the animations the assistant asks for, two frames each. */
export const FAKE_SPRITE_AGENT: SpriteAgent = {
  overlayCount: 1,
  sounds: ["1"],
  framesize: [124, 93],
  animations: Object.fromEntries(
    NAMES.map((name, index) => [name, twoFrames(index * 248)]),
  ),
};

export type FakeTimer = { id: number; callback: () => void; ms: number };

/** The fake chat as the tests drive it: what was sent, and knobs to script the conversation. */
export type FakeChatController = {
  sent: string[];
  lastOptions: ChatOptions | undefined;
  /** How the fake agent answers a message; default echoes it. */
  reply: (text: string) => Promise<Partial<ChatMessage>>;
  setMessages: (messages: ChatMessage[]) => void;
  setStreaming: (streaming: boolean) => void;
  setProgress: (progress: string | null) => void;
  setError: (error: string | null) => void;
  setBackend: (backend: ChatBackend) => void;
  /** vi.fn at runtime: assert with `expect(controller.reset).toHaveBeenCalled()`. */
  reset: () => void;
  abort: () => void;
};

type ChatState = {
  messages: ChatMessage[];
  isStreaming: boolean;
  progress: string | null;
  error: string | null;
  backend: ChatBackend;
};

let messageSeq = 0;

export function fakeMessage(
  role: "user" | "assistant",
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  messageSeq += 1;
  return { id: `fake-${messageSeq}`, role, text, ...extra };
}

/** A chat hook that never touches the network: `send` appends the user message and the scripted reply. */
export function createFakeChat(): {
  useChat: (options: ChatOptions) => ChatHandle;
  controller: FakeChatController;
} {
  let state: ChatState = {
    messages: [],
    isStreaming: false,
    progress: null,
    error: null,
    backend: { kind: "model", modelId: "fake-model", label: "Fake model" },
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ChatState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const controller: FakeChatController = {
    sent: [],
    lastOptions: undefined,
    reply: async (text) => ({ text: `Echo: ${text}` }),
    setMessages: (messages) => update({ messages }),
    setStreaming: (isStreaming) => update({ isStreaming }),
    setProgress: (progress) => update({ progress }),
    setError: (error) => update({ error }),
    setBackend: (backend) => update({ backend }),
    reset: vi.fn(() =>
      update({ messages: [], isStreaming: false, progress: null, error: null }),
    ),
    abort: vi.fn(() => update({ isStreaming: false, progress: null })),
  };
  const send = async (text: string) => {
    controller.sent.push(text);
    update({
      messages: [...state.messages, fakeMessage("user", text)],
      isStreaming: true,
      progress: "Agent thinking",
    });
    const reply = await controller.reply(text);
    update({
      messages: [
        ...state.messages,
        fakeMessage("assistant", reply.text ?? "", reply),
      ],
      isStreaming: false,
      progress: null,
    });
  };
  const useChat = (options: ChatOptions): ChatHandle => {
    controller.lastOptions = options;
    const current = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => state,
    );
    return {
      ...current,
      send,
      reset: controller.reset,
      abort: controller.abort,
    };
  };
  return { useChat, controller };
}

export type TestAssistantDeps = AssistantDeps & {
  timers: FakeTimer[];
  /** Runs every pending timer once, in order, and clears the queue. */
  flushTimers: () => void;
  chat: FakeChatController;
};

/** Offline, deterministic deps: the tiny frame table, manual timers, fixed randomness and the fake chat. */
export function createTestAssistantDeps(
  overrides: Partial<AssistantDeps> = {},
): TestAssistantDeps {
  const timers: FakeTimer[] = [];
  let nextId = 1;
  const { useChat, controller } = createFakeChat();
  return {
    loadAgent: vi.fn(async () => FAKE_SPRITE_AGENT),
    loadSounds: vi.fn(async () => ({ "1": "data:audio/mpeg;base64,AAAA" })),
    spriteUrl: "https://fuseos.test/fuse-riders/fuseos/clippy/map.png",
    playSound: vi.fn(),
    setTimeout: (callback, ms) => {
      const id = nextId;
      nextId += 1;
      timers.push({ id, callback, ms });
      return id;
    },
    clearTimeout: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index !== -1) timers.splice(index, 1);
    },
    random: () => 0,
    useChat,
    chatAvailable: true,
    ...overrides,
    timers,
    flushTimers: () => {
      const pending = timers.splice(0, timers.length);
      pending.forEach((timer) => timer.callback());
    },
    chat: controller,
  };
}
