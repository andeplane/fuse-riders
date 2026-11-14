import type {
  AgentTool,
  AgentToolResult,
  JsonSchema,
} from "../agenttools/agentTool";
import {
  ANSWER_TOOL,
  argsSchema,
  coerceArgs,
  stepSchema,
} from "../agenttools/agentTool";

import type { LlmMessage } from "./llmChat";
import type { ToolCallEvent } from "./tools";

/**
 * Clippy as an agent: the model asks for one tool at a time, the desktop runs it, the model is told what
 * happened, and so on until it answers or the step cap is reached. Two wire formats, chosen per model
 * (`modelCatalog.ts`): "json", where every reply is one `{"tool","args"}` object that web-llm's grammar holds to
 * the tools' schema, and "native", OpenAI-style `tools`/`tool_calls` for the models web-llm supports them on.
 * Pure: the model is a `complete` function, the clock a pair of timers, so a scripted fake drives every path.
 */
export type AgentLoopStyle = "json" | "native";

/** A tool as OpenAI-style function calling declares it. */
export type FunctionToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
};

export type NativeToolCall = { name: string; arguments: string };

export type AgentCompletion = {
  text: string;
  /** Present when the model answered with native tool calls. */
  toolCalls?: readonly NativeToolCall[];
};

export type AgentCompletionRequest = {
  /** The system prompt first (json), then the conversation and the steps so far. */
  messages: readonly LlmMessage[];
  signal: AbortSignal;
  /** JSON mode: the schema the reply must satisfy. */
  jsonSchema?: string;
  /** Native function calling: the tools the model may call. */
  tools?: readonly FunctionToolDef[];
};

export type AgentComplete = (
  request: AgentCompletionRequest,
) => Promise<AgentCompletion>;

export type AgentTimers = {
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
};

export const MAX_AGENT_STEPS = 8;
/** How long one reply of the model may take before the turn is given up. */
export const GENERATION_TIMEOUT_MS = 90_000;
/** How long one tool may run before the step counts as failed. */
export const TOOL_TIMEOUT_MS = 15_000;
/** How many times in a row the very same call runs before the model is told to move on. */
export const MAX_REPEATS = 2;
/** How much of a tool's result the model reads back. */
export const MAX_OBSERVATION_CHARS = 1500;

/**
 * One thing the user asked for, and the tools that would do it. The loop does not take an answer while a part
 * has had no call: a small model often does the first half of "open Paint and play music" and reports both.
 */
export type AgentChecklistItem = {
  /** The user's own words for this part, e.g. "play music". */
  part: string;
  /** Any of these tools counts as having done it. */
  tools: readonly string[];
};

/**
 * The parts no call has covered yet. Calls are matched to parts in order and each call covers one part, so
 * "open Paint and open Winamp" needs two `open_app` calls.
 */
export function missingParts(
  checklist: readonly AgentChecklistItem[],
  called: readonly string[],
): AgentChecklistItem[] {
  const unused = [...called];
  return checklist.filter((item) => {
    const index = unused.findIndex((name) => item.tools.includes(name));
    if (index === -1) return true;
    unused.splice(index, 1);
    return false;
  });
}

export type AgentLoopOptions = {
  style: AgentLoopStyle;
  complete: AgentComplete;
  tools: readonly AgentTool[];
  /** Clippy's standing instructions and the desktop as it is now. */
  system: string;
  /** The conversation so far, the new request last. */
  messages: readonly LlmMessage[];
  signal: AbortSignal;
  /** Every tool call as it starts and ends, for the step log. */
  onStep: (event: ToolCallEvent) => void;
  /** What Clippy is doing between steps ("Thinking (step 2 of 8)"). */
  onProgress: (text: string) => void;
  timers: AgentTimers;
  /** Lets the desktop catch up after a tool (a window opened must be on screen before the next step looks). */
  settle?: () => Promise<void>;
  maxSteps?: number;
  /** What the request asks for, part by part, when the desktop can tell (`requestChecklist`); empty otherwise. */
  checklist?: readonly AgentChecklistItem[];
  generationTimeoutMs?: number;
  toolTimeoutMs?: number;
};

export type AgentStopReason =
  "answered" | "step-cap" | "cancelled" | "confused" | "timeout";

export type AgentOutcome = {
  /** What Clippy says at the end. */
  text: string;
  /** How many tools ran. */
  steps: number;
  stopped: AgentStopReason;
};

export const CONFUSED_REPLY =
  "I got my wires crossed and could not work out what to do. Could you say it another way?";
export const TIMEOUT_REPLY = "That took too long, so I stopped.";
export const CANCELLED_REPLY = "Stopped.";

