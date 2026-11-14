import { act, renderHook, waitFor } from "@testing-library/react";

import type { ChatEngine, ChatOptions, ReplyRequest } from "./llmChat";
import type { AssistantTool, ToolCallEvent } from "./tools";
import { HISTORY_LINES, useEngineChat } from "./useEngineChat";

/** An engine the test feeds piece by piece. */
function scriptedEngine() {
  const requests: ReplyRequest[] = [];
  let pieces: string[] = [];
  let push: ((piece: string | null) => void) | undefined;
  let fail: Error | undefined;
  const engine: ChatEngine = {
    backend: () => ({ kind: "model", modelId: "m", label: "M" }),
    async *reply(request) {
      requests.push(request);
      request.onProgress("Downloading the model 10%");
      while (true) {
        const next = await new Promise<string | null>((resolve) => {
          if (pieces.length > 0) resolve(pieces.shift() ?? null);
          else push = resolve;
        });
        if (next === null) break;
        if (fail) {
          const error = fail;
          fail = undefined;
          throw error;
        }
        yield next;
      }
    },
    dispose: vi.fn(),
  };
  const emit = (piece: string | null) => {
    if (push) {
      const resolve = push;
      push = undefined;
      resolve(piece);
    } else pieces.push(piece ?? "");
  };
  // A macrotask after each piece lets the generator resume and the hook render before `act` returns.
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    engine,
    requests,
    emit: (piece: string) =>
      act(async () => {
        emit(piece);
        await settle();
      }),
    end: () =>
      act(async () => {
        emit(null);
        await settle();
      }),
    failNext: (error: Error) => {
      fail = error;
    },
    reset: () => {
      pieces = [];
      push = undefined;
    },
  };
}

function openTool(opened: string[]): AssistantTool {
  return {
    name: "open",
    describe: () => "[open:<id>]",
    sentence: ({ arg }) => `Opening ${arg}`,
    run: ({ arg }) => {
      if (arg === "nope") return { ok: false, sentence: "No such thing" };
      opened.push(arg);
      return { ok: true, sentence: `Opened ${arg}` };
    },
  };
}

function options(overrides: Partial<ChatOptions> = {}): ChatOptions {
  return {
    getAppContext: () => "Windows open: none",
    getSystemPrompt: () => "You are Clippy.",
    ...overrides,
  };
}

