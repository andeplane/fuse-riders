import type { FakeAgentOs } from "../__mocks__/agentOs";
import { createFakeAgentOs } from "../__mocks__/agentOs";
import type { AgentTool } from "../agenttools/agentTool";
import { createAgentTools } from "../agenttools/createAgentTools";

import type {
  AgentCompletion,
  AgentCompletionRequest,
  AgentLoopOptions,
  AgentTimers,
} from "./agentLoop";
import {
  CANCELLED_REPLY,
  CONFUSED_REPLY,
  extractJsonObject,
  functionToolDefs,
  GENERATION_TIMEOUT_MS,
  MAX_AGENT_STEPS,
  missingParts,
  MAX_OBSERVATION_CHARS,
  parseJsonSteps,
  runAgentLoop,
  TIMEOUT_REPLY,
  TOOL_TIMEOUT_MS,
} from "./agentLoop";
import type { ToolCallEvent } from "./tools";

type Timer = { id: number; callback: () => void; ms: number };

/** Timers that fire only when a test says so. */
function manualTimers(): AgentTimers & {
  pending: Timer[];
  fire(ms: number): void;
} {
  const pending: Timer[] = [];
  let next = 1;
  return {
    pending,
    setTimeout: (callback, ms) => {
      pending.push({ id: next, callback, ms });
      next += 1;
      return next - 1;
    },
    clearTimeout: (handle) => {
      const index = pending.findIndex((timer) => timer.id === handle);
      if (index !== -1) pending.splice(index, 1);
    },
    fire: (ms) => {
      const due = pending.filter((timer) => timer.ms === ms);
      due.forEach((timer) => {
        pending.splice(pending.indexOf(timer), 1);
        timer.callback();
      });
    },
  };
}

function call(tool: string, args: Record<string, unknown> = {}): string {
  return JSON.stringify({ tool, args });
}

function answer(text: string): string {
  return call("answer", { text });
}

type Scripted =
  | string
  | AgentCompletion
  | ((request: AgentCompletionRequest) => Promise<AgentCompletion>);

/** A scripted model: each completion takes the next reply; every request is kept for the assertions. */
function scriptedModel(script: Scripted[]) {
  const requests: AgentCompletionRequest[] = [];
  const replies = [...script];
  return {
    requests,
    complete: async (
      request: AgentCompletionRequest,
    ): Promise<AgentCompletion> => {
      requests.push({ ...request, messages: [...request.messages] });
      const reply = replies.shift();
      if (reply === undefined) throw new Error("the script ran out");
      if (typeof reply === "function") return reply(request);
      return typeof reply === "string" ? { text: reply } : reply;
    },
  };
}

type Run = {
  os: FakeAgentOs;
  tools: AgentTool[];
  events: ToolCallEvent[];
  progress: string[];
  timers: ReturnType<typeof manualTimers>;
  options: AgentLoopOptions;
};

function setup(
  script: Scripted[],
  overrides: Partial<AgentLoopOptions> = {},
): Run & { model: ReturnType<typeof scriptedModel> } {
  const os = createFakeAgentOs();
  const tools = createAgentTools(os, { current: undefined });
  const events: ToolCallEvent[] = [];
  const progress: string[] = [];
  const timers = manualTimers();
  const model = scriptedModel(script);
  return {
    os,
    tools,
    events,
    progress,
    timers,
    model,
    options: {
      style: "json",
      complete: model.complete,
      tools,
      system: "You are Clippy.",
      messages: [{ role: "user", content: "open fuseball and play music" }],
      signal: new AbortController().signal,
      onStep: (event) => events.push(event),
      onProgress: (text) => progress.push(text),
      timers,
      ...overrides,
    },
  };
}