type Step =
  | { kind: "call"; name: string; args: unknown }
  | { kind: "answer"; text: string }
  | { kind: "malformed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first balanced `{...}` in a reply, so JSON wrapped in prose or a code fence still parses. */
export function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stepOf(value: unknown): Step {
  if (!isRecord(value)) return { kind: "malformed" };
  // `{"tool","args"}` is the format asked for; `{"name","arguments"}` is what tool-trained models often write.
  const name = value.tool ?? value.name;
  const given = value.args ?? value.arguments ?? value.parameters ?? {};
  // Arguments as a JSON string are what OpenAI-style calls carry; any other string is the answer's own words.
  const args = typeof given === "string" ? (parseJson(given) ?? given) : given;
  if (typeof name !== "string" || name.trim() === "") {
    const answer = value.answer ?? value.text;
    return typeof answer === "string"
      ? { kind: "answer", text: answer }
      : { kind: "malformed" };
  }
  if (name === ANSWER_TOOL) {
    const text = isRecord(args) ? args.text : args;
    return typeof text === "string"
      ? { kind: "answer", text }
      : { kind: "malformed" };
  }
  return { kind: "call", name: name.trim(), args };
}

/**
 * One reply of a JSON-style model as a step. A reply with no JSON object at all is taken as the answer in
 * plain words (a model that just talks is not an error); an object that does not parse or has no tool is malformed.
 */
export function parseJsonSteps(text: string): Step[] {
  const trimmed = text.trim();
  if (!trimmed.includes("{"))
    return [
      trimmed === ""
        ? { kind: "malformed" }
        : { kind: "answer", text: trimmed },
    ];
  const candidate = extractJsonObject(trimmed);
  if (candidate === undefined) return [{ kind: "malformed" }];
  return [stepOf(parseJson(candidate))];
}

function stepsOf(style: AgentLoopStyle, completion: AgentCompletion): Step[] {
  if (style === "json") return parseJsonSteps(completion.text);
  const calls = completion.toolCalls ?? [];
  if (calls.length === 0) {
    const text = completion.text.trim();
    return [text === "" ? { kind: "malformed" } : { kind: "answer", text }];
  }
  return calls.map((call) => {
    const args = parseJson(call.arguments || "{}");
    return args === undefined
      ? { kind: "malformed" }
      : { kind: "call", name: call.name, args };
  });
}

export function functionToolDefs(
  tools: readonly AgentTool[],
): FunctionToolDef[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: argsSchema(tool),
    },
  }));
}

function clip(text: string): string {
  return text.length <= MAX_OBSERVATION_CHARS
    ? text
    : `${text.slice(0, MAX_OBSERVATION_CHARS)}... (cut)`;
}

class StepTimeout extends Error {}

