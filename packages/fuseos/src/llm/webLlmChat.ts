import type {
  AgentCompletion,
  AgentCompletionRequest,
  FunctionToolDef,
} from "./agentLoop";
import type {
  ChatBackend,
  ChatEngine,
  LlmMessage,
  LoopStyle,
  ReplyRequest,
} from "./llmChat";
import { loopStyleFor, modelLabel } from "./modelCatalog";

/**
 * Clippy's model, over `@mlc-ai/web-llm` in a module worker. The library and the weights are reached only
 * through `webLlmEngineFactory`, i.e. through `await import()` on the first question, never when the balloon opens:
 * `tests/fuseos-lazy.test.ts` keeps it that way. Everything else here is testable with a fake `EngineFactory`.
 */

export type LoadProgress = {
  /** 0 to 1. */
  progress: number;
  /** web-llm's own line, e.g. "Fetching param cache[3/24]: 40MB fetched. 12% completed, 5 secs elapsed." */
  text: string;
};

/** A loaded model: what the chat engine needs of web-llm, narrow enough for a typed fake. */
export interface LlmEngine {
  /** Streams the reply's text, piece by piece; aborting the signal interrupts generation. */
  stream(
    messages: readonly LlmMessage[],
    signal: AbortSignal,
  ): AsyncIterable<string>;
  /**
   * One whole reply for the agent loop: held to `jsonSchema` by the grammar when given, or free to call the
   * native `tools`. Aborting the signal interrupts generation.
   */
  complete(
    request: Pick<
      AgentCompletionRequest,
      "messages" | "signal" | "jsonSchema" | "tools"
    >,
  ): Promise<AgentCompletion>;
  /** Releases the model's GPU memory and its worker. */
  unload(): Promise<void>;
}

/** Loads a model, reporting progress until it is ready to answer. */
export type EngineFactory = (
  modelId: string,
  onProgress: (report: LoadProgress) => void,
) => Promise<LlmEngine>;

export type WebLlmChatEngineOptions = {
  modelId: string;
  createEngine: EngineFactory;
  /** Answers instead when the model cannot load (no adapter, out of memory, offline). */
  fallback: ChatEngine;
};

/** What the balloon shows while the model loads, as "Clippy Processing" plus the percentage. */
export function formatLoadProgress(report: LoadProgress): string {
  const percent = Math.max(0, Math.min(100, Math.round(report.progress * 100)));
  if (report.progress >= 1) return "Warming up the model";
  const verb = /^Fetching/i.test(report.text)
    ? "Downloading the model"
    : /cache/i.test(report.text)
      ? "Loading the model"
      : "Preparing the model";
  return `${verb} ${percent}%`;
}

/** A model failed to load; the rules answer from now on. Plain words for the balloon. */
export function loadFailureReason(modelId: string, error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  // web-llm's messages run to a paragraph of advice; the first sentence says what happened.
  const detail = (message.replace(/^Error:\s*/, "").split("\n")[0] ?? "")
    .split(/\.\s/)[0]
    ?.replace(/\.$/, "")
    .trim();
  return `Clippy's model (${modelLabel(modelId)}) could not start: ${detail || "unknown error"}. Clippy follows simple commands instead; Chrome or Edge on a computer with a graphics card runs the model.`;
}

export const GENERATION = { temperature: 0.7, max_tokens: 200 } as const;
/** A tool call wants the likeliest token, not a lively one, and room for a file's worth of content. */
export const AGENT_GENERATION = { temperature: 0.2, max_tokens: 512 } as const;

/**
 * The chat engine over a lazily loaded model. The first reply loads the model (download, then warm-up), later ones
 * reuse it; a load failure switches to the fallback engine for the rest of the session and says why.
 */
export function createWebLlmChatEngine(
  options: WebLlmChatEngineOptions,
): ChatEngine {
  const { modelId, createEngine, fallback } = options;
  let loading: Promise<LlmEngine> | undefined;
  let failure: string | undefined;
  let onProgress: (text: string) => void = () => undefined;

  const load = (): Promise<LlmEngine> => {
    loading ??= createEngine(modelId, (report) =>
      onProgress(formatLoadProgress(report)),
    ).catch((error: unknown) => {
      loading = undefined;
      failure = loadFailureReason(modelId, error);
      throw error;
    });
    return loading;
  };

  const backend = (): ChatBackend =>
    failure === undefined
      ? { kind: "model", modelId, label: modelLabel(modelId) }
      : { kind: "rules", reason: failure };

  /** The loaded model, with the load's progress going to `report`; rejects when it cannot load (`failure` says why). */
  const loaded = async (report: (text: string) => void): Promise<LlmEngine> => {
    onProgress = report;
    try {
      return await load();
    } finally {
      onProgress = () => undefined;
    }
  };

  return {
    backend,
    loopStyle: (): LoopStyle =>
      failure === undefined ? loopStyleFor(modelId) : "markers",
    async ready(report) {
      await loaded(report);
    },
    async complete(request) {
      const engine = await loaded(request.onProgress);
      return engine.complete(request);
    },
    async *reply(request: ReplyRequest) {
      if (failure !== undefined) {
        yield* fallback.reply(request);
        return;
      }
      let engine: LlmEngine;
      try {
        engine = await loaded(request.onProgress);
      } catch {
        // `load` recorded why; the rules answer this question and the next ones.
        yield* fallback.reply(request);
        return;
      }
      if (request.signal.aborted) return;
      request.onProgress("Thinking");
      const messages: LlmMessage[] = [
        { role: "system", content: request.system },
        ...request.messages,
      ];
      yield* engine.stream(messages, request.signal);
    },
    dispose() {
      const current = loading;
      loading = undefined;
      if (current)
        void current.then((engine) => engine.unload()).catch(() => undefined);
    },
  };
}