describe(useEngineChat.name, () => {
  it("streams the reply into the last message, hides markers, runs the tools and reports them", async () => {
    const scripted = scriptedEngine();
    const opened: string[] = [];
    const events: ToolCallEvent[] = [];
    const { result } = renderHook(() =>
      useEngineChat(
        scripted.engine,
        options({
          tools: [openTool(opened)],
          onToolCall: (event) => events.push(event),
        }),
      ),
    );
    expect(result.current.backend).toEqual({
      kind: "model",
      modelId: "m",
      label: "M",
    });

    let done: Promise<void> | undefined;
    act(() => {
      done = result.current.send("open fuseball");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    expect(result.current.progress).toBe("Downloading the model 10%");
    expect(result.current.messages.map((message) => message.text)).toEqual([
      "open fuseball",
      "",
    ]);
    expect(scripted.requests[0]?.system).toBe(
      "You are Clippy.\n\nCurrent desktop: Windows open: none",
    );
    expect(scripted.requests[0]?.messages).toEqual([
      { role: "user", content: "open fuseball" },
    ]);

    await scripted.emit("Opening Fuseball! ");
    expect(result.current.progress).toBeNull();
    await scripted.emit("[open:fuse");
    expect(result.current.messages[1]?.text).toBe("Opening Fuseball!");
    expect(result.current.messages[1]?.isStreaming).toBe(true);
    await scripted.emit("ball]");
    await scripted.end();
    await act(async () => done);

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      text: "Opening Fuseball!",
      isStreaming: false,
    });
    expect(opened).toEqual(["fuseball"]);
    expect(events).toEqual([
      { name: "open", sentence: "Opening fuseball", phase: "started" },
      { name: "open", sentence: "Opened fuseball", phase: "finished" },
    ]);
  });

  it("sends the earlier lines as history, capped, and ignores a send while streaming", async () => {
    const scripted = scriptedEngine();
    const { result } = renderHook(() =>
      useEngineChat(scripted.engine, options()),
    );
    for (let turn = 0; turn < 6; turn += 1) {
      let done: Promise<void> | undefined;
      act(() => {
        done = result.current.send(`q${turn}`);
      });
      await waitFor(() => expect(result.current.isStreaming).toBe(true));
      // A second send during the turn is dropped rather than queued.
      await act(async () => result.current.send("ignored"));
      await scripted.emit(`a${turn}`);
      await scripted.end();
      await act(async () => done);
    }
    expect(scripted.requests).toHaveLength(6);
    const last = scripted.requests[5]?.messages ?? [];
    expect(last).toHaveLength(HISTORY_LINES + 1);
    expect(last[0]).toEqual({ role: "user", content: "q1" });
    expect(last[last.length - 1]).toEqual({ role: "user", content: "q5" });
    expect(result.current.messages).toHaveLength(12);
  });

  it("keeps the partial text and no error on abort, and skips the tools", async () => {
    const scripted = scriptedEngine();
    const opened: string[] = [];
    const { result } = renderHook(() =>
      useEngineChat(scripted.engine, options({ tools: [openTool(opened)] })),
    );
    let done: Promise<void> | undefined;
    act(() => {
      done = result.current.send("go");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    await scripted.emit("Half way [open:paint]");
    act(() => result.current.abort());
    expect(scripted.requests[0]?.signal.aborted).toBe(true);
    await scripted.end();
    await act(async () => done);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.messages[1]?.text).toBe("Half way");
    expect(opened).toEqual([]);
  });

  it("reports an engine error, dropping an empty reply but keeping a partial one", async () => {
    const scripted = scriptedEngine();
    const { result } = renderHook(() =>
      useEngineChat(scripted.engine, options()),
    );
    let done: Promise<void> | undefined;
    act(() => {
      done = result.current.send("one");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    scripted.failNext(new Error("The GPU fell over"));
    await scripted.emit("x");
    await act(async () => done);
    expect(result.current.error).toBe("The GPU fell over");
    expect(result.current.messages.map((message) => message.text)).toEqual([
      "one",
    ]);

    act(() => {
      done = result.current.send("two");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    expect(result.current.error).toBeNull();
    await scripted.emit("partial");
    scripted.failNext(new Error("again"));
    await scripted.emit("x");
    await act(async () => done);
    expect(result.current.messages.map((message) => message.text)).toEqual([
      "one",
      "two",
      "partial",
    ]);
    expect(result.current.messages[2]?.isStreaming).toBe(false);
  });

  it("shows an ellipsis for an empty reply, and wraps a thrown value that is not an Error", async () => {
    const engine: ChatEngine = {
      backend: () => ({ kind: "rules", reason: "r" }),
      async *reply() {
        // Nothing to say.
      },
      dispose: () => undefined,
    };
    const { result } = renderHook(() => useEngineChat(engine, options()));
    await act(async () => result.current.send("hm"));
    expect(result.current.messages[1]?.text).toBe("...");

    const throwing: ChatEngine = {
      ...engine,
      async *reply() {
        throw "plain";
      },
    };
    const { result: thrown } = renderHook(() =>
      useEngineChat(throwing, options()),
    );
    await act(async () => thrown.current.send("hm"));
    expect(thrown.current.error).toBe("Clippy could not answer.");
  });

  it("resets the conversation, and starts afresh with the backend of a new engine", async () => {
    const scripted = scriptedEngine();
    const { result, rerender } = renderHook(
      ({ engine }: { engine: ChatEngine }) => useEngineChat(engine, options()),
      { initialProps: { engine: scripted.engine } },
    );
    let done: Promise<void> | undefined;
    act(() => {
      done = result.current.send("hello");
    });
    await scripted.emit("hi");
    await scripted.end();
    await act(async () => done);
    expect(result.current.messages).toHaveLength(2);
    act(() => result.current.reset());
    expect(result.current.messages).toEqual([]);

    act(() => {
      done = result.current.send("again");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    const rules: ChatEngine = {
      backend: () => ({ kind: "rules", reason: "no gpu" }),
      async *reply() {
        yield "rules";
      },
      dispose: () => undefined,
    };
    rerender({ engine: rules });
    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.backend).toEqual({ kind: "rules", reason: "no gpu" });
    expect(scripted.requests[1]?.signal.aborted).toBe(true);
    await act(async () => result.current.send("x"));
    expect(result.current.messages[1]?.text).toBe("rules");
  });

  it("re-reads the backend after a turn, so a model that fell back to the rules says so", async () => {
    let fellBack = false;
    const engine: ChatEngine = {
      backend: () =>
        fellBack
          ? { kind: "rules", reason: "model died" }
          : { kind: "model", modelId: "m", label: "M" },
      async *reply() {
        fellBack = true;
        yield "ok";
      },
      dispose: () => undefined,
    };
    const { result } = renderHook(() => useEngineChat(engine, options()));
    expect(result.current.backend.kind).toBe("model");
    await act(async () => result.current.send("hi"));
    expect(result.current.backend).toEqual({
      kind: "rules",
      reason: "model died",
    });
  });
});