describe(runAgentLoop.name, () => {
  it("runs each tool the model asks for, feeds the result back, and ends on the answer", async () => {
    const run = setup([
      call("open_app", { id: "fuseball" }),
      call("music", { action: "play" }),
      answer("Fuseball is open and the music is on!"),
    ]);
    const outcome = await runAgentLoop(run.options);

    expect(outcome).toEqual({
      text: "Fuseball is open and the music is on!",
      steps: 2,
      stopped: "answered",
    });
    expect(run.os.log).toEqual(["launch fuseball window", "music openAndPlay"]);
    expect(run.events).toEqual([
      { name: "open_app", sentence: "Opening Fuseball", phase: "started" },
      { name: "open_app", sentence: "Opened Fuseball", phase: "finished" },
      { name: "music", sentence: "Playing music in Winamp", phase: "started" },
      {
        name: "music",
        sentence: "Starting Winamp with the Fuse soundtrack",
        phase: "finished",
      },
    ]);
    expect(run.progress).toEqual([
      "Thinking",
      `Thinking (step 2 of ${MAX_AGENT_STEPS})`,
      `Thinking (step 3 of ${MAX_AGENT_STEPS})`,
    ]);
    // The third request carries the system prompt, the question, and both calls with their results.
    const last = run.model.requests[2];
    expect(last?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(last?.messages[2]?.content).toBe(
      call("open_app", { id: "fuseball" }),
    );
    expect(last?.messages[3]?.content).toMatch(
      /^Result of open_app: Done: Opened Fuseball\n/,
    );
    // Every reply is held to the tools' schema, the answer included.
    const schema: unknown = JSON.parse(last?.jsonSchema ?? "{}");
    expect(schema).toMatchObject({ anyOf: expect.any(Array) });
    expect(last?.jsonSchema).toContain('"const":"open_app"');
    expect(last?.jsonSchema).toContain('"const":"answer"');
    expect(last?.tools).toBeUndefined();
    expect(run.timers.pending).toEqual([]);
  });

  it("answers straight away when nothing needs doing, and takes plain words as the answer", async () => {
    const direct = setup([answer("  Hi there!  ")]);
    expect(await runAgentLoop(direct.options)).toEqual({
      text: "Hi there!",
      steps: 0,
      stopped: "answered",
    });
    const prose = setup(["I'm Clippy, a paperclip."]);
    expect((await runAgentLoop(prose.options)).text).toBe(
      "I'm Clippy, a paperclip.",
    );
    // An empty answer after doing something reads back what was done.
    const silent = setup([call("open_app", { id: "paint" }), answer(" ")]);
    expect((await runAgentLoop(silent.options)).text).toBe(
      "Done! So far: Opened Paint.",
    );
    const nothing = setup([answer("")]);
    expect((await runAgentLoop(nothing.options)).text).toBe("Done!");
  });

  it("feeds a failed tool, an unknown tool and bad arguments back instead of stopping", async () => {
    const run = setup([
      call("close_window", { window: "excel" }),
      call("format_disk", { drive: "C:" }),
      call("open_app", { id: "excel" }),
      call("open_app"),
      answer("I could not find Excel."),
    ]);
    const outcome = await runAgentLoop(run.options);
    expect(outcome).toMatchObject({ steps: 4, stopped: "answered" });
    // Only the tool that ran is in the step log.
    expect(run.events.map((event) => `${event.name} ${event.phase}`)).toEqual([
      "close_window started",
      "close_window failed",
    ]);
    const results = run.model.requests[4]?.messages
      .filter((message) => message.content.startsWith("Result of"))
      .map((message) => message.content.split("\n")[0]);
    expect(results).toEqual([
      'Result of close_window: Failed: No window matches "excel". Open windows: none.',
      expect.stringMatching(
        /^Result of format_disk: There is no tool "format_disk"\. The tools are: get_desktop_state, .*, answer\.$/,
      ),
      expect.stringMatching(
        /^Result of open_app: Not done: open_app has no id "excel"; use one of: /,
      ),
      'Result of open_app: Not done: open_app needs "id".',
    ]);
  });

  it("stops at the step cap and asks for a closing answer that can only be an answer", async () => {
    const run = setup(
      [
        call("open_app", { id: "paint" }),
        call("open_app", { id: "winamp" }),
        answer("I opened Paint and Winamp; DOOM is still to do."),
      ],
      { maxSteps: 2 },
    );
    const outcome = await runAgentLoop(run.options);
    expect(outcome).toEqual({
      text: "I opened Paint and Winamp; DOOM is still to do.",
      steps: 2,
      stopped: "step-cap",
    });
    expect(run.os.log).toEqual(["open untitled - Paint", "open Winamp"]);
    const wrapUp = run.model.requests[2];
    expect(wrapUp?.jsonSchema).not.toContain('"const":"open_app"');
    expect(wrapUp?.jsonSchema).toContain('"const":"answer"');
    expect(wrapUp?.messages.at(-1)?.content).toMatch(/used all your steps/);
    expect(run.progress.at(-1)).toBe("Wrapping up");
  });

  it("sums up what was done when the closing answer never comes", async () => {
    const run = setup(
      [call("open_app", { id: "paint" }), call("open_app", { id: "doom" })],
      { maxSteps: 1 },
    );
    // The wrap-up asks for an answer; the model calls a tool again instead.
    expect(await runAgentLoop(run.options)).toEqual({
      text: "I stopped after 1 steps. So far: Opened Paint.",
      steps: 1,
      stopped: "step-cap",
    });
  });

  it("retries a malformed reply once, with a correction, and carries on", async () => {
    const run = setup([
      '{"tool": "open_app", "args": {"id": ',
      call("open_app", { id: "paint" }),
      answer("Paint is open."),
    ]);
    const outcome = await runAgentLoop(run.options);
    expect(outcome).toEqual({
      text: "Paint is open.",
      steps: 1,
      stopped: "answered",
    });
    const retry = run.model.requests[1]?.messages;
    expect(retry?.at(-2)).toEqual({
      role: "assistant",
      content: '{"tool": "open_app", "args": {"id": ',
    });
    expect(retry?.at(-1)?.content).toMatch(/exactly one JSON object/);
  });

  it("gives up gracefully when the reply is malformed twice, saying what did get done", async () => {
    const confused = setup(["{nope", "{{{"]);
    expect(await runAgentLoop(confused.options)).toEqual({
      text: CONFUSED_REPLY,
      steps: 0,
      stopped: "confused",
    });
    expect(confused.model.requests).toHaveLength(2);

    const halfway = setup([call("open_app", { id: "paint" }), "", '{"x":1}']);
    expect(await runAgentLoop(halfway.options)).toEqual({
      text: `${CONFUSED_REPLY} So far: Opened Paint.`,
      steps: 1,
      stopped: "confused",
    });
    // An empty reply reads back as "(nothing)" in the correction.
    expect(halfway.model.requests[2]?.messages.at(-2)?.content).toBe(
      "(nothing)",
    );
  });

  it("tells a model stuck on one call to move on, then only lets it answer", async () => {
    const run = setup([
      call("list_games"),
      call("list_games"),
      call("list_games"),
      answer("Fuseball, Fuse Riders and Fuse Birds."),
    ]);
    const outcome = await runAgentLoop(run.options);
    expect(outcome).toMatchObject({ steps: 3, stopped: "answered" });
    // The third identical call did not run.
    expect(
      run.events.filter((event) => event.phase === "started"),
    ).toHaveLength(2);
    const last = run.model.requests[3];
    expect(last?.messages.at(-1)?.content).toMatch(
      /^Result of list_games: You already did exactly that 2 times\. Do not repeat it\./,
    );
    expect(last?.jsonSchema).not.toContain('"const":"list_games"');
  });

  it("cancels between steps and mid-generation, keeping what was done", async () => {
    const controller = new AbortController();
    const before = setup([answer("never")], { signal: controller.signal });
    controller.abort();
    expect(await runAgentLoop(before.options)).toEqual({
      text: CANCELLED_REPLY,
      steps: 0,
      stopped: "cancelled",
    });
    expect(before.model.requests).toEqual([]);

    const midway = new AbortController();
    let interrupted = false;
    const run = setup(
      [
        call("open_app", { id: "paint" }),
        (request) =>
          new Promise<AgentCompletion>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => {
              interrupted = true;
              reject(new Error("interrupted"));
            });
            midway.abort();
          }),
      ],
      { signal: midway.signal },
    );
    expect(await runAgentLoop(run.options)).toEqual({
      text: `${CANCELLED_REPLY} So far: Opened Paint.`,
      steps: 1,
      stopped: "cancelled",
    });
    expect(interrupted).toBe(true);
    expect(run.timers.pending).toEqual([]);
  });

  it("cancels after a completion that came back, and after a tool that was running", async () => {
    const afterReply = new AbortController();
    const first = setup(
      [
        async () => {
          afterReply.abort();
          return { text: call("open_app", { id: "paint" }) };
        },
      ],
      { signal: afterReply.signal },
    );
    expect(await runAgentLoop(first.options)).toMatchObject({
      steps: 0,
      stopped: "cancelled",
    });
    expect(first.os.log).toEqual([]);

    const duringTool = new AbortController();
    const second = setup([call("open_app", { id: "paint" }), answer("never")], {
      signal: duringTool.signal,
      settle: async () => duringTool.abort(),
    });
    expect(await runAgentLoop(second.options)).toEqual({
      text: `${CANCELLED_REPLY} So far: Opened Paint.`,
      steps: 1,
      stopped: "cancelled",
    });
    expect(second.model.requests).toHaveLength(1);
  });

  it("gives a reply that takes too long up, interrupting the model", async () => {
    let interrupted = false;
    const run = setup([
      call("open_app", { id: "paint" }),
      (request) =>
        new Promise<AgentCompletion>(() => {
          request.signal.addEventListener("abort", () => {
            interrupted = true;
          });
          queueMicrotask(() => run.timers.fire(GENERATION_TIMEOUT_MS));
        }),
    ]);
    expect(await runAgentLoop(run.options)).toEqual({
      text: `${TIMEOUT_REPLY} So far: Opened Paint.`,
      steps: 1,
      stopped: "timeout",
    });
    expect(interrupted).toBe(true);
  });

  it("counts a tool that hangs or throws as a failed step and carries on", async () => {
    const run = setup([
      call("hang"),
      call("explode"),
      call("refuse"),
      answer("Well, I tried."),
    ]);
    const hang: AgentTool = {
      name: "hang",
      description: "Never returns.",
      parameters: [],
      sentence: () => "Hanging",
      run: () =>
        new Promise(() => {
          queueMicrotask(() => run.timers.fire(TOOL_TIMEOUT_MS));
        }),
    };
    const explode: AgentTool = {
      name: "explode",
      description: "Throws.",
      parameters: [],
      sentence: () => "Exploding",
      run: () => {
        throw new Error("The drive is not ready");
      },
    };
    const refuse: AgentTool = {
      name: "refuse",
      description: "Rejects with something that is not an Error.",
      parameters: [],
      sentence: () => "Refusing",
      run: () => Promise.reject("no"),
    };
    const outcome = await runAgentLoop({
      ...run.options,
      tools: [hang, explode, refuse],
    });
    expect(outcome).toEqual({
      text: "Well, I tried.",
      steps: 3,
      stopped: "answered",
    });
    expect(run.events.filter((event) => event.phase === "failed")).toEqual([
      { name: "hang", sentence: "hang took too long", phase: "failed" },
      { name: "explode", sentence: "The drive is not ready", phase: "failed" },
      { name: "refuse", sentence: "no", phase: "failed" },
    ]);
  });

  it("lets a model error through, so the chat can show it", async () => {
    const run = setup([
      async () => {
        throw new Error("GPU device lost");
      },
    ]);
    await expect(runAgentLoop(run.options)).rejects.toThrow("GPU device lost");
    const odd = setup([() => Promise.reject("lost")]);
    await expect(runAgentLoop(odd.options)).rejects.toThrow("lost");
  });

  it("cuts a long result short and waits for the desktop to settle after each tool", async () => {
    let settled = 0;
    const run = setup([call("wordy"), answer("ok")], {
      settle: async () => {
        settled += 1;
      },
    });
    const wordy: AgentTool = {
      name: "wordy",
      description: "Says a lot.",
      parameters: [],
      sentence: () => "Talking",
      run: () => ({
        ok: true,
        sentence: "Said a lot",
        observation: "x".repeat(MAX_OBSERVATION_CHARS + 10),
      }),
    };
    await runAgentLoop({ ...run.options, tools: [wordy] });
    expect(settled).toBe(1);
    expect(run.model.requests[1]?.messages.at(-1)?.content).toContain(
      `${"x".repeat(MAX_OBSERVATION_CHARS - "Done: ".length)}... (cut)\n`,
    );
  });

  it("drives native function calling: tools declared, tool calls run, plain words answer", async () => {
    const run = setup(
      [
        {
          text: "",
          toolCalls: [
            { name: "open_app", arguments: '{"id":"paint"}' },
            { name: "music", arguments: '{"action":"play"}' },
          ],
        },
        { text: "Paint is open and the music is on." },
      ],
      {
        style: "native",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "Hi!" },
          { role: "user", content: "open paint and play music" },
        ],
      },
    );
    const outcome = await runAgentLoop(run.options);
    expect(outcome).toEqual({
      text: "Paint is open and the music is on.",
      steps: 2,
      stopped: "answered",
    });
    expect(run.os.log).toEqual(["open untitled - Paint", "music openAndPlay"]);
    const first = run.model.requests[0];
    // web-llm takes no system prompt next to `tools`: the instructions lead the first message.
    expect(first?.messages[0]).toEqual({
      role: "user",
      content: "You are Clippy.\n\nhello",
    });
    expect(first?.messages).toHaveLength(3);
    expect(first?.jsonSchema).toBeUndefined();
    expect(first?.tools).toEqual(functionToolDefs(run.tools));
    expect(first?.tools?.[1]).toMatchObject({
      type: "function",
      function: { name: "open_app", parameters: { type: "object" } },
    });
  });

  it("handles the odd native reply: empty, unparseable arguments, no arguments, a call at the wrap-up", async () => {
    const empty = setup([{ text: " " }, { text: "" }], { style: "native" });
    expect(await runAgentLoop(empty.options)).toMatchObject({
      stopped: "confused",
    });
    expect(empty.model.requests[1]?.messages.at(-1)?.content).toMatch(
      /not a valid tool call/,
    );

    const broken = setup(
      [
        { text: "", toolCalls: [{ name: "open_app", arguments: "{oops" }] },
        { text: "", toolCalls: [{ name: "list_games", arguments: "" }] },
        { text: "", toolCalls: [{ name: "list_games", arguments: "" }] },
      ],
      { style: "native", maxSteps: 1 },
    );
    expect(await runAgentLoop(broken.options)).toEqual({
      text: "I stopped after 1 steps. So far: Found 3 Fuse games and 2 retro games.",
      steps: 1,
      stopped: "step-cap",
    });
    // The wrap-up declares no tools.
    expect(broken.model.requests[2]?.tools).toBeUndefined();
  });
});

