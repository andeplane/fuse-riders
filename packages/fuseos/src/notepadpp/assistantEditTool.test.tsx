import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createTestAssistantDeps } from "../__mocks__/assistantDeps";
import { FIXTURE_FILES } from "../__mocks__/disk";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import {
  DEFAULT_ASSISTANT_OPTIONS,
  MemoryAssistantOptionsStore,
} from "../assistant/assistantOptionsStore";
import { useClippyChat } from "../assistant/clippyChat";
import { Desktop } from "../desktop/Desktop";
import { DEFAULT_STATE } from "../state/appState";

import type { EditToolDeps, EditUndo } from "./assistantEditTool";
import {
  createEditTool,
  editSavedSentence,
  MAX_PROMPT_FILE_CHARS,
  truncateForPrompt,
  UNDO_ARG,
} from "./assistantEditTool";

/** An editor over a map of saved copies and a map of committed texts, recording every write. */
function fakeEditor(
  committed: Readonly<Record<string, string>>,
  saved: Map<string, string> = new Map(),
) {
  const writes: { path: string; content: string }[] = [];
  const reverts: string[] = [];
  const editor: EditToolDeps["editor"] = {
    readFile: async (path) => {
      const text = saved.get(path) ?? committed[path];
      if (text === undefined) throw new Error(`no ${path}`);
      return text;
    },
    writeFile: async (path, content) => {
      saved.set(path, content);
      writes.push({ path, content });
    },
    revert: async (path) => {
      saved.delete(path);
      reverts.push(path);
    },
    listModified: async () => [...saved.keys()],
  };
  return { editor, saved, writes, reverts };
}

const README = "README.md";

describe(createEditTool.name, () => {
  function toolOver(
    editor: EditToolDeps["editor"],
    view: EditToolDeps["view"],
    undo: { current: EditUndo | undefined } = { current: undefined },
  ) {
    return { tool: createEditTool({ editor, view, undo }), undo };
  }

  it("describes itself with the open files and the active one's text, truncated", () => {
    const { editor } = fakeEditor({});
    const long = "x".repeat(MAX_PROMPT_FILE_CHARS + 10);
    const { tool } = toolOver(editor, () => ({
      paths: [README, "a.ts"],
      active: { path: "a.ts", text: long },
    }));
    const line = tool.describe();
    expect(line).toContain("[edit:<path>] followed by a fenced code block");
    expect(line).toContain(`[edit:${UNDO_ARG}]`);
    expect(line).toContain("Open in Notepad++: README.md, a.ts.");
    expect(line).toContain("The active file is a.ts");
    expect(line).toContain("10 more characters not shown");
    expect(line).not.toContain(long);

    const { tool: idle } = toolOver(editor, () => ({ paths: [] }));
    expect(idle.describe()).toContain("Nothing is open in Notepad++.");
    expect(idle.describe()).not.toContain("active file");
    expect(truncateForPrompt("short", 10)).toBe("short");
  });

  it("writes the code block to the file through the editor and remembers what it replaced", async () => {
    const { editor, saved, writes } = fakeEditor({ [README]: "# Original" });
    const { tool, undo } = toolOver(editor, () => ({ paths: [README] }));
    expect(tool.sentence({ name: "edit", arg: README })).toBe(
      "Editing README.md",
    );
    await expect(
      tool.run({ name: "edit", arg: ` ${README} `, body: "# New\n" }),
    ).resolves.toEqual({ ok: true, sentence: editSavedSentence(README) });
    expect(writes).toEqual([{ path: README, content: "# New\n" }]);
    expect(saved.get(README)).toBe("# New\n");
    // Nothing had been saved before: undo means revert to the committed text.
    expect(undo.current).toEqual({ path: README, previous: undefined });

    await tool.run({ name: "edit", arg: README, body: "# Newer\n" });
    // A saved copy existed this time: undo puts that copy back.
    expect(undo.current).toEqual({ path: README, previous: "# New\n" });
  });

  it("undoes the last edit: a revert when nothing was saved before, the old copy otherwise", async () => {
    const { editor, saved, writes, reverts } = fakeEditor({
      [README]: "# Original",
    });
    const { tool } = toolOver(editor, () => ({ paths: [README] }));
    expect(tool.sentence({ name: "edit", arg: UNDO_ARG })).toBe(
      "Undoing the last edit",
    );
    await expect(tool.run({ name: "edit", arg: UNDO_ARG })).resolves.toEqual({
      ok: false,
      sentence: "There is no edit to undo",
    });

    await tool.run({ name: "edit", arg: README, body: "# New\n" });
    await expect(tool.run({ name: "edit", arg: UNDO_ARG })).resolves.toEqual({
      ok: true,
      sentence: "Put README.md back the way it was on your C: drive",
    });
    expect(reverts).toEqual([README]);
    expect(saved.has(README)).toBe(false);
    // Undone once; a second undo has nothing left.
    await expect(
      tool.run({ name: "edit", arg: UNDO_ARG }),
    ).resolves.toMatchObject({
      ok: false,
    });

    saved.set(README, "# Saved by hand");
    await tool.run({ name: "edit", arg: README, body: "# Clippy\n" });
    await tool.run({ name: "edit", arg: UNDO_ARG });
    expect(saved.get(README)).toBe("# Saved by hand");
    expect(writes.map((write) => write.content)).toEqual([
      "# New\n",
      "# Clippy\n",
      "# Saved by hand",
    ]);
  });

  it("refuses a file that is not open and a marker without a code block, leaving the file alone", async () => {
    const { editor, writes } = fakeEditor({ [README]: "# Original" });
    const { tool } = toolOver(editor, () => ({ paths: [README] }));
    await expect(
      tool.run({ name: "edit", arg: "secret.txt", body: "x" }),
    ).resolves.toEqual({
      ok: false,
      sentence: "secret.txt is not open in Notepad++; open it first",
    });
    await expect(
      tool.run({ name: "edit", arg: "", body: "x" }),
    ).resolves.toEqual({
      ok: false,
      sentence: "That file is not open in Notepad++; open it first",
    });
    await expect(tool.run({ name: "edit", arg: README })).resolves.toEqual({
      ok: false,
      sentence: "No code block followed the marker, so README.md is unchanged",
    });
    expect(writes).toEqual([]);
  });
});

