/**
 * The assistant's tools: what a reply can make the desktop do. A reply carries a marker such as `[open:fuseball]`;
 * once the reply has streamed, the markers are stripped from the text and each named tool runs with its argument.
 *
 * Tools are registered, not hard coded: the desktop registers `open` and `music` (`assistant/desktopTools.ts`), and
 * any window can add its own while it is mounted (`useRegisterAssistantTool` in `assistant/assistantToolsContext.ts`),
 * for example an editor registering `[edit:<path>]`. Every tool also contributes its line to the system prompt.
 */

export type ToolInvocation = {
  /** The marker's name, e.g. "open". */
  name: string;
  /** What followed the colon, trimmed, e.g. "fuseball". */
  arg: string;
  /** The first fenced code block after the marker and before the next one, without the fences; for tools that take a body. */
  body?: string;
};

export type ToolResult = {
  ok: boolean;
  /** Plain words for the user, e.g. "Opening Fuseball" or "There is no app called foo". */
  sentence: string;
};

export interface AssistantTool {
  /** The marker name: letters, digits, `-` and `_`. */
  name: string;
  /** One line for the system prompt, e.g. "[open:<id>] opens a game or app. Ids: fuseball, paint, ...". */
  describe: () => string;
  /** Plain words for the balloon while the tool runs, e.g. "Opening Fuseball". */
  sentence: (invocation: ToolInvocation) => string;
  run: (invocation: ToolInvocation) => ToolResult | Promise<ToolResult>;
}

export type ToolCallEvent = {
  name: string;
  sentence: string;
  phase: "started" | "finished" | "failed";
};

const NAME = /^[A-Za-z0-9_-]+$/;

export function isToolName(value: string): boolean {
  return NAME.test(value);
}

/** A complete marker: `[name:argument]` where the argument has no newline or `]`. */
const MARKER = /\[([A-Za-z0-9_-]+):([^\]\n]*)\]/g;
/** A marker still streaming in at the end of the text: `[name` or `[name:part of the argument`. */
const PARTIAL_MARKER = /\[[A-Za-z0-9_-]*(?::[^\]\n]*)?$/;
const FENCE = /```[^\n]*\n([\s\S]*?)```/;

/** The markers of registered tools in a finished reply, in order, each with the code block that follows it when there is one. */
export function parseToolMarkers(
  text: string,
  tools: readonly Pick<AssistantTool, "name">[],
): ToolInvocation[] {
  const names = new Set(tools.map((tool) => tool.name));
  const found: { name: string; arg: string; end: number }[] = [];
  for (const match of text.matchAll(MARKER)) {
    const [whole, name = "", arg = ""] = match;
    if (!names.has(name)) continue;
    found.push({ name, arg: arg.trim(), end: match.index + whole.length });
  }
  return found.map((marker, index) => {
    const until = found[index + 1]?.end ?? text.length;
    const body = FENCE.exec(text.slice(marker.end, until))?.[1];
    return body === undefined
      ? { name: marker.name, arg: marker.arg }
      : { name: marker.name, arg: marker.arg, body };
  });
}

/**
 * The reply as the user reads it: the registered tools' markers removed (a code block that fed a tool stays, it is
 * what the user asked for), and while the reply still streams, a marker that has only partly arrived hidden too.
 */
export function visibleReplyText(
  text: string,
  tools: readonly Pick<AssistantTool, "name">[],
  streaming = false,
): string {
  const names = new Set(tools.map((tool) => tool.name));
  let visible = text.replace(MARKER, (whole, name: string) =>
    names.has(name) ? "" : whole,
  );
  if (streaming) visible = visible.replace(PARTIAL_MARKER, "");
  return visible
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The tool section of the system prompt; empty when there are no tools. */
export function toolInstructions(tools: readonly AssistantTool[]): string {
  if (tools.length === 0) return "";
  return [
    "To do something on the desktop, end your reply with exactly one marker in square brackets:",
    ...tools.map((tool) => `- ${tool.describe()}`),
    "Use a marker only when the user asks for that action. Never invent ids.",
  ].join("\n");
}

/** Runs a reply's tool calls in order, reporting each; a tool that throws counts as failed. */
export async function runToolCalls(
  invocations: readonly ToolInvocation[],
  tools: readonly AssistantTool[],
  report: (event: ToolCallEvent) => void,
  /** Awaited between two calls, so the second sees what the first did to the desktop. */
  settle: () => Promise<void> = () => Promise.resolve(),
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const invocation of invocations) {
    const tool = tools.find((candidate) => candidate.name === invocation.name);
    if (!tool) continue;
    if (results.length > 0) await settle();
    const sentence = tool.sentence(invocation);
    report({ name: tool.name, sentence, phase: "started" });
    let result: ToolResult;
    try {
      result = await tool.run(invocation);
    } catch (error) {
      result = {
        ok: false,
        sentence: error instanceof Error ? error.message : String(error),
      };
    }
    report({
      name: tool.name,
      sentence: result.sentence,
      phase: result.ok ? "finished" : "failed",
    });
    results.push(result);
  }
  return results;
}

/** Tools by name; a registration replaces an earlier tool of the same name and returns how to undo it. */
export interface ToolRegistry {
  readonly tools: readonly AssistantTool[];
  register(tool: AssistantTool): () => void;
  /** Re-renders subscribers when the list changes. */
  subscribe(listener: () => void): () => void;
}

export function createToolRegistry(): ToolRegistry {
  let tools: AssistantTool[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    get tools() {
      return tools;
    },
    register(tool) {
      if (!isToolName(tool.name))
        throw new Error(`Assistant tool name "${tool.name}" is not valid`);
      tools = [...tools.filter((other) => other.name !== tool.name), tool];
      notify();
      return () => {
        if (!tools.includes(tool)) return;
        tools = tools.filter((other) => other !== tool);
        notify();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