/** Settles with the promise, or rejects with `StepTimeout` (after `onTimeout`) when it takes longer than `ms`. */
function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  timers: AgentTimers,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = timers.setTimeout(() => {
      onTimeout();
      reject(new StepTimeout());
    }, ms);
    work.then(
      (value) => {
        timers.clearTimeout(handle);
        resolve(value);
      },
      (error: unknown) => {
        timers.clearTimeout(handle);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

const RETRY_JSON =
  'That was not a tool call. Reply with exactly one JSON object and nothing else, like {"tool":"answer","args":{"text":"..."}}.';
const RETRY_NATIVE =
  "That was not a valid tool call. Call one tool, or answer the user in plain words.";
const NEXT = `If the user's request is not finished, call the next tool; if it is, call ${ANSWER_TOOL}.`;
const WRAP_UP =
  "You have used all your steps. Tell the user in one or two sentences what you did and what is left.";

/** What Clippy says when the model never got to an answer: the things that did get done. */
function summary(done: readonly string[], lead: string): string {
  return done.length === 0 ? lead : `${lead} So far: ${done.join("; ")}.`;
}

export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentOutcome> {
  const {
    style,
    complete,
    tools,
    signal,
    onStep,
    onProgress,
    timers,
    settle = () => Promise.resolve(),
    maxSteps = MAX_AGENT_STEPS,
    checklist = [],
    generationTimeoutMs = GENERATION_TIMEOUT_MS,
    toolTimeoutMs = TOOL_TIMEOUT_MS,
  } = options;
  // web-llm takes no system prompt next to native `tools`, so there the instructions lead the first request.
  const transcript: LlmMessage[] =
    style === "json"
      ? [{ role: "system", content: options.system }, ...options.messages]
      : options.messages.map((message, index) =>
          index === 0
            ? { ...message, content: `${options.system}\n\n${message.content}` }
            : message,
        );
  const done: string[] = [];
  let steps = 0;
  let lastCall = "";
  let repeats = 0;
  /** The tools that ran, in order, and the parts the model has already been reminded of. */
  const called: string[] = [];
  const reminded = new Set<AgentChecklistItem>();
  /** The tools of a part that this desktop has, as the reminder names them. */
  const hint = (item: AgentChecklistItem): string => {
    const names = item.tools.filter((name) =>
      tools.some((tool) => tool.name === name),
    );
    return names.length === 0 ? "the tool" : names.slice(0, 2).join(" or ");
  };
  const outcome = (text: string, stopped: AgentStopReason): AgentOutcome => ({
    text,
    steps,
    stopped,
  });
  const cancelled = () => outcome(summary(done, CANCELLED_REPLY), "cancelled");

  /** One reply of the model, cut off after the timeout; a cancel or a timeout interrupts the generation. */
  const generate = (answerOnly: boolean): Promise<AgentCompletion> => {
    const turn = new AbortController();
    const cancel = () => turn.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const request: AgentCompletionRequest =
      style === "json"
        ? {
            messages: transcript,
            signal: turn.signal,
            jsonSchema: stepSchema(tools, { answerOnly }),
          }
        : {
            messages: transcript,
            signal: turn.signal,
            ...(answerOnly ? {} : { tools: functionToolDefs(tools) }),
          };
    return withTimeout(
      complete(request),
      generationTimeoutMs,
      timers,
      cancel,
    ).finally(() => signal.removeEventListener("abort", cancel));
  };

  /** The model's next steps; a malformed reply gets one corrective retry before the turn is given up. */
  const next = async (answerOnly: boolean): Promise<Step[]> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const completion = await generate(answerOnly);
      const parsed = stepsOf(style, completion);
      if (!parsed.some((step) => step.kind === "malformed")) return parsed;
      transcript.push(
        { role: "assistant", content: completion.text || "(nothing)" },
        { role: "user", content: style === "json" ? RETRY_JSON : RETRY_NATIVE },
      );
    }
    return [{ kind: "malformed" }];
  };

  const runTool = async (
    tool: AgentTool,
    args: Parameters<AgentTool["run"]>[0],
  ): Promise<AgentToolResult> => {
    const name = tool.name;
    onStep({ name, sentence: tool.sentence(args), phase: "started" });
    let result: AgentToolResult;
    try {
      result = await withTimeout(
        Promise.resolve().then(() => tool.run(args)),
        toolTimeoutMs,
        timers,
        () => undefined,
      );
    } catch (error) {
      result = {
        ok: false,
        sentence:
          error instanceof StepTimeout
            ? `${name} took too long`
            : error instanceof Error
              ? error.message
              : String(error),
      };
    }
    onStep({
      name,
      sentence: result.sentence,
      phase: result.ok ? "finished" : "failed",
    });
    return result;
  };

  try {
    while (steps < maxSteps) {
      if (signal.aborted) return cancelled();
      onProgress(
        steps === 0
          ? "Thinking"
          : `Thinking (step ${steps + 1} of ${maxSteps})`,
      );
      // A model stuck on one call gets a reply that can only be an answer.
      const parsed = await next(repeats >= MAX_REPEATS);
      if (signal.aborted) return cancelled();
      for (const step of parsed) {
        if (step.kind === "malformed")
          return outcome(summary(done, CONFUSED_REPLY), "confused");
        if (step.kind === "answer") {
          // Each part is asked for once: a model that still will not do it has its answer taken.
          const missing = missingParts(checklist, called).find(
            (item) => !reminded.has(item),
          );
          if (missing && repeats < MAX_REPEATS) {
            reminded.add(missing);
            transcript.push(
              {
                role: "assistant",
                content: JSON.stringify({
                  tool: ANSWER_TOOL,
                  args: { text: step.text },
                }),
              },
              {
                role: "user",
                content: `Not finished: you have not done "${missing.part}" yet. Call ${hint(missing)} for it now; ${ANSWER_TOOL} comes after.`,
              },
            );
            steps += 1;
            break;
          }
          return outcome(
            step.text.trim() || summary(done, "Done!"),
            "answered",
          );
        }
        const call = JSON.stringify({ tool: step.name, args: step.args });
        const tool = tools.find((candidate) => candidate.name === step.name);
        repeats = call === lastCall ? repeats + 1 : 0;
        lastCall = call;
        let observation: string;
        if (repeats >= MAX_REPEATS) {
          // A small model can get stuck asking for the same thing; the third time it is told instead of obeyed.
          observation = `You already did exactly that ${repeats} times. Do not repeat it.`;
        } else if (!tool) {
          observation = `There is no tool "${step.name}". The tools are: ${tools.map((candidate) => candidate.name).join(", ")}, ${ANSWER_TOOL}.`;
        } else {
          const coerced = coerceArgs(tool, step.args);
          if (!coerced.ok) observation = `Not done: ${coerced.error}.`;
          else {
            const result = await runTool(tool, coerced.args);
            called.push(tool.name);
            if (result.ok) done.push(result.sentence);
            observation = `${result.ok ? "Done" : "Failed"}: ${result.observation ?? result.sentence}`;
            await settle();
          }
        }
        steps += 1;
        transcript.push(
          { role: "assistant", content: call },
          {
            role: "user",
            content: `Result of ${step.name}: ${clip(observation)}\n${NEXT}`,
          },
        );
        if (signal.aborted) return cancelled();
        if (steps >= maxSteps) break;
      }
    }
    // Out of steps: one last reply that can only be an answer.
    onProgress("Wrapping up");
    transcript.push({ role: "user", content: WRAP_UP });
    const [last] = await next(true);
    if (signal.aborted) return cancelled();
    return outcome(
      last?.kind === "answer" && last.text.trim() !== ""
        ? last.text.trim()
        : summary(done, `I stopped after ${maxSteps} steps.`),
      "step-cap",
    );
  } catch (error) {
    if (signal.aborted) return cancelled();
    if (error instanceof StepTimeout)
      return outcome(summary(done, TIMEOUT_REPLY), "timeout");
    throw error;
  }
}
