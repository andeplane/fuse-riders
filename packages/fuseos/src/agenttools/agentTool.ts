import type { AssistantTool, ToolInvocation } from "../llm/tools";

/**
 * Clippy's typed tools: what the agent loop (`llm/agentLoop.ts`) calls to operate the desktop the way a user
 * would. A tool declares its parameters, so one definition yields its line in the prompt, the JSON schema
 * that constrains a model's reply (web-llm's grammar keeps a small model to valid names and ids), the argument
 * check, and a `[name:argument]` marker for the single-shot models and the rules (`toMarkerTool`).
 */
export type ArgValue = string | number | boolean;
export type ToolArgs = Readonly<Record<string, ArgValue>>;

export type ParamSpec = {
  name: string;
  type: "string" | "number" | "boolean";
  /** A few words for the prompt. */
  description: string;
  required?: boolean;
  /** The only values a string parameter takes; matched without regard to case. */
  options?: readonly string[];
  /** Other spellings of an option a model or a person may write: "prev" for "previous". */
  aliases?: Readonly<Record<string, string>>;
  /** In the marker format, the fenced code block after the marker fills this parameter. */
  fromBody?: boolean;
};

export type AgentToolResult = {
  ok: boolean;
  /** Plain words for the step log, e.g. "Opened Fuseball". */
  sentence: string;
  /** What the model reads back; the sentence when absent. */
  observation?: string;
};

export interface AgentTool {
  /** Letters, digits and `_`; also the marker name. */
  name: string;
  /** One line for the prompt. */
  description: string;
  parameters: readonly ParamSpec[];
  /** Plain words for the step log while the tool runs, e.g. "Opening Fuseball". */
  sentence: (args: ToolArgs) => string;
  run: (args: ToolArgs) => AgentToolResult | Promise<AgentToolResult>;
}

/** The pseudo tool that ends a turn: `{"tool":"answer","args":{"text":"..."}}`. */
export const ANSWER_TOOL = "answer";

export type CoercedArgs =
  { ok: true; args: ToolArgs } | { ok: false; error: string };

function coerceValue(spec: ParamSpec, value: unknown): ArgValue | undefined {
  switch (spec.type) {
    case "string": {
      if (typeof value !== "string" && typeof value !== "number")
        return undefined;
      const text = String(value);
      if (!spec.options) return text;
      const typed = text.trim().toLowerCase();
      const wanted = (spec.aliases?.[typed] ?? typed).toLowerCase();
      return spec.options.find((option) => option.toLowerCase() === wanted);
    }
    case "number": {
      const number =
        typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : value;
      return typeof number === "number" && Number.isFinite(number)
        ? number
        : undefined;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (typeof value !== "string") return undefined;
      const text = value.trim().toLowerCase();
      if (["true", "yes", "on", "1"].includes(text)) return true;
      if (["false", "no", "off", "0"].includes(text)) return false;
      return undefined;
    }
  }
}

/** Checks what a model (or a marker) passed against the tool's parameters; unknown keys are dropped. */
export function coerceArgs(tool: AgentTool, raw: unknown): CoercedArgs {
  const given: Record<string, unknown> =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? { ...raw }
      : {};
  const args: Record<string, ArgValue> = {};
  for (const spec of tool.parameters) {
    const value = given[spec.name];
    if (value === undefined || value === null || value === "") {
      if (spec.required)
        return { ok: false, error: `${tool.name} needs "${spec.name}"` };
      continue;
    }
    const coerced = coerceValue(spec, value);
    if (coerced === undefined)
      return {
        ok: false,
        error: spec.options
          ? `${tool.name} has no ${spec.name} "${String(value)}"; use one of: ${spec.options.join(", ")}`
          : `${tool.name}'s "${spec.name}" must be a ${spec.type}`,
      };
    args[spec.name] = coerced;
  }
  return { ok: true, args };
}

export function stringArg(args: ToolArgs, name: string): string | undefined {
  const value = args[name];
  return value === undefined ? undefined : String(value);
}

export function numberArg(args: ToolArgs, name: string): number | undefined {
  const value = args[name];
  return typeof value === "number" ? value : undefined;
}

export function booleanArg(args: ToolArgs, name: string): boolean | undefined {
  const value = args[name];
  return typeof value === "boolean" ? value : undefined;
}

/** `open_app(id)`, `music(action, level?)`: the call shape as the prompt shows it. */
export function toolSignature(tool: AgentTool): string {
  return `${tool.name}(${tool.parameters
    .map((spec) => (spec.required ? spec.name : `${spec.name}?`))
    .join(", ")})`;
}