describe("the checklist", () => {
  const checklist = [
    { part: "open fuseball", tools: ["open_app", "launch_game"] },
    { part: "play music", tools: ["music"] },
  ];

  it("does not take an answer while a part of the request has had no call, and names the part and its tool", async () => {
    const run = setup(
      [
        call("open_app", { id: "fuseball" }),
        answer("Fuseball is open and the music is playing!"),
        call("music", { action: "play" }),
        answer("Now it really is."),
      ],
      { checklist },
    );
    const outcome = await runAgentLoop(run.options);
    expect(outcome).toEqual({
      text: "Now it really is.",
      steps: 3,
      stopped: "answered",
    });
    expect(run.os.log).toEqual(["launch fuseball window", "music openAndPlay"]);
    const reminded = run.model.requests[2]?.messages;
    expect(reminded?.at(-2)).toEqual({
      role: "assistant",
      content: answer("Fuseball is open and the music is playing!"),
    });
    expect(reminded?.at(-1)?.content).toBe(
      'Not finished: you have not done "play music" yet. Call music for it now; answer comes after.',
    );
  });

  it("reminds of each part once: a model that still will not do it has its answer taken", async () => {
    const run = setup(
      [answer("All done!"), answer("Really, all done."), answer("I insist.")],
      { checklist },
    );
    expect(await runAgentLoop(run.options)).toEqual({
      text: "I insist.",
      steps: 2,
      stopped: "answered",
    });
    const reminders = run.model.requests[2]?.messages
      .filter((message) => message.content.startsWith("Not finished"))
      .map((message) => message.content);
    expect(reminders).toEqual([
      'Not finished: you have not done "open fuseball" yet. Call open_app or launch_game for it now; answer comes after.',
      'Not finished: you have not done "play music" yet. Call music for it now; answer comes after.',
    ]);
  });

  it("takes the answer when every part has its call, and does not remind a model that is stuck", async () => {
    const complete = setup(
      [
        call("launch_game", { id: "fuseball" }),
        call("music", { action: "play" }),
        answer("Both done."),
      ],
      { checklist },
    );
    expect(await runAgentLoop(complete.options)).toMatchObject({
      text: "Both done.",
      steps: 2,
    });
    expect(complete.model.requests).toHaveLength(3);

    // Three identical calls: the next reply can only be an answer, and it ends the turn.
    const stuck = setup(
      [
        call("list_games"),
        call("list_games"),
        call("list_games"),
        answer("There are three games."),
      ],
      { checklist },
    );
    expect(await runAgentLoop(stuck.options)).toMatchObject({
      text: "There are three games.",
      stopped: "answered",
    });
  });

  it("matches calls to parts one for one, in order", () => {
    const twice = [
      { part: "open paint", tools: ["open_app"] },
      { part: "open winamp", tools: ["open_app"] },
    ];
    const parts = (called: string[]) =>
      missingParts(twice, called).map((item) => item.part);
    expect(parts([])).toEqual(["open paint", "open winamp"]);
    expect(parts(["open_app"])).toEqual(["open winamp"]);
    expect(parts(["music", "open_app", "open_app"])).toEqual([]);
    expect(missingParts([], ["open_app"])).toEqual([]);
  });

  it("names no tool the desktop does not have", async () => {
    const run = setup([answer("Done."), answer("Done.")], {
      checklist: [{ part: "format the disk", tools: ["format_disk"] }],
    });
    await runAgentLoop(run.options);
    expect(run.model.requests[1]?.messages.at(-1)?.content).toBe(
      'Not finished: you have not done "format the disk" yet. Call the tool for it now; answer comes after.',
    );
  });
});