export type MlcStreamRequest = {
  messages: LlmMessage[];
  stream: true;
  temperature: number;
  max_tokens: number;
};

export type MlcCompletionRequest = {
  messages: LlmMessage[];
  stream: false;
  temperature: number;
  max_tokens: number;
  response_format?: { type: "json_object"; schema: string };
  tools?: FunctionToolDef[];
  tool_choice?: "auto";
};

export type MlcCompletion = {
  choices: readonly {
    message: {
      content?: string | null;
      tool_calls?:
        readonly { function: { name: string; arguments: string } }[] | null;
    };
  }[];
};

/** The slice of web-llm's engine the adapter drives; `WebWorkerMLCEngine` satisfies it. */
export type MlcEngineLike = {
  chat: {
    completions: {
      create(request: MlcStreamRequest): Promise<AsyncIterable<MlcChunk>>;
      create(request: MlcCompletionRequest): Promise<MlcCompletion>;
    };
  };
  interruptGenerate(): void;
  unload(): Promise<void>;
};

export type MlcChunk = {
  choices: readonly { delta: { content?: string | null } }[];
};

/** `LlmEngine` over a web-llm engine (and the worker it runs in, terminated on unload). */
export function adaptMlcEngine(
  engine: MlcEngineLike,
  worker?: { terminate(): void },
): LlmEngine {
  return {
    async *stream(messages, signal) {
      const interrupt = () => engine.interruptGenerate();
      signal.addEventListener("abort", interrupt, { once: true });
      try {
        const chunks = await engine.chat.completions.create({
          messages: [...messages],
          stream: true,
          ...GENERATION,
        });
        for await (const chunk of chunks) {
          if (signal.aborted) return;
          const delta = chunk.choices[0]?.delta.content;
          if (delta) yield delta;
        }
      } finally {
        signal.removeEventListener("abort", interrupt);
      }
    },
    async complete({ messages, signal, jsonSchema, tools }) {
      const interrupt = () => engine.interruptGenerate();
      signal.addEventListener("abort", interrupt, { once: true });
      try {
        const completion = await engine.chat.completions.create({
          messages: [...messages],
          stream: false,
          ...AGENT_GENERATION,
          ...(jsonSchema === undefined
            ? {}
            : { response_format: { type: "json_object", schema: jsonSchema } }),
          ...(tools === undefined || tools.length === 0
            ? {}
            : { tools: [...tools], tool_choice: "auto" as const }),
        });
        const message = completion.choices[0]?.message;
        const calls = message?.tool_calls ?? [];
        return {
          text: message?.content ?? "",
          ...(calls.length === 0
            ? {}
            : {
                toolCalls: calls.map((call) => ({
                  name: call.function.name,
                  arguments: call.function.arguments,
                })),
              }),
        };
      } finally {
        signal.removeEventListener("abort", interrupt);
      }
    },
    async unload() {
      try {
        await engine.unload();
      } finally {
        worker?.terminate();
      }
    },
  };
}

/**
 * The production factory: imports web-llm and spawns the worker on first use. Both the import and the
 * `new Worker` are inside the function so no model code ships in the initial bundle.
 */
export const webLlmEngineFactory: EngineFactory = async (
  modelId,
  onProgress,
) => {
  const webllm = await import("@mlc-ai/web-llm");
  const worker = new Worker(new URL("./llmWorker.ts", import.meta.url), {
    type: "module",
  });
  try {
    const engine = await webllm.CreateWebWorkerMLCEngine(worker, modelId, {
      initProgressCallback: (report) =>
        onProgress({ progress: report.progress, text: report.text }),
    });
    return adaptMlcEngine(engine, worker);
  } catch (error) {
    worker.terminate();
    throw error;
  }
};