/** A tool's line in the agent prompt: signature, what it does, and what each parameter takes. */
export function describeTool(tool: AgentTool): string {
  const params = tool.parameters
    .map((spec) =>
      spec.options
        ? `${spec.name}: ${spec.options.join("|")}${spec.description === "" ? "" : ` (${spec.description})`}`
        : spec.description === ""
          ? ""
          : `${spec.name}: ${spec.description}`,
    )
    .filter((line) => line !== "");
  return `- ${toolSignature(tool)} ${tool.description}${params.length > 0 ? ` ${params.join("; ")}.` : ""}`;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonSchema = { readonly [key: string]: JsonValue };

function paramSchema(spec: ParamSpec): JsonSchema {
  if (spec.options) return { enum: [...spec.options] };
  return { type: spec.type };
}

/** The JSON schema of a tool's arguments, as OpenAI-style function calling wants it. */
export function argsSchema(tool: AgentTool): JsonSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      tool.parameters.map((spec) => [spec.name, paramSchema(spec)]),
    ),
    required: tool.parameters
      .filter((spec) => spec.required)
      .map((spec) => spec.name),
    additionalProperties: false,
  };
}

function callSchema(name: string, args: JsonSchema): JsonSchema {
  return {
    type: "object",
    properties: { tool: { const: name }, args },
    required: ["tool", "args"],
    additionalProperties: false,
  };
}

const ANSWER_SCHEMA = callSchema(ANSWER_TOOL, {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
});

/**
 * The schema of one agent step, `{"tool": name, "args": {...}}`, as a string for web-llm's JSON mode: one
 * alternative per tool with its own arguments (ids as enums), plus `answer`. `answerOnly` leaves just the answer,
 * for the reply after the last allowed step.
 */
export function stepSchema(
  tools: readonly AgentTool[],
  options: { answerOnly?: boolean } = {},
): string {
  return JSON.stringify({
    anyOf: [
      ...(options.answerOnly
        ? []
        : tools.map((tool) => callSchema(tool.name, argsSchema(tool)))),
      ANSWER_SCHEMA,
    ],
  });
}

function markerParams(tool: AgentTool): ParamSpec[] {
  return tool.parameters.filter((spec) => !spec.fromBody);
}

/**
 * A marker's argument as the tool's arguments: `key=value` pairs separated by commas, or the values in
 * parameter order (the last parameter takes the rest, commas included); the code block fills the body parameter.
 */
export function parseMarkerArgs(
  tool: AgentTool,
  invocation: Pick<ToolInvocation, "arg" | "body">,
): Record<string, string> {
  const params = markerParams(tool);
  const names = new Set(params.map((spec) => spec.name));
  const raw: Record<string, string> = {};
  const arg = invocation.arg.trim();
  const pairs = arg.split(/[,;]/).map((part) => part.split("="));
  const named =
    arg !== "" &&
    pairs.every(
      ([key, ...rest]) => rest.length > 0 && names.has((key ?? "").trim()),
    );
  if (named) {
    for (const [key = "", ...rest] of pairs)
      raw[key.trim()] = rest.join("=").trim();
  } else if (arg !== "") {
    const values = arg.split(",");
    params.forEach((spec, index) => {
      const value =
        index === params.length - 1
          ? values.slice(index).join(",")
          : values[index];
      if (value !== undefined && value.trim() !== "")
        raw[spec.name] = value.trim();
    });
  }
  const body = tool.parameters.find((spec) => spec.fromBody);
  if (body && invocation.body !== undefined) raw[body.name] = invocation.body;
  return raw;
}

/** The typed tool as a `[name:argument]` marker tool, for the single-shot models and the rules. */
export function toMarkerTool(tool: AgentTool): AssistantTool {
  const read = (invocation: ToolInvocation) =>
    coerceArgs(tool, parseMarkerArgs(tool, invocation));
  const shape = markerParams(tool)
    .map((spec) => `<${spec.name}>`)
    .join(",");
  return {
    name: tool.name,
    describe: () => `[${tool.name}:${shape}] ${tool.description}`,
    sentence: (invocation) => {
      const coerced = read(invocation);
      return coerced.ok ? tool.sentence(coerced.args) : coerced.error;
    },
    run: async (invocation) => {
      const coerced = read(invocation);
      if (!coerced.ok) return { ok: false, sentence: coerced.error };
      const result = await tool.run(coerced.args);
      return { ok: result.ok, sentence: result.sentence };
    },
  };
}

/**
 * A marker tool a window registered (`useRegisterAssistantTool`) as a typed tool, so the agent loop can call it
 * too: `arg` is what follows the colon, `body` the content a code block would carry.
 */
export function fromMarkerTool(tool: AssistantTool): AgentTool {
  const invocation = (args: ToolArgs): ToolInvocation => {
    const body = stringArg(args, "body");
    const base = { name: tool.name, arg: stringArg(args, "arg") ?? "" };
    return body === undefined ? base : { ...base, body };
  };
  return {
    name: tool.name,
    description: tool.describe(),
    parameters: [
      { name: "arg", type: "string", description: "", required: true },
      { name: "body", type: "string", description: "" },
    ],
    sentence: (args) => tool.sentence(invocation(args)),
    run: (args) => tool.run(invocation(args)),
  };
}