describe(parseJsonSteps.name, () => {
  it("reads the format asked for, and the shapes tool-trained models write instead", () => {
    expect(parseJsonSteps(call("open_app", { id: "paint" }))).toEqual([
      { kind: "call", name: "open_app", args: { id: "paint" } },
    ]);
    expect(
      parseJsonSteps(
        '{"name":"music","arguments":"{\\"action\\":\\"play\\"}"}',
      ),
    ).toEqual([{ kind: "call", name: "music", args: { action: "play" } }]);
    expect(parseJsonSteps('{"tool":" list_games "}')).toEqual([
      { kind: "call", name: "list_games", args: {} },
    ]);
    expect(parseJsonSteps('{"tool":"x","parameters":{"a":1}}')).toEqual([
      { kind: "call", name: "x", args: { a: 1 } },
    ]);
    expect(parseJsonSteps(answer("hi"))).toEqual([
      { kind: "answer", text: "hi" },
    ]);
    expect(parseJsonSteps('{"tool":"answer","args":"hi"}')).toEqual([
      { kind: "answer", text: "hi" },
    ]);
    expect(parseJsonSteps('{"answer":"hi"}')).toEqual([
      { kind: "answer", text: "hi" },
    ]);
    expect(parseJsonSteps('{"text":"hi"}')).toEqual([
      { kind: "answer", text: "hi" },
    ]);
  });

  it("finds the object inside prose or a code fence, and takes prose alone as the answer", () => {
    expect(
      parseJsonSteps(
        'Sure!\n```json\n{"tool":"show_message","args":{"text":"a } brace \\" quote"}}\n```\nDone.',
      ),
    ).toEqual([
      {
        kind: "call",
        name: "show_message",
        args: { text: 'a } brace " quote' },
      },
    ]);
    expect(parseJsonSteps("Just words.")).toEqual([
      { kind: "answer", text: "Just words." },
    ]);
  });

  it("calls everything else malformed", () => {
    for (const text of [
      "",
      "{",
      '{"tool":"answer","args":{"text":5}}',
      '{"tool":""}',
      '{"tool":7}',
      '{"args":{}}',
      "{not json}",
      "[1,2] {",
    ])
      expect(parseJsonSteps(text)).toEqual([{ kind: "malformed" }]);
    expect(extractJsonObject("no braces")).toBeUndefined();
    expect(extractJsonObject('x {"a":{"b":1}} y')).toBe('{"a":{"b":1}}');
  });
});
