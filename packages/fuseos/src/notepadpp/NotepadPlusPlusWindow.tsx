import { NOT_ON_GITHUB_NOTICE } from "../disk/diskSource";
import { editorLanguage } from "../disk/fileTypes";
import { keysFor } from "../lib/shortcuts";
import { Win98Icon } from "../ui/icons";
import type { MenuDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";
import { useWindowCommands } from "../windows/useWindowCommands";

import { CodeEditor } from "./CodeEditor";
import type { NotepadViewModel } from "./useNotepadViewModel";
import { useNotepadViewModel } from "./useNotepadViewModel";

export type NotepadPlusPlusWindowProps = {
  windowId: string;
  paths: string[];
  activePath?: string;
};

export const LOCAL_SAVE_NOTICE = "Saves stay in this browser, not on GitHub";

const LANGUAGE_NAMES: Record<ReturnType<typeof editorLanguage>, string> = {
  typescript: "TypeScript",
  tsx: "TypeScript React",
  javascript: "JavaScript",
  jsx: "JavaScript React",
  json: "JSON",
  markdown: "Markdown",
  css: "CSS",
  html: "HTML",
  yaml: "YAML",
  plain: "Normal text file",
};

function TabBar({ vm }: { vm: NotepadViewModel }) {
  return (
    <div
      className="flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-[grey] bg-[silver] px-1 pt-1"
      role="tablist"
      aria-label="Open files"
    >
      {vm.tabs.map((tab) => (
        <div
          key={tab.path}
          role="tab"
          aria-selected={tab.active}
          title={tab.path}
          className={`flex cursor-default items-center gap-1 border border-b-0 border-[grey] px-2 py-0.5 ${tab.active ? "bg-white" : "bg-[#dfdfdf] text-[#444]"}`}
          onClick={() => vm.activate(tab.path)}
        >
          <Win98Icon name={tab.dirty ? "textFile" : "codeFile"} />
          <span>
            {tab.name}
            {tab.dirty ? " *" : tab.modified ? " ●" : ""}
          </span>
          <button
            type="button"
            className="flat px-1 text-[10px] leading-none"
            aria-label={`Close ${tab.name}`}
            onClick={(event) => {
              event.stopPropagation();
              vm.closeTab(tab.path);
            }}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}

function SaveFileDialog({ vm }: { vm: NotepadViewModel }) {
  if (!vm.pendingClose) return null;
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/10"
      role="dialog"
      aria-modal="true"
      aria-label="Save file?"
    >
      <div className="window w-72">
        <div className="title-bar">
          <div className="title-bar-text">Save</div>
        </div>
        <div className="window-body flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Win98Icon name="warning" size={32} />
            <p>Save file &quot;{vm.pendingClose.name}&quot;?</p>
          </div>
          <div className="flex justify-end gap-1">
            <button
              type="button"
              className="default"
              autoFocus
              onClick={() => vm.resolveClose("save")}
            >
              Yes
            </button>
            <button type="button" onClick={() => vm.resolveClose("discard")}>
              No
            </button>
            <button type="button" onClick={() => vm.resolveClose("cancel")}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NotepadPlusPlusWindow({
  windowId,
  paths,
  activePath,
}: NotepadPlusPlusWindowProps) {
  const vm = useNotepadViewModel(windowId, paths, activePath);
  const commands = useWindowCommands();
  const active = vm.activeFile;
  const activeTab = vm.tabs.find((tab) => tab.active);

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        {
          label: "Save",
          shortcut: keysFor("notepad.save"),
          disabled: !activeTab?.dirty,
          onSelect: vm.save,
        },
        {
          label: "Save All",
          disabled: !vm.tabs.some((tab) => tab.dirty),
          onSelect: vm.saveAll,
        },
        {
          label: "Revert to original",
          disabled: !vm.canRevert,
          onSelect: vm.revert,
        },
        { separator: true },
        {
          label: "Close",
          disabled: !activeTab,
          onSelect: () => {
            if (activeTab) vm.closeTab(activeTab.path);
          },
        },
        { label: "Exit", onSelect: vm.close },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", onSelect: vm.undo },
        { label: "Redo", onSelect: vm.redo },
        { separator: true },
        { label: "Select All", onSelect: vm.selectAll },
      ],
    },
    {
      label: "View",
      items: [
        {
          label: "Word wrap",
          checked: vm.wordWrap,
          onSelect: vm.toggleWordWrap,
        },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "About Notepad++",
          onSelect: () => commands.open({ kind: "about" }),
        },
      ],
    },
  ];

  const length = active?.status === "ready" ? active.draft.length : 0;
  const lines =
    active?.status === "ready" ? active.draft.split("\n").length : 0;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <MenuBar menus={menus} />
      <TabBar vm={vm} />
      <div className="sunken-panel relative min-h-0 flex-1 bg-white">
        {activeTab && (!active || active.status === "loading") ? (
          <p className="p-2">Opening {activeTab.name}...</p>
        ) : null}
        {activeTab && active?.status === "error" ? (
          <p className="p-2">
            Notepad++ cannot open {activeTab.name}: {active.message}
          </p>
        ) : null}
        {paths.map((path) => {
          // Editors mount once their file is ready and stay mounted (hidden) while the tab is open.
          const file = vm.fileAt(path);
          if (file?.status !== "ready") return null;
          return (
            <CodeEditor
              key={path}
              text={file.draft}
              language={editorLanguage(path)}
              wordWrap={vm.wordWrap}
              visible={path === vm.activePath}
              onChange={(text) => vm.edit(path, text)}
              onCursor={vm.setCursor}
              onSave={vm.save}
              onHandle={(handle) => vm.registerEditor(path, handle)}
            />
          );
        })}
      </div>
      <footer className="status-bar shrink-0">
        <p className="status-bar-field w-32 shrink-0 truncate">
          {LANGUAGE_NAMES[vm.language]}
        </p>
        <p className="status-bar-field min-w-0 flex-1 truncate">
          {active?.status === "ready" && active.fromFallback
            ? NOT_ON_GITHUB_NOTICE
            : LOCAL_SAVE_NOTICE}
        </p>
        <p className="status-bar-field w-40 shrink-0">
          length : {length} lines : {lines}
        </p>
        <p className="status-bar-field w-28 shrink-0">
          Ln : {vm.cursor.line} Col : {vm.cursor.column}
        </p>
        <p className="status-bar-field w-14 shrink-0">UTF-8</p>
        <p className="status-bar-field w-10 shrink-0">INS</p>
      </footer>
      <SaveFileDialog vm={vm} />
    </div>
  );
}
