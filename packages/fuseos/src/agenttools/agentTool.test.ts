import type { AssistantTool, ToolInvocation } from "../llm/tools";

import type { AgentTool, ToolArgs } from "./agentTool";
import {
  argsSchema,
  booleanArg,
  coerceArgs,
  describeTool,
  fromMarkerTool,
  numberArg,
  parseMarkerArgs,
  stepSchema,
  stringArg,
  toMarkerTool,
  toolSignature,
} from "./agentTool";

function tool(
  overrides: Partial<AgentTool> = {},
): AgentTool & { ran: ToolArgs[] } {
  const ran: ToolArgs[] = [];
  return {
    ran,
    name: "paint_wall",
    description: "Paints a wall.",
    parameters: [
      {
        name: "color",
        type: "string",
        description: "",
        required: true,
        options: ["red", "blue"],
        aliases: { crimson: "red" },
      },
      { name: "coats", type: "number", description: "how many coats" },
      { name: "glossy", type: "boolean", description: "" },
      { name: "note", type: "string", description: "a note for the painter" },
    ],
    sentence: (args) => `Painting it ${stringArg(args, "color") ?? "?"}`,
    run: (args) => {
      ran.push(args);
      return { ok: true, sentence: "Painted", observation: "It is drying." };
    },
    ...overrides,
  };
}

describe(coerceArgs.name, () => {
  it("keeps what fits the parameters, in their types, and drops the rest", () => {
    expect(
      coerceArgs(tool(), {
        color: " RED ",
        coats: "2",
        glossy: "yes",
        note: 7,
        extra: true,
      }),
    ).toEqual({
      ok: true,
      args: { color: "red", coats: 2, glossy: true, note: "7" },
    });
    expect(coerceArgs(tool(), { color: "crimson", glossy: false })).toEqual({
      ok: true,
      args: { color: "red", glossy: false },
    });
    expect(
      coerceArgs(tool(), { color: "blue", glossy: "OFF", coats: 3 }),
    ).toEqual({ ok: true, args: { color: "blue", glossy: false, coats: 3 } });
    // Null and empty count as not given.
    expect(
      coerceArgs(tool(), { color: "blue", coats: null, note: "" }),
    ).toEqual({
      ok: true,
      args: { color: "blue" },
    });
  });

  it("says what is missing or wrong, in words a model can act on", () => {
    expect(coerceArgs(tool(), {})).toEqual({
      ok: false,
      error: 'paint_wall needs "color"',
    });
    for (const nothing of [undefined, null, "red", ["red"]])
      expect(coerceArgs(tool(), nothing).ok).toBe(false);
    expect(coerceArgs(tool(), { color: "green" })).toEqual({
      ok: false,
      error: 'paint_wall has no color "green"; use one of: red, blue',
    });
    expect(coerceArgs(tool(), { color: true })).toMatchObject({ ok: false });
    for (const coats of ["many", Number.NaN, true, " "])
      expect(coerceArgs(tool(), { color: "red", coats })).toEqual({
        ok: false,
        error: 'paint_wall\'s "coats" must be a number',
      });
    for (const glossy of ["maybe", 1])
      expect(coerceArgs(tool(), { color: "red", glossy })).toEqual({
        ok: false,
        error: 'paint_wall\'s "glossy" must be a boolean',
      });
    expect(coerceArgs(tool(), { color: "red", note: {} })).toEqual({
      ok: false,
      error: 'paint_wall\'s "note" must be a string',
    });
  });

  it("reads an argument back in its type", () => {
    const args: ToolArgs = { color: "red", coats: 2, glossy: true };
    expect(stringArg(args, "coats")).toBe("2");
    expect(stringArg(args, "note")).toBeUndefined();
    expect(numberArg(args, "coats")).toBe(2);
    expect(numberArg(args, "color")).toBeUndefined();
    expect(booleanArg(args, "glossy")).toBe(true);
    expect(booleanArg(args, "coats")).toBeUndefined();
  });
});

describe("the prompt line and the schema", () => {
  it("shows the call shape, what the tool does and what each parameter takes", () => {
    expect(toolSignature(tool())).toBe(
      "paint_wall(color, coats?, glossy?, note?)",
    );
    expect(describeTool(tool())).toBe(
      "- paint_wall(color, coats?, glossy?, note?) Paints a wall. color: red|blue; coats: how many coats; note: a note for the painter.",
    );
    expect(
      describeTool(
        tool({
          parameters: [
            {
              name: "crt",
              type: "string",
              description: "full is the lot",
              options: ["off", "full"],
            },
          ],
        }),
      ),
    ).toBe(
      "- paint_wall(crt?) Paints a wall. crt: off|full (full is the lot).",
    );
    expect(describeTool(tool({ parameters: [] }))).toBe(
      "- paint_wall() Paints a wall.",
    );
  });

  it("holds a step to one tool with its own arguments, ids as enums, or to the answer", () => {
    expect(argsSchema(tool())).toEqual({
      type: "object",
      properties: {
        color: { enum: ["red", "blue"] },
        coats: { type: "number" },
        glossy: { type: "boolean" },
        note: { type: "string" },
      },
      required: ["color"],
      additionalProperties: false,
    });
    const answer = {
      type: "object",
      properties: {
        tool: { const: "answer" },
        args: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
      },
      required: ["tool", "args"],
      additionalProperties: false,
    };
    expect(JSON.parse(stepSchema([tool()]))).toEqual({
      anyOf: [
        {
          type: "object",
          properties: {
            tool: { const: "paint_wall" },
            args: argsSchema(tool()),
          },
          required: ["tool", "args"],
          additionalProperties: false,
        },
        answer,
      ],
    });
    expect(JSON.parse(stepSchema([tool()], { answerOnly: true }))).toEqual({
      anyOf: [answer],
    });
  });
});

