import type { AgentCompletion, AgentCompletionRequest } from "../llm/agentLoop";
import type { LlmMessage } from "../llm/llmChat";
import type { EngineFactory, LlmEngine, LoadProgress } from "../llm/webLlmChat";

/** A loaded fake model: records every request and answers from the controller's script. */
export type FakeLlmEngine = LlmEngine & {
  modelId: string;
  requests: LlmMessage[][];
  /** Every agent-loop completion asked for, with its schema or tools. */
  completions: Pick<
    AgentCompletionRequest,
    "messages" | "jsonSchema" | "tools"
  >[];
  unloaded: boolean;
};

export type FakeEngineFactory = {
  createEngine: EngineFactory;
  /** Every load asked for, in order, with the progress sink so a test can report progress itself. */
  loads: { modelId: string; onProgress: (report: LoadProgress) => void }[];
  engines: FakeLlmEngine[];
  /** The pieces the engine streams for a request; default echoes the last user line. */
  reply: (messages: readonly LlmMessage[]) => string[] | Promise<string[]>;
  /**
   * The agent loop's replies, one per completion, in order: a string is the reply's text (a JSON tool call, say).
   * When the script runs out (or is empty) a completion answers with the joined pieces of `reply`.
   */
  script: (string | AgentCompletion)[];
  /** When set, every completion waits for this (and for an abort) before answering, so a test can cancel mid-step. */
  completionGate: Promise<void> | undefined;
  /** Progress reports every load emits before resolving. */
  loadProgress: LoadProgress[];
  /** Set to make the next load reject with this error. */
  failLoad: Error | undefined;
  /** Set to make the next stream throw after the pieces streamed so far. */
  failStream: Error | undefined;
  /** When set, a load waits for this before finishing, so a test can report progress through `loads[n].onProgress`. */
  loadGate: Promise<void> | undefined;
};

/** A typed stand-in for `webLlmEngineFactory`: no worker, no download, no WebGPU. */
export function createFakeEngineFactory(): FakeEngineFactory {
  const factory: FakeEngineFactory = {
    loads: [],
    engines: [],
    reply: (messages) => {
      const last = [...messages]
        .reverse()
        .find((message) => message.role === "user");
      return [`Echo: ${last?.content ?? ""}`];
    },
    script: [],
    completionGate: undefined,
    loadProgress: [],
    failLoad: undefined,
    failStream: undefined,
    loadGate: undefined,
    createEngine: async (modelId, onProgress) => {
      factory.loads.push({ modelId, onProgress });
      factory.loadProgress.forEach(onProgress);
      if (factory.loadGate) await factory.loadGate;
      if (factory.failLoad) {
        const error = factory.failLoad;
        factory.failLoad = undefined;
        throw error;
      }
      const engine: FakeLlmEngine = {
        modelId,
        requests: [],
        completions: [],
        unloaded: false,
        async *stream(messages, signal) {
          engine.requests.push([...messages]);
          const pieces = await factory.reply(messages);
          for (const piece of pieces) {
            if (signal.aborted) return;
            yield piece;
          }
          if (factory.failStream) {
            const error = factory.failStream;
            factory.failStream = undefined;
            throw error;
          }
        },
        async complete({ messages, signal, jsonSchema, tools }) {
          engine.completions.push({
            messages: [...messages],
            jsonSchema,
            tools,
          });
          if (factory.completionGate)
            await Promise.race([
              factory.completionGate,
              new Promise<void>((resolve) =>
                signal.addEventListener("abort", () => resolve(), {
                  once: true,
                }),
              ),
            ]);
          if (signal.aborted) throw new Error("interrupted");
          const scripted = factory.script.shift();
          if (scripted === undefined)
            return { text: (await factory.reply(messages)).join("") };
          return typeof scripted === "string" ? { text: scripted } : scripted;
        },
        async unload() {
          engine.unloaded = true;
        },
      };
      factory.engines.push(engine);
      return engine;
    },
  };
  return factory;
}
