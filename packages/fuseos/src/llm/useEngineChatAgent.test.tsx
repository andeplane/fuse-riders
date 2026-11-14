import { act, renderHook, waitFor } from "@testing-library/react";

import { createFakeAgentOs } from "../__mocks__/agentOs";
import { createAgentTools } from "../agenttools/createAgentTools";

import type { AgentCompletion, AgentCompletionRequest } from "./agentLoop";
import { CANCELLED_REPLY, CONFUSED_REPLY } from "./agentLoop";
import type { ChatEngine, ChatOptions, LoopStyle } from "./llmChat";
import type { ToolCallEvent } from "./tools";
import { nextTask, useEngineChat } from "./useEngineChat";

type Scripted =
  string | ((request: AgentCompletionRequest) => Promise<AgentCompletion>);

/** An engine that drives the agent loop from a script; `style` and `failReady` can change between turns. */
function agentEngine(script: Scripted[]) {
  const state: {
    style: LoopStyle;
    failReady: Error | undefined;
    requests: AgentCompletionRequest[];
    replies: number;
  } = { style: "json", failReady: undefined, requests: [], replies: 0 };
  const engine: ChatEngine = {
    backend: () =>
      state.style === "markers"
        ? { kind: "rules", reason: "The model could not start." }
        : { kind: "model", modelId: "pro", label: "Clippy Pro" },
    loopStyle: () => state.style,
    async ready(onProgress) {
      onProgress("Downloading the model 40%");
      if (state.failReady) {
        // What the real engine does: record the failure, switch to the rules, reject.
        state.style = "markers";
        throw state.failReady;
      }
    },
    async complete(request) {
      state.requests.push({ ...request, messages: [...request.messages] });
      const next = script.shift();
      if (next === undefined) throw new Error("the script ran out");
      return typeof next === "string" ? { text: next } : next(request);
    },
    async *reply() {
      state.replies += 1;
      yield "The rules say hello. [open_app:paint]";
    },
    dispose: () => undefined,
  };
  return { engine, state };
}

function call(tool: string, args: Record<string, unknown> = {}): string {
  return JSON.stringify({ tool, args });
}

function setup(
  script: Scripted[],
  agent: Partial<NonNullable<ChatOptions["agent"]>> = {},
) {
  const os = createFakeAgentOs();
  const tools = createAgentTools(os, { current: undefined });
  const events: ToolCallEvent[] = [];
  const { engine, state } = agentEngine(script);
  const options: ChatOptions = {
    getAppContext: () => "FuseOS desktop.",
    getSystemPrompt: () => "Marker prompt.",
    tools: [],
    onToolCall: (event) => events.push(event),
    agent: {
      tools,
      getPrompt: () => "Agent prompt.",
      timers: {
        setTimeout: (callback, ms) => Number(setTimeout(callback, ms)),
        clearTimeout: (handle) => clearTimeout(handle),
      },
      ...agent,
    },
  };
  const hook = renderHook(
    (props: { engine: ChatEngine; options: ChatOptions }) =>
      useEngineChat(props.engine, props.options),
    { initialProps: { engine, options } },
  );
  return { os, tools, events, engine, state, options, ...hook };
}

