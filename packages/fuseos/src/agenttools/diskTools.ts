import { editorPathOf } from "../disk/diskEntries";
import { formatAddress, MY_COMPUTER, parseAddress } from "../disk/diskPath";
import { formatSize, MAX_TEXT_FILE_BYTES } from "../disk/fileTypes";

import type { AgentOs, DiskNode } from "./agentOs";
import type { AgentTool, AgentToolResult, ToolArgs } from "./agentTool";
import { stringArg } from "./agentTool";

/** How many entries of a folder the model is told about; the rest are counted. */
export const MAX_LISTED_ENTRIES = 40;
/** How much of a file the model reads; the local models have a small context. */
export const MAX_READ_CHARS = 1200;

const PATH_PARAM = {
  name: "path",
  type: "string",
  description: 'e.g. "C:/docs", "C:/README.md", "A:" or "My Computer"',
  required: true,
} as const;

/**
 * Where a path a model wrote points: "C:\docs", "C:/docs" and "A:" as typed in the address bar, and a bare
 * repository path ("docs/notes.txt", "/README.md") on C:, where the repository lives.
 */
export function resolveLocation(path: string): string | undefined {
  const trimmed = path.trim().replace(/^["'`]+|["'`]+$/g, "");
  const typed = parseAddress(trimmed);
  if (typed !== undefined) return typed;
  if (/^[A-Za-z]:/.test(trimmed)) return undefined;
  return parseAddress(`C:/${trimmed.replace(/^[\\/]+/, "")}`);
}

function pathOf(args: ToolArgs): string {
  return stringArg(args, "path") ?? "";
}

function notFound(path: string): AgentToolResult {
  return {
    ok: false,
    sentence: `There is no "${path}" on this computer`,
    observation: `Nothing is at "${path}". Use list_dir on its folder to see what exists.`,
  };
}

async function locate(
  os: Pick<AgentOs, "disk">,
  args: ToolArgs,
): Promise<
  { location: string; node: NonNullable<DiskNode> } | AgentToolResult
> {
  const location = resolveLocation(pathOf(args));
  if (location === undefined) return notFound(pathOf(args));
  const node = await os.disk.stat(location);
  return node ? { location, node } : notFound(pathOf(args));
}

/** Opens an Explorer window on a folder; a file opens the way a double click would (text in Notepad++). */
export function createExplorerOpenTool(
  os: Pick<AgentOs, "disk" | "windows" | "editor">,
): AgentTool {
  return {
    name: "explorer_open",
    description:
      "Opens Windows Explorer on a folder or drive; a text file opens in Notepad++.",
    parameters: [PATH_PARAM],
    sentence: (args) => `Opening ${pathOf(args)}`,
    run: async (args) => {
      const found = await locate(os, args);
      if ("ok" in found) return found;
      if (found.node.kind === "folder") {
        os.windows.open({ kind: "explorer", location: found.location });
        return {
          ok: true,
          sentence: `Opened ${formatAddress(found.location)} in Explorer`,
        };
      }
      const { entry } = found.node;
      if (entry.fileKind !== "text")
        return {
          ok: false,
          sentence: `${entry.name} is not something Notepad++ can open`,
        };
      os.editor.open(editorPathOf(entry.location));
      return { ok: true, sentence: `Opened ${entry.name} in Notepad++` };
    },
  };
}

/** A folder's contents, as Explorer's Details view would list them. */
export function createListDirTool(os: Pick<AgentOs, "disk">): AgentTool {
  return {
    name: "list_dir",
    description: "Lists the files and folders in a folder or drive (C: or A:).",
    parameters: [PATH_PARAM],
    sentence: (args) => `Looking in ${pathOf(args)}`,
    run: async (args) => {
      const found = await locate(os, args);
      if ("ok" in found) return found;
      if (found.node.kind !== "folder")
        return {
          ok: false,
          sentence: `${found.node.entry.name} is a file, not a folder`,
          observation: `${pathOf(args)} is a file; use read_file to read it.`,
        };
      const { entries } = found.node;
      const shown = entries
        .slice(0, MAX_LISTED_ENTRIES)
        .map((entry) =>
          entry.kind === "file"
            ? `${entry.name}${entry.size === undefined ? "" : ` (${formatSize(entry.size)})`}`
            : `${entry.name}/`,
        );
      const more = entries.length - shown.length;
      const where =
        found.location === MY_COMPUTER
          ? "My Computer"
          : formatAddress(found.location);
      return {
        ok: true,
        sentence: `${where} has ${entries.length} item${entries.length === 1 ? "" : "s"}`,
        observation:
          entries.length === 0
            ? `${where} is empty.`
            : `${where}: ${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`,
      };
    },
  };
}

async function readText(
  os: Pick<AgentOs, "disk" | "editor">,
  args: ToolArgs,
): Promise<{ path: string; name: string; text: string } | AgentToolResult> {
  const found = await locate(os, args);
  if ("ok" in found) return found;
  if (found.node.kind !== "file")
    return {
      ok: false,
      sentence: `${pathOf(args)} is a folder, not a file`,
      observation: `${pathOf(args)} is a folder; use list_dir to see inside.`,
    };
  const { entry } = found.node;
  if (entry.fileKind !== "text")
    return { ok: false, sentence: `${entry.name} is not a text file` };
  if ((entry.size ?? 0) > MAX_TEXT_FILE_BYTES)
    return {
      ok: false,
      sentence: `${entry.name} is too large to read (${formatSize(entry.size ?? 0)})`,
    };
  // The entry's own location: the name as it is on disk, whatever case the model typed.
  const path = editorPathOf(entry.location);
  return { path, name: entry.name, text: await os.editor.readFile(path) };
}

/** Reads a text file as Notepad++ would show it (the saved copy when there is one), truncated. */
export function createReadFileTool(
  os: Pick<AgentOs, "disk" | "editor">,
): AgentTool {
  return {
    name: "read_file",
    description: `Reads a text file (the first ${MAX_READ_CHARS} characters).`,
    parameters: [PATH_PARAM],
    sentence: (args) => `Reading ${pathOf(args)}`,
    run: async (args) => {
      const file = await readText(os, args);
      if ("ok" in file) return file;
      const { text } = file;
      const shown =
        text.length <= MAX_READ_CHARS
          ? text
          : `${text.slice(0, MAX_READ_CHARS)}\n... (${text.length - MAX_READ_CHARS} more characters not shown)`;
      return {
        ok: true,
        sentence: `Read ${file.name} (${text.length} characters)`,
        observation: `${file.name} reads:\n${shown}`,
      };
    },
  };
}

/** What an edit replaced, so it can be undone: the saved copy before it, or nothing (the committed text showed). */
export type AgentEditUndo = { path: string; previous: string | undefined };

const EDIT_MODES = ["replace", "append", "prepend"] as const;
type EditMode = (typeof EDIT_MODES)[number];

function editMode(args: ToolArgs): EditMode {
  const wanted = stringArg(args, "mode");
  return EDIT_MODES.find((mode) => mode === wanted) ?? "replace";
}

function applyEdit(current: string, content: string, mode: EditMode): string {
  if (mode === "replace") return content;
  const gap = current === "" || current.endsWith("\n") ? "" : "\n";
  return mode === "append"
    ? `${current}${gap}${content}`
    : `${content}${content.endsWith("\n") ? "" : "\n"}${current}`;
}

/**
 * Writes a text file through `EditorCommands` (the browser's own C: drive, never GitHub) and shows it in
 * Notepad++; `undo_edit` puts back what the last edit replaced. `undo` is kept by the caller across turns.
 */
export function createEditFileTools(
  os: Pick<AgentOs, "disk" | "editor">,
  undo: { current: AgentEditUndo | undefined },
): AgentTool[] {
  return [
    {
      name: "edit_file",
      description:
        "Changes a text file on the user's own C: drive (this browser only) and shows it in Notepad++.",
      parameters: [
        PATH_PARAM,
        {
          name: "content",
          type: "string",
          description: "the new text",
          required: true,
          fromBody: true,
        },
        {
          name: "mode",
          type: "string",
          description: "",
          options: EDIT_MODES,
        },
      ],
      sentence: (args) => `Editing ${pathOf(args)}`,
      run: async (args) => {
        const file = await readText(os, args);
        if ("ok" in file) return file;
        const hadSavedCopy = (await os.editor.listModified()).includes(
          file.path,
        );
        await os.editor.writeFile(
          file.path,
          applyEdit(
            file.text,
            stringArg(args, "content") ?? "",
            editMode(args),
          ),
        );
        undo.current = {
          path: file.path,
          previous: hadSavedCopy ? file.text : undefined,
        };
        os.editor.open(file.path);
        return {
          ok: true,
          sentence: `Saved ${file.name} to your C: drive (this browser only)`,
          observation: `Saved ${file.path}. It is open in Notepad++. undo_edit puts it back.`,
        };
      },
    },
    {
      name: "undo_edit",
      description: "Puts back what the last edit_file replaced.",
      parameters: [],
      sentence: () => "Undoing the last edit",
      run: async () => {
        const last = undo.current;
        if (!last) return { ok: false, sentence: "There is no edit to undo" };
        if (last.previous === undefined) await os.editor.revert(last.path);
        else await os.editor.writeFile(last.path, last.previous);
        undo.current = undefined;
        return { ok: true, sentence: `Put ${last.path} back the way it was` };
      },
    },
  ];
}
