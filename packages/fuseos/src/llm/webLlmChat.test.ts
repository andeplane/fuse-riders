import { createFakeEngineFactory } from "../__mocks__/llmEngine";

import { createIntentEngine } from "./intent";
import type { LlmMessage, ReplyRequest } from "./llmChat";
import type { FunctionToolDef } from "./agentLoop";
import type {
  MlcChunk,
  MlcCompletion,
  MlcCompletionRequest,
  MlcEngineLike,
  MlcStreamRequest,
} from "./webLlmChat";
import {
  adaptMlcEngine,
  AGENT_GENERATION,
  createWebLlmChatEngine,
  formatLoadProgress,
  GENERATION,
  loadFailureReason,
} from "./webLlmChat";

const MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";

function request(
  text: string,
  overrides: Partial<ReplyRequest> = {},
): ReplyRequest & { progress: string[] } {
  const progress: string[] = [];
  return {
    system: "You are Clippy.",
    messages: [{ role: "user", content: text }],
    signal: new AbortController().signal,
    onProgress: (report) => progress.push(report),
    ...overrides,
    progress,
  };
}

async function collect(iterable: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const piece of iterable) text += piece;
  return text;
}

describe(formatLoadProgress.name, () => {
  it("says downloading while fetching, loading from the cache, and warming up at the end", () => {
    expect(
      formatLoadProgress({
        progress: 0.123,
        text: "Fetching param cache[3/24]: 40MB fetched. 12% completed, 5 secs elapsed.",
      }),
    ).toBe("Downloading the model 12%");
    expect(
      formatLoadProgress({
        progress: 0.5,
        text: "Loading model from cache[12/24]: 0MB loaded.",
      }),
    ).toBe("Loading the model 50%");
    expect(formatLoadProgress({ progress: 0.2, text: "Compiling" })).toBe(
      "Preparing the model 20%",
    );
    expect(
      formatLoadProgress({ progress: 1, text: "Finish loading on WebGPU" }),
    ).toBe("Warming up the model");
    expect(formatLoadProgress({ progress: -1, text: "Fetching" })).toBe(
      "Downloading the model 0%",
    );
  });
});

describe(loadFailureReason.name, () => {
  it("names the model and the first line of the error in plain words", () => {
    expect(
      loadFailureReason(MODEL, new Error("Cannot find adapter\nstack")),
    ).toBe(
      "Clippy's model (Qwen 2.5 0.5B) could not start: Cannot find adapter. Clippy follows simple commands instead; Chrome or Edge on a computer with a graphics card runs the model.",
    );
    expect(loadFailureReason("Other-MLC", "offline")).toContain(
      "(Other-MLC) could not start: offline.",
    );
    expect(loadFailureReason(MODEL, undefined)).toContain("unknown error");
    expect(loadFailureReason(MODEL, new Error("  "))).toContain(
      "could not start: unknown error.",
    );
  });

  it("keeps only the first sentence of web-llm's paragraph of advice", () => {
    expect(
      loadFailureReason(
        MODEL,
        new Error(
          "Error: Unable to find a compatible GPU. This issue might be because your computer doesn't have a GPU. Please check https://webgpureport.org/.",
        ),
      ),
    ).toBe(
      "Clippy's model (Qwen 2.5 0.5B) could not start: Unable to find a compatible GPU. Clippy follows simple commands instead; Chrome or Edge on a computer with a graphics card runs the model.",
    );
  });
});