describe("Clippy editing the open file", () => {
  const notepadOnReadme = {
    ...DEFAULT_STATE,
    windows: [
      {
        id: "w1",
        kind: "notepadpp" as const,
        paths: [README],
        activePath: README,
        minimized: false,
        maximized: false,
      },
    ],
  };

  it("rewrites the file from the reply's code block, Notepad++ follows, and undo puts it back", async () => {
    const user = userEvent.setup();
    const { llmFactory, diskDeps, editors } = renderWithProviders(<Desktop />, {
      initialState: notepadOnReadme,
      assistantDeps: createTestAssistantDeps({ useChat: useClippyChat }),
      assistantOptions: new MemoryAssistantOptionsStore({
        ...DEFAULT_ASSISTANT_OPTIONS,
        greeted: true,
      }),
    });
    await waitFor(() =>
      expect(editors[0]?.getText()).toBe(FIXTURE_FILES[README]),
    );
    llmFactory.reply = () => [
      "Here you go. [edit:README.md]\n```md\n# Fuse Riders\n\nNow with Clippy.\n```\n",
    ];
    await user.click(screen.getByRole("button", { name: "Clippy" }));
    const balloon = screen.getByRole("region", { name: "Clippy balloon" });
    await user.type(
      within(balloon).getByRole("textbox", { name: "Ask Clippy" }),
      "add a line about yourself to the readme{Enter}",
    );
    await waitFor(async () =>
      expect(await diskDeps.overlay.read(README)).toBe(
        "# Fuse Riders\n\nNow with Clippy.\n",
      ),
    );
    // The system prompt carried the file so the model could edit it.
    const system = llmFactory.engines[0]?.requests[0]?.[0]?.content ?? "";
    expect(system).toContain("The active file is README.md");
    expect(system).toContain("Light cycles for five.");
    // The open tab shows the new text, marked as saved on this computer.
    await waitFor(() =>
      expect(editors[0]?.getText()).toBe("# Fuse Riders\n\nNow with Clippy.\n"),
    );
    expect(screen.getByRole("tab", { name: /README\.md/ })).toHaveTextContent(
      "●",
    );
    const log = within(balloon).getByRole("log", { name: "Conversation" });
    await waitFor(() =>
      expect(log).toHaveTextContent("Saved README.md to your C: drive"),
    );
    expect(log).not.toHaveTextContent("[edit:");

    llmFactory.reply = () => ["Undone. [edit:undo]"];
    await user.type(
      within(balloon).getByRole("textbox", { name: "Ask Clippy" }),
      "undo that{Enter}",
    );
    await waitFor(async () =>
      expect(await diskDeps.overlay.read(README)).toBeUndefined(),
    );
    await waitFor(() =>
      expect(editors[0]?.getText()).toBe(FIXTURE_FILES[README]),
    );
    await waitFor(() =>
      expect(log).toHaveTextContent("Put README.md back the way it was"),
    );
  });
});