describe(`${useEngineChat.name}, the agent loop`, () => {
  it("runs the model's tool calls step by step and puts its answer in the reply", async () => {
    const { result, os, events, state } = setup([
      call("open_app", { id: "paint" }),
      call("maximize_window", { window: "Paint" }),
      call("answer", { text: "Paint is open and maximized!" }),
    ]);
    await act(() => result.current.send("open paint and maximize it"));

    expect(result.current.messages.map((message) => message.text)).toEqual([
      "open paint and maximize it",
      "Paint is open and maximized!",
    ]);
    expect(result.current.messages[1]?.isStreaming).toBe(false);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(os.log).toEqual(["open untitled - Paint", "toggleMaximize w1"]);
    expect(events.map((event) => `${event.phase}: ${event.sentence}`)).toEqual([
      "started: Opening Paint",
      "finished: Opened Paint",
      "started: Maximizing untitled - Paint",
      "finished: Maximized untitled - Paint",
    ]);
    // The loop's own prompt and the desktop lead; the marker prompt is not sent.
    expect(state.requests[0]?.messages[0]).toEqual({
      role: "system",
      content: "Agent prompt.\n\nCurrent desktop: FuseOS desktop.",
    });
    expect(state.requests[0]?.jsonSchema).toContain(
      '"const":"maximize_window"',
    );
    expect(state.replies).toBe(0);

    // The next turn carries the first as history, in plain words.
    await act(() => result.current.send("thanks"));
    expect(state.requests.at(-1)?.messages.slice(1, 3)).toEqual([
      { role: "user", content: "open paint and maximize it" },
      { role: "assistant", content: "Paint is open and maximized!" },
    ]);
  });

  it("shows where the loop is while it works, and stops it on abort", async () => {
    let release: (completion: AgentCompletion) => void = () => undefined;
    const { result, os } = setup([
      call("open_app", { id: "paint" }),
      (request) =>
        new Promise<AgentCompletion>((resolve, reject) => {
          release = resolve;
          request.signal.addEventListener("abort", () =>
            reject(new Error("interrupted")),
          );
        }),
    ]);
    let sending: Promise<void> = Promise.resolve();
    act(() => {
      sending = result.current.send("open paint and then doom");
    });
    await waitFor(() =>
      expect(result.current.progress).toBe("Thinking (step 2 of 8)"),
    );
    expect(result.current.isStreaming).toBe(true);
    act(() => result.current.abort());
    await act(() => sending);
    expect(release).toBeTypeOf("function");
    expect(result.current.messages[1]?.text).toBe(
      `${CANCELLED_REPLY} So far: Opened Paint.`,
    );
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(os.log).toEqual(["open untitled - Paint"]);
  });

  it("answers gracefully when the model's replies are not tool calls", async () => {
    const { result } = setup(["{oops", "{still oops"]);
    await act(() => result.current.send("do something"));
    expect(result.current.messages[1]?.text).toBe(CONFUSED_REPLY);
    expect(result.current.error).toBeNull();
  });

  it("hands the turn to the marker pipeline when the model cannot load", async () => {
    const { result, state } = setup([]);
    state.failReady = new Error("Cannot find WebGPU adapter");
    await act(() => result.current.send("open paint"));
    // The engine fell back to the rules, whose reply is rendered with its markers hidden.
    expect(state.replies).toBe(1);
    expect(result.current.messages[1]?.text).toBe(
      "The rules say hello. [open_app:paint]",
    );
    expect(result.current.backend.kind).toBe("rules");
    expect(result.current.error).toBeNull();
  });

  it("reports a model that breaks mid-loop, and one that fails to load while still claiming the loop", async () => {
    const { result } = setup([
      async () => {
        throw new Error("GPU device lost");
      },
    ]);
    await act(() => result.current.send("open paint"));
    expect(result.current.error).toBe("GPU device lost");
    expect(result.current.messages.map((message) => message.role)).toEqual([
      "user",
    ]);
  });

  it("uses the marker pipeline for an engine without the loop, or a desktop without typed tools", async () => {
    const markers = setup([]);
    markers.state.style = "markers";
    await act(() => markers.result.current.send("hello"));
    expect(markers.state.replies).toBe(1);

    const noAgent = setup([]);
    noAgent.rerender({
      engine: noAgent.engine,
      options: { ...noAgent.options, agent: undefined },
    });
    await act(() => noAgent.result.current.send("hello"));
    expect(noAgent.state.replies).toBe(1);

    const noComplete = setup([]);
    const partial: ChatEngine = {
      ...noComplete.engine,
      complete: undefined,
    };
    noComplete.rerender({ engine: partial, options: noComplete.options });
    await act(() => noComplete.result.current.send("hello"));
    expect(noComplete.result.current.messages[1]?.text).toBe(
      "The rules say hello. [open_app:paint]",
    );
  });

  it("holds the model to the parts the desktop's checklist names for the request", async () => {
    const asked: string[] = [];
    const { result, os, state } = setup(
      [
        call("open_app", { id: "paint" }),
        call("answer", { text: "Paint is open and the music plays!" }),
        call("music", { action: "play" }),
        call("answer", { text: "Now both are true." }),
      ],
      {
        checklist: (request) => {
          asked.push(request);
          return [
            { part: "open paint", tools: ["open_app"] },
            { part: "play music", tools: ["music"] },
          ];
        },
      },
    );
    await act(() => result.current.send("open paint and play music"));
    expect(asked).toEqual(["open paint and play music"]);
    expect(result.current.messages[1]?.text).toBe("Now both are true.");
    expect(os.log).toEqual(["open untitled - Paint", "music openAndPlay"]);
    expect(state.requests[2]?.messages.at(-1)?.content).toMatch(
      /^Not finished: you have not done "play music" yet\./,
    );
  });

  it("honours a step cap and a settle of the desktop's own", async () => {
    let settled = 0;
    const { result, os } = setup(
      [
        call("open_app", { id: "paint" }),
        call("answer", { text: "Only Paint, sorry." }),
      ],
      {
        maxSteps: 1,
        settle: async () => {
          settled += 1;
        },
      },
    );
    await act(() => result.current.send("open paint and doom"));
    expect(result.current.messages[1]?.text).toBe("Only Paint, sorry.");
    expect(os.log).toEqual(["open untitled - Paint"]);
    expect(settled).toBe(1);
    await expect(nextTask()).resolves.toBeUndefined();
  });
});