describe(createWebLlmChatEngine.name, () => {
  const catalog = {
    targets: [{ id: "fuseball", name: "Fuseball" }],
    gameNames: ["Fuseball"],
  };

  it("loads the model on the first reply only, reporting progress, then streams with the system prompt first", async () => {
    const factory = createFakeEngineFactory();
    factory.loadProgress = [
      { progress: 0.25, text: "Fetching param cache[1/4]" },
      { progress: 1, text: "Finish loading on WebGPU" },
    ];
    factory.reply = () => ["Hi ", "there!"];
    const engine = createWebLlmChatEngine({
      modelId: MODEL,
      createEngine: factory.createEngine,
      fallback: createIntentEngine(catalog, "no"),
    });
    expect(engine.backend()).toEqual({
      kind: "model",
      modelId: MODEL,
      label: "Qwen 2.5 0.5B",
    });

    const first = request("hello");
    expect(await collect(engine.reply(first))).toBe("Hi there!");
    expect(first.progress).toEqual([
      "Downloading the model 25%",
      "Warming up the model",
      "Thinking",
    ]);
    expect(factory.loads.map((load) => load.modelId)).toEqual([MODEL]);
    const sent: LlmMessage[][] = factory.engines[0]?.requests ?? [];
    expect(sent[0]).toEqual([
      { role: "system", content: "You are Clippy." },
      { role: "user", content: "hello" },
    ]);

    const second = request("again");
    await collect(engine.reply(second));
    expect(factory.loads).toHaveLength(1);
    expect(second.progress).toEqual(["Thinking"]);

    engine.dispose();
    await vi.waitFor(() => expect(factory.engines[0]?.unloaded).toBe(true));
    // Disposed: the next reply loads afresh.
    await collect(engine.reply(request("back")));
    expect(factory.loads).toHaveLength(2);
  });

  it("falls back to the rules for this and later questions when the model cannot load, and says why", async () => {
    const factory = createFakeEngineFactory();
    factory.failLoad = new Error("Cannot find WebGPU adapter");
    const engine = createWebLlmChatEngine({
      modelId: MODEL,
      createEngine: factory.createEngine,
      fallback: createIntentEngine(catalog, "no"),
    });
    expect(await collect(engine.reply(request("open fuseball")))).toBe(
      "Opening Fuseball! [open:fuseball]",
    );
    expect(engine.backend()).toEqual({
      kind: "rules",
      reason: loadFailureReason(MODEL, new Error("Cannot find WebGPU adapter")),
    });
    await collect(engine.reply(request("hello")));
    expect(factory.loads).toHaveLength(1);
  });

  it("streams nothing when the request was aborted while the model loaded", async () => {
    const factory = createFakeEngineFactory();
    const controller = new AbortController();
    const engine = createWebLlmChatEngine({
      modelId: MODEL,
      createEngine: factory.createEngine,
      fallback: createIntentEngine(catalog, "no"),
    });
    const aborted = request("hello", { signal: controller.signal });
    controller.abort();
    expect(await collect(engine.reply(aborted))).toBe("");
    expect(factory.engines[0]?.requests).toEqual([]);
    expect(aborted.progress).toEqual([]);
  });

  it("stops reporting progress to a finished request", async () => {
    const factory = createFakeEngineFactory();
    const engine = createWebLlmChatEngine({
      modelId: MODEL,
      createEngine: factory.createEngine,
      fallback: createIntentEngine(catalog, "no"),
    });
    const first = request("hello");
    await collect(engine.reply(first));
    factory.loads[0]?.onProgress({ progress: 0.5, text: "late" });
    expect(first.progress).toEqual(["Thinking"]);
  });
});

describe("the agent side of the model engine", () => {
  const PRO = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
  const catalog = { targets: [], gameNames: [] };

  it("says how its model drives the desktop, and goes back to markers once the model has failed to load", async () => {
    const factory = createFakeEngineFactory();
    const small = createWebLlmChatEngine({
      modelId: MODEL,
      createEngine: factory.createEngine,
      fallback: createIntentEngine(catalog, "no"),
    });
    expect(small.loopStyle?.()).toBe("markers");
    const pro = createWebLlmChatEngine({
      modelId: PRO,
      createEngine: factory.createEngine,
      fallback: createIntentEngine(catalog, "no"),
    });
    expect(pro.loopStyle?.()).toBe("json");
    factory.failLoad = new Error("Cannot find WebGPU adapter");
    await expect(pro.ready?.(() => undefined)).rejects.toThrow(
      "Cannot find WebGPU adapter",
    );
    expect(pro.loopStyle?.()).toBe("markers");
    expect(pro.backend().kind).toBe("rules");
    expect(createIntentEngine(catalog, "no").loopStyle?.()).toBe("markers");
  });

  it("loads the model once, with progress, before the loop asks for whole replies", async () => {
    const factory = createFakeEngineFactory();
    factory.loadProgress = [{ progress: 0.5, text: "Fetching param cache" }];
    factory.script = ['{"tool":"answer","args":{"text":"hi"}}'];
    const engine = createWebLlmChatEngine({
      modelId: PRO,
      createEngine: factory.createEngine,
      fallback: createIntentEngine(catalog, "no"),
    });
    const progress: string[] = [];
    await engine.ready?.((text) => progress.push(text));
    expect(progress).toEqual(["Downloading the model 50%"]);
    const signal = new AbortController().signal;
    const messages: LlmMessage[] = [{ role: "user", content: "hi" }];
    expect(
      await engine.complete?.({
        messages,
        signal,
        jsonSchema: "{}",
        onProgress: (text) => progress.push(text),
      }),
    ).toEqual({ text: '{"tool":"answer","args":{"text":"hi"}}' });
    expect(factory.loads).toHaveLength(1);
    expect(factory.engines[0]?.completions).toEqual([
      { messages, jsonSchema: "{}", tools: undefined },
    ]);
    // The script is spent: a completion answers with what `reply` would stream.
    expect(
      await engine.complete?.({
        messages,
        signal,
        onProgress: () => undefined,
      }),
    ).toEqual({
      text: "Echo: hi",
    });
  });
});

