import type { AssistantTool, ToolCallEvent, ToolInvocation } from "./tools";
import {
  createToolRegistry,
  isToolName,
  parseToolMarkers,
  runToolCalls,
  toolInstructions,
  visibleReplyText,
} from "./tools";

function tool(
  name: string,
  run: AssistantTool["run"] = ({ arg }) => ({
    ok: true,
    sentence: `did ${arg}`,
  }),
): AssistantTool {
  return {
    name,
    describe: () => `[${name}:<x>] does ${name}`,
    sentence: ({ arg }) => `Doing ${arg}`,
    run,
  };
}

const OPEN = tool("open");
const EDIT = tool("edit");

describe(parseToolMarkers.name, () => {
  it("finds the registered markers in order, trimmed, and ignores unknown ones", () => {
    expect(
      parseToolMarkers(
        "Sure! [open: fuseball ] and then [music:play] but not [shout:now]",
        [OPEN, tool("music")],
      ),
    ).toEqual([
      { name: "open", arg: "fuseball" },
      { name: "music", arg: "play" },
    ]);
  });

  it("attaches the code block that follows a marker, up to the next marker", () => {
    const text = [
      "Here you go [edit:src/a.ts]",
      "```ts",
      "export const a = 1;",
      "```",
      "and [open:paint]",
      "```",
      "not for open? yes it is",
      "```",
    ].join("\n");
    expect(parseToolMarkers(text, [OPEN, EDIT])).toEqual([
      { name: "edit", arg: "src/a.ts", body: "export const a = 1;\n" },
      { name: "open", arg: "paint", body: "not for open? yes it is\n" },
    ]);
  });

  it("finds nothing in plain text, in brackets without a colon, or across lines", () => {
    expect(parseToolMarkers("no markers [here] [open:a\nb]", [OPEN])).toEqual(
      [],
    );
  });
});

describe(visibleReplyText.name, () => {
  it("removes the registered markers and tidies the whitespace they leave", () => {
    expect(
      visibleReplyText("Opening Fuseball! [open:fuseball]  \n\n\n\nEnjoy.", [
        OPEN,
      ]),
    ).toBe("Opening Fuseball!\n\nEnjoy.");
  });

  it("keeps markers of tools that are not registered", () => {
    expect(visibleReplyText("see [ref:1]", [OPEN])).toBe("see [ref:1]");
  });

  it("hides a marker that is still streaming in, but only while streaming", () => {
    expect(visibleReplyText("Opening Fuseball! [open:fuse", [OPEN], true)).toBe(
      "Opening Fuseball!",
    );
    expect(visibleReplyText("Opening Fuseball! [", [OPEN], true)).toBe(
      "Opening Fuseball!",
    );
    expect(visibleReplyText("Opening Fuseball! [open:fuse", [OPEN])).toBe(
      "Opening Fuseball! [open:fuse",
    );
  });
});

describe(toolInstructions.name, () => {
  it("is empty without tools and lists each tool's line otherwise", () => {
    expect(toolInstructions([])).toBe("");
    const text = toolInstructions([OPEN, EDIT]);
    expect(text).toContain("- [open:<x>] does open");
    expect(text).toContain("- [edit:<x>] does edit");
    expect(text).toContain("Never invent ids.");
  });
});

describe(runToolCalls.name, () => {
  it("runs each call in order, reporting start and outcome, and skips unknown tools", async () => {
    const events: ToolCallEvent[] = [];
    const ran: ToolInvocation[] = [];
    const failing = tool("music", () => ({
      ok: false,
      sentence: "Winamp is not open",
    }));
    const throwing = tool("boom", () => {
      throw new Error("kaboom");
    });
    const results = await runToolCalls(
      [
        { name: "open", arg: "paint" },
        { name: "music", arg: "play" },
        { name: "boom", arg: "" },
        { name: "nope", arg: "" },
      ],
      [
        tool("open", (invocation) => {
          ran.push(invocation);
          return { ok: true, sentence: "Opened Paint" };
        }),
        failing,
        throwing,
      ],
      (event) => events.push(event),
    );
    expect(ran).toEqual([{ name: "open", arg: "paint" }]);
    expect(results).toEqual([
      { ok: true, sentence: "Opened Paint" },
      { ok: false, sentence: "Winamp is not open" },
      { ok: false, sentence: "kaboom" },
    ]);
    expect(events).toEqual([
      { name: "open", sentence: "Doing paint", phase: "started" },
      { name: "open", sentence: "Opened Paint", phase: "finished" },
      { name: "music", sentence: "Doing play", phase: "started" },
      { name: "music", sentence: "Winamp is not open", phase: "failed" },
      { name: "boom", sentence: "Doing ", phase: "started" },
      { name: "boom", sentence: "kaboom", phase: "failed" },
    ]);
  });

  it("reports a thrown non-Error as its text", async () => {
    const events: ToolCallEvent[] = [];
    await runToolCalls(
      [{ name: "x", arg: "" }],
      [
        tool("x", () => {
          throw "plain string";
        }),
      ],
      (event) => events.push(event),
    );
    expect(events[1]).toEqual({
      name: "x",
      sentence: "plain string",
      phase: "failed",
    });
  });
});

describe(createToolRegistry.name, () => {
  it("registers tools, replaces one of the same name, and undoes a registration", () => {
    const registry = createToolRegistry();
    const seen: number[] = [];
    const unsubscribe = registry.subscribe(() =>
      seen.push(registry.tools.length),
    );
    const undoOpen = registry.register(OPEN);
    const replacement = tool("open");
    registry.register(replacement);
    registry.register(EDIT);
    expect(registry.tools).toEqual([replacement, EDIT]);
    // The first registration was already replaced: undoing it changes nothing.
    undoOpen();
    expect(registry.tools).toEqual([replacement, EDIT]);
    expect(seen).toEqual([1, 1, 2]);
    unsubscribe();
    registry.register(tool("music"))();
    expect(seen).toEqual([1, 1, 2]);
    expect(registry.tools.map((entry) => entry.name)).toEqual(["open", "edit"]);
  });

  it("refuses a name that could not be a marker", () => {
    expect(() => createToolRegistry().register(tool("open window"))).toThrow(
      /not valid/,
    );
    expect(isToolName("edit-file_2")).toBe(true);
    expect(isToolName("a:b")).toBe(false);
  });
});