describe(toMarkerTool.name, () => {
  const editor = (): AgentTool & { ran: ToolArgs[] } =>
    tool({
      name: "write",
      description: "Writes a file.",
      parameters: [
        { name: "path", type: "string", description: "", required: true },
        { name: "mode", type: "string", description: "" },
        {
          name: "content",
          type: "string",
          description: "",
          required: true,
          fromBody: true,
        },
      ],
      sentence: (args) => `Writing ${stringArg(args, "path") ?? ""}`,
    });

  it("reads a marker's argument by position, by name, and the code block as the body", () => {
    expect(parseMarkerArgs(tool(), { arg: "red" })).toEqual({ color: "red" });
    expect(parseMarkerArgs(tool(), { arg: " red , 2 " })).toEqual({
      color: "red",
      coats: "2",
    });
    // The last parameter takes the rest, commas included.
    expect(
      parseMarkerArgs(tool(), { arg: "red,2,true,thin, even coats" }),
    ).toEqual({
      color: "red",
      coats: "2",
      glossy: "true",
      note: "thin, even coats",
    });
    expect(parseMarkerArgs(tool(), { arg: "coats=3; color = blue" })).toEqual({
      coats: "3",
      color: "blue",
    });
    // A value with "=" that names no parameter is positional.
    expect(parseMarkerArgs(tool(), { arg: "a=b" })).toEqual({ color: "a=b" });
    expect(parseMarkerArgs(tool(), { arg: "red,,true" })).toEqual({
      color: "red",
      glossy: "true",
    });
    expect(parseMarkerArgs(tool(), { arg: "" })).toEqual({});
    expect(
      parseMarkerArgs(editor(), { arg: "a.txt", body: "hello\n" }),
    ).toEqual({ path: "a.txt", content: "hello\n" });
    expect(parseMarkerArgs(editor(), { arg: "a.txt,append" })).toEqual({
      path: "a.txt",
      mode: "append",
    });
  });

  it("runs the typed tool from a marker and reports its sentence", async () => {
    const typed = editor();
    const marker = toMarkerTool(typed);
    expect(marker.name).toBe("write");
    expect(marker.describe()).toBe("[write:<path>,<mode>] Writes a file.");
    const invocation: ToolInvocation = {
      name: "write",
      arg: "a.txt",
      body: "hello",
    };
    expect(marker.sentence(invocation)).toBe("Writing a.txt");
    expect(await marker.run(invocation)).toEqual({
      ok: true,
      sentence: "Painted",
    });
    expect(typed.ran).toEqual([{ path: "a.txt", content: "hello" }]);
    // No code block: the body parameter is missing, and the tool does not run.
    const bare: ToolInvocation = { name: "write", arg: "a.txt" };
    expect(marker.sentence(bare)).toBe('write needs "content"');
    expect(await marker.run(bare)).toEqual({
      ok: false,
      sentence: 'write needs "content"',
    });
    expect(typed.ran).toHaveLength(1);
  });
});

describe(fromMarkerTool.name, () => {
  it("lets the agent loop call a window's marker tool with its argument and body", async () => {
    const seen: ToolInvocation[] = [];
    const marker: AssistantTool = {
      name: "edit",
      describe: () => "[edit:<path>] replaces a file with the code block.",
      sentence: ({ arg }) => `Editing ${arg}`,
      run: (invocation) => {
        seen.push(invocation);
        return { ok: true, sentence: `Saved ${invocation.arg}` };
      },
    };
    const typed = fromMarkerTool(marker);
    expect(describeTool(typed)).toBe(
      "- edit(arg, body?) [edit:<path>] replaces a file with the code block.",
    );
    expect(typed.sentence({ arg: "a.txt" })).toBe("Editing a.txt");
    expect(typed.sentence({})).toBe("Editing ");
    expect(await typed.run({ arg: "a.txt", body: "hi" })).toEqual({
      ok: true,
      sentence: "Saved a.txt",
    });
    await typed.run({ arg: "undo" });
    expect(seen).toEqual([
      { name: "edit", arg: "a.txt", body: "hi" },
      { name: "edit", arg: "undo" },
    ]);
  });
});
