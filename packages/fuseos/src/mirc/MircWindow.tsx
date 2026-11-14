import { useContext, useEffect, useRef, useState } from "react";

import { useAppState } from "../state/useAppState";
import type { MenuDef, MenuItemDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";
import { useWindowCommands } from "../windows/useWindowCommands";

import { STATUS_ID } from "./irc/session";
import type { MircDeps } from "./mircDeps";
import { MircDepsContext } from "./mircDeps";
import { CHILD_ICONS, ChatView, ListView, MircChild } from "./MircChild";
import {
  AboutDialog,
  ChannelsFolderDialog,
  NoteDialog,
  OptionsDialog,
  PromptDialog,
} from "./MircDialogs";
import type { MircIconName } from "./mircIcons";
import { MircIcon } from "./mircIcons";
import type { MircViewModel } from "./useMircViewModel";
import {
  AWAY_MESSAGES,
  childTitle,
  switchbarLabel,
  useMircViewModel,
} from "./useMircViewModel";
import "./mirc.css";

export const MIRC_TITLE = "mIRC";

const NOT_HERE = "This part of mIRC is not available in the FuseOS edition.";
const DCC_NOTE =
  "DCC sends files and chats straight between two computers, which a web page cannot do.";

type ToolbarButton =
  { icon: MircIconName; label: string; run: () => void } | "|";

function useToolbar(
  vm: MircViewModel,
  area: () => { width: number; height: number },
): ToolbarButton[] {
  const online = vm.client.connected;
  const note =
    (title: string, text = NOT_HERE) =>
    () =>
      vm.showNote(title, text);
  return [
    {
      icon: online ? "disconnect" : "connect",
      label: online ? "Disconnect" : "Connect",
      run: () => (online ? vm.client.disconnect() : vm.connect()),
    },
    "|",
    {
      icon: "options",
      label: "Options",
      run: () => vm.setDialog({ type: "options" }),
    },
    "|",
    {
      icon: "channelsFolder",
      label: "Channels Folder",
      run: () => vm.setDialog({ type: "folder" }),
    },
    {
      icon: "listChannels",
      label: "List Channels",
      run: () => vm.client.list(),
    },
    "|",
    { icon: "aliases", label: "Aliases", run: note("Aliases") },
    { icon: "popups", label: "Popups", run: note("Popups") },
    { icon: "remote", label: "Remote", run: note("Remote") },
    "|",
    { icon: "finger", label: "Finger", run: note("Finger") },
    { icon: "timer", label: "Timer", run: note("Timer") },
    {
      icon: "colours",
      label: "Colours",
      run: note(
        "Colours",
        "Type Ctrl+K and a number from 0 to 15 to colour your text, Ctrl+B for bold, Ctrl+U for underline.",
      ),
    },
    { icon: "addressBook", label: "Address Book", run: note("Address Book") },
    "|",
    { icon: "dccSend", label: "DCC Send", run: note("DCC Send", DCC_NOTE) },
    { icon: "dccChat", label: "DCC Chat", run: note("DCC Chat", DCC_NOTE) },
    {
      icon: "dccOptions",
      label: "DCC Options",
      run: note("DCC Options", DCC_NOTE),
    },
    "|",
    { icon: "notify", label: "Notify List", run: note("Notify List") },
    { icon: "urlList", label: "URL List", run: note("URL List") },
    "|",
    { icon: "tile", label: "Tile Windows", run: () => vm.tile(area()) },
    { icon: "cascade", label: "Cascade Windows", run: vm.cascade },
    "|",
    {
      icon: "help",
      label: "Help",
      run: () => vm.client.submit(vm.state.activeId, "/help"),
    },
    {
      icon: "about",
      label: "About",
      run: () => vm.setDialog({ type: "about" }),
    },
  ];
}

function menus(
  vm: MircViewModel,
  area: () => { width: number; height: number },
  exit: () => void,
): MenuDef[] {
  const online = vm.client.connected;
  const active = vm.state.windows.find(
    (window) => window.id === vm.state.activeId,
  );
  const inChannel = active?.kind === "channel" ? active.name : undefined;
  const run = (text: string) => vm.client.submit(vm.state.activeId, text);
  const note =
    (title: string, text = NOT_HERE) =>
    () =>
      vm.showNote(title, text);
  const away: MenuItemDef[] = [
    ...AWAY_MESSAGES.map((message) => ({
      label: `Away: ${message}`,
      disabled: !online,
      checked: vm.state.away === message,
      onSelect: () => vm.client.setAway(message),
    })),
    {
      label: "Back",
      disabled: !online || vm.state.away === undefined,
      onSelect: () => vm.client.setAway(undefined),
    },
  ];
  return [
    {
      label: "File",
      items: [
        { label: "Connect", disabled: online, onSelect: () => vm.connect() },
        {
          label: "Disconnect",
          disabled: !online,
          onSelect: () => vm.client.disconnect(),
        },
        { separator: true },
        {
          label: "Select Server...",
          onSelect: () => vm.setDialog({ type: "options" }),
        },
        {
          label: "Options...",
          shortcut: "Alt+O",
          onSelect: () => vm.setDialog({ type: "options" }),
        },
        { separator: true },
        { label: "Exit", onSelect: exit },
      ],
    },
    {
      label: "Tools",
      items: [
        { label: "Aliases...", onSelect: note("Aliases") },
        { label: "Popups...", onSelect: note("Popups") },
        { label: "Remote...", onSelect: note("Remote") },
        { label: "Address Book...", onSelect: note("Address Book") },
        { separator: true },
        { label: "Channels List", onSelect: () => vm.client.list() },
        {
          label: "Timestamp",
          checked: vm.prefs.timestamps,
          onSelect: () => vm.setTimestamps(!vm.prefs.timestamps),
        },
      ],
    },
    {
      label: "DCC",
      items: [
        { label: "Send...", onSelect: note("DCC Send", DCC_NOTE) },
        { label: "Chat...", onSelect: note("DCC Chat", DCC_NOTE) },
        { label: "Options...", onSelect: note("DCC Options", DCC_NOTE) },
      ],
    },
    {
      label: "Commands",
      items: [
        {
          label: "Join channel...",
          disabled: !online,
          onSelect: () =>
            vm.prompt(
              "Join channel",
              "Enter name of channel to join:",
              (value) => run(`/join ${value}`),
              "#fuseos-test",
            ),
        },
        {
          label: "Part channel",
          disabled: !online || !inChannel,
          onSelect: () => run("/part"),
        },
        {
          label: "Query user...",
          onSelect: () =>
            vm.prompt(
              "Query user",
              "Enter nickname of user to query:",
              (value) => vm.client.openQuery(value),
            ),
        },
        {
          label: "Whois user...",
          disabled: !online,
          onSelect: () =>
            vm.prompt("Whois user", "Enter nickname of user:", (value) =>
              run(`/whois ${value}`),
            ),
        },
        {
          label: "Change nick...",
          onSelect: () =>
            vm.prompt(
              "Change nick",
              "Enter your new nickname:",
              (value) => run(`/nick ${value}`),
              vm.state.nick,
            ),
        },
        { separator: true },
        ...away,
        { separator: true },
        { label: "Quit IRC", disabled: !online, onSelect: () => run("/quit") },
      ],
    },
    {
      label: "Window",
      items: [
        { label: "Tile", onSelect: () => vm.tile(area()) },
        { label: "Cascade", onSelect: vm.cascade },
        { separator: true },
        ...vm.state.windows.map((window, index) => ({
          label: `${index + 1} ${switchbarLabel(window, vm.state)}`,
          checked: window.id === vm.state.activeId,
          onSelect: () => vm.activateChild(window.id),
        })),
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Contents", onSelect: () => run("/help") },
        {
          label: "Register...",
          onSelect: () => vm.setDialog({ type: "about" }),
        },
        { separator: true },
        {
          label: "About mIRC...",
          onSelect: () => vm.setDialog({ type: "about" }),
        },
      ],
    },
  ];
}

function MircFrame({ windowId, deps }: { windowId: string; deps: MircDeps }) {
  const vm = useMircViewModel(deps);
  const commands = useWindowCommands();
  const { dispatch } = useAppState();
  const workspace = useRef<HTMLDivElement>(null);
  const area = () => {
    const rect = workspace.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  };
  // The workspace's size once laid out, so new children cascade at a size that fits it.
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    setSize({ width: element.clientWidth, height: element.clientHeight });
  }, []);
  const { state } = vm;
  const activeWindow = state.windows.find(
    (window) => window.id === state.activeId,
  );
  const caption =
    vm.maximized && activeWindow
      ? `${MIRC_TITLE} - [${childTitle(activeWindow, state)}]`
      : MIRC_TITLE;

  // The frame's title shows the maximized child's caption, as an MDI frame does.
  useEffect(() => {
    dispatch({
      type: "patch",
      id: windowId,
      patch: (window) =>
        window.kind === "mirc" && window.caption !== caption
          ? { ...window, caption }
          : window,
    });
  }, [caption, dispatch, windowId]);

  const toolbar = useToolbar(vm, area);
  const dialog = vm.dialog;
  const closeDialog = () => vm.setDialog(null);

  return (
    <div className="mirc" data-testid="mirc">
      <MenuBar menus={menus(vm, area, () => commands.close(windowId))} />
      <div className="mirc-toolbar" role="toolbar" aria-label="mIRC toolbar">
        {toolbar.map((button, index) =>
          button === "|" ? (
            <span key={`sep${index}`} className="mirc-toolbar-sep" />
          ) : (
            <button
              key={button.label}
              type="button"
              className="mirc-tool"
              title={button.label}
              aria-label={button.label}
              onClick={button.run}
            >
              <MircIcon name={button.icon} />
            </button>
          ),
        )}
      </div>
      <div className="mirc-switchbar" role="tablist" aria-label="Switchbar">
        {state.windows.map((window) => (
          <button
            key={window.id}
            type="button"
            role="tab"
            aria-selected={
              window.id === state.activeId && !vm.minimized.has(window.id)
            }
            className="mirc-switch"
            data-activity={window.activity}
            title={childTitle(window, state)}
            onClick={() => vm.switchTo(window.id)}
          >
            <MircIcon name={CHILD_ICONS[window.kind]} />
            <span>{switchbarLabel(window, state)}</span>
          </button>
        ))}
      </div>
      <div className="mirc-workspace" ref={workspace}>
        {state.windows.map((window, index) => {
          if (vm.minimized.has(window.id)) return null;
          const active = window.id === state.activeId;
          return (
            <MircChild
              key={window.id}
              window={window}
              title={childTitle(window, state)}
              active={active}
              maximized={vm.maximized}
              rect={vm.rectFor(window.id, index, size)}
              zIndex={active ? 100 : index + 1}
              onActivate={() => {
                if (!active) vm.activateChild(window.id);
              }}
              onMove={(rect) => vm.moveChild(window.id, rect)}
              onMinimize={() => vm.minimizeChild(window.id)}
              onToggleMaximize={() => vm.setMaximized(!vm.maximized)}
              onClose={() =>
                window.id === STATUS_ID
                  ? commands.close(windowId)
                  : vm.client.closeWindow(window.id)
              }
            >
              {window.kind === "list" ? (
                <ListView state={state} client={vm.client} />
              ) : (
                <ChatView
                  window={window}
                  client={vm.client}
                  timestamps={vm.prefs.timestamps}
                  active={active}
                />
              )}
            </MircChild>
          );
        })}
        {vm.maximized && activeWindow ? (
          <div className="mirc-mdi-controls">
            <button
              type="button"
              aria-label="Restore child"
              onClick={() => vm.setMaximized(false)}
            >
              <MircIcon name="cascade" size={12} />
            </button>
          </div>
        ) : null}
      </div>
      {dialog?.type === "about" ? (
        <AboutDialog
          days={vm.days}
          onClose={closeDialog}
          onNote={vm.showNote}
        />
      ) : dialog?.type === "options" ? (
        <OptionsDialog
          prefs={vm.prefs}
          onSave={vm.savePrefs}
          onConnect={vm.connect}
          onClose={closeDialog}
        />
      ) : dialog?.type === "folder" ? (
        <ChannelsFolderDialog
          prefs={vm.prefs}
          online={state.phase === "online"}
          onSave={vm.savePrefs}
          onJoin={(channel) => vm.client.join(channel)}
          onClose={closeDialog}
        />
      ) : dialog?.type === "note" ? (
        <NoteDialog
          title={dialog.title}
          text={dialog.text}
          onClose={closeDialog}
        />
      ) : dialog?.type === "prompt" ? (
        <PromptDialog
          title={dialog.title}
          label={dialog.label}
          initial={dialog.initial}
          onSubmit={dialog.submit}
          onClose={closeDialog}
        />
      ) : null}
    </div>
  );
}

/** Start > Programs > mIRC: an IRC client in the shape of mIRC 6.0x, connecting through WebSockets. */
export function MircWindow({ windowId }: { windowId: string }) {
  const deps = useContext(MircDepsContext);
  if (!deps)
    return (
      <div className="mirc mirc-unavailable" data-testid="mirc">
        <p>mIRC is not installed in this build.</p>
      </div>
    );
  return <MircFrame windowId={windowId} deps={deps} />;
}