describe(adaptMlcEngine.name, () => {
  function fakeMlc(
    chunks: MlcChunk[],
    completion: MlcCompletion = { choices: [] },
  ) {
    const calls: (MlcStreamRequest | MlcCompletionRequest)[] = [];
    let interrupted = 0;
    let unloaded = 0;
    function create(
      request: MlcStreamRequest,
    ): Promise<AsyncIterable<MlcChunk>>;
    function create(request: MlcCompletionRequest): Promise<MlcCompletion>;
    async function create(
      request: MlcStreamRequest | MlcCompletionRequest,
    ): Promise<AsyncIterable<MlcChunk> | MlcCompletion> {
      calls.push(request);
      if (!request.stream) return completion;
      return (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
    }
    const engine: MlcEngineLike = {
      chat: { completions: { create } },
      interruptGenerate: () => {
        interrupted += 1;
      },
      unload: async () => {
        unloaded += 1;
      },
    };
    return {
      engine,
      calls,
      interrupted: () => interrupted,
      unloaded: () => unloaded,
    };
  }

  it("asks for one whole reply held to the schema, at the agent's settings", async () => {
    const mlc = fakeMlc([], {
      choices: [
        { message: { content: '{"tool":"answer","args":{"text":"hi"}}' } },
      ],
    });
    const engine = adaptMlcEngine(mlc.engine);
    const messages: LlmMessage[] = [{ role: "user", content: "hi" }];
    expect(
      await engine.complete({
        messages,
        signal: new AbortController().signal,
        jsonSchema: '{"anyOf":[]}',
      }),
    ).toEqual({ text: '{"tool":"answer","args":{"text":"hi"}}' });
    expect(mlc.calls).toEqual([
      {
        messages,
        stream: false,
        ...AGENT_GENERATION,
        response_format: { type: "json_object", schema: '{"anyOf":[]}' },
      },
    ]);
  });

  it("declares native tools and hands back the calls the model made", async () => {
    const tools: FunctionToolDef[] = [
      {
        type: "function",
        function: {
          name: "open_app",
          description: "Opens a program.",
          parameters: { type: "object" },
        },
      },
    ];
    const mlc = fakeMlc([], {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { function: { name: "open_app", arguments: '{"id":"paint"}' } },
            ],
          },
        },
      ],
    });
    const engine = adaptMlcEngine(mlc.engine);
    const signal = new AbortController().signal;
    expect(await engine.complete({ messages: [], signal, tools })).toEqual({
      text: "",
      toolCalls: [{ name: "open_app", arguments: '{"id":"paint"}' }],
    });
    expect(mlc.calls[0]).toMatchObject({ tools, tool_choice: "auto" });
    // No tools to declare, no choice either; and an empty reply is empty text.
    const bare = fakeMlc([]);
    expect(
      await adaptMlcEngine(bare.engine).complete({
        messages: [],
        signal,
        tools: [],
      }),
    ).toEqual({ text: "" });
    expect(bare.calls).toEqual([
      { messages: [], stream: false, ...AGENT_GENERATION },
    ]);
  });

  it("interrupts a whole reply on abort", async () => {
    const mlc = fakeMlc([]);
    const controller = new AbortController();
    const engine = adaptMlcEngine(mlc.engine);
    const pending = engine.complete({
      messages: [],
      signal: controller.signal,
    });
    controller.abort();
    await pending;
    expect(mlc.interrupted()).toBe(1);
    // Once the reply is in, a late abort interrupts nothing.
    const late = new AbortController();
    await engine.complete({ messages: [], signal: late.signal });
    late.abort();
    expect(mlc.interrupted()).toBe(1);
  });

  it("streams the deltas of a streaming completion with the generation settings", async () => {
    const mlc = fakeMlc([
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: null } }] },
      { choices: [] },
      { choices: [{ delta: { content: "lo" } }] },
    ]);
    const engine = adaptMlcEngine(mlc.engine);
    const messages: LlmMessage[] = [{ role: "user", content: "hi" }];
    expect(
      await collect(engine.stream(messages, new AbortController().signal)),
    ).toBe("Hello");
    expect(mlc.calls).toEqual([{ messages, stream: true, ...GENERATION }]);
  });

  it("interrupts generation on abort and stops yielding", async () => {
    const mlc = fakeMlc([
      { choices: [{ delta: { content: "a" } }] },
      { choices: [{ delta: { content: "b" } }] },
    ]);
    const engine = adaptMlcEngine(mlc.engine);
    const controller = new AbortController();
    const pieces: string[] = [];
    for await (const piece of engine.stream([], controller.signal)) {
      pieces.push(piece);
      controller.abort();
    }
    expect(pieces).toEqual(["a"]);
    expect(mlc.interrupted()).toBe(1);
  });

  it("unloads the model and terminates the worker, even when unloading fails", async () => {
    const mlc = fakeMlc([]);
    const worker = { terminate: vi.fn() };
    await adaptMlcEngine(mlc.engine, worker).unload();
    expect(mlc.unloaded()).toBe(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    const failing: MlcEngineLike = {
      ...mlc.engine,
      unload: async () => {
        throw new Error("gone");
      },
    };
    await expect(adaptMlcEngine(failing, worker).unload()).rejects.toThrow(
      "gone",
    );
    expect(worker.terminate).toHaveBeenCalledTimes(2);
  });
});
