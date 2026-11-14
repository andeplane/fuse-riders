import "./dcpp.css";

import { useContext, useEffect, useState } from "react";

import type { MenuDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { DcState } from "./dcClient";
import type { ToolbarIconName } from "./DcppIcons";
import { ToolbarIcon } from "./DcppIcons";
import { DcppDepsContext } from "./dcppDeps";
import { FileListFrame } from "./FileListFrame";
import { formatBytes, formatSpeed } from "./format";
import { FUSEHUB, findHub } from "./hubs";
import { HubFrame } from "./HubFrame";
import { ListView } from "./ListView";
import { PublicHubsFrame } from "./PublicHubsFrame";
import { FinishedFrame, QueueFrame, TransferView } from "./QueueFrames";
import { SearchFrame } from "./SearchFrame";
import { SettingsDialog } from "./SettingsDialog";
import type { DcppViewModel, Frame } from "./useDcppViewModel";
import { frameKey, frameTitle, useDcppViewModel } from "./useDcppViewModel";

export const DCPP_VERSION = "0.401";

type ToolButton =
  | { separator: true }
  | {
      separator?: false;
      icon: ToolbarIconName;
      label: string;
      onClick?: () => void;
    };

function Toolbar({ buttons }: { buttons: readonly ToolButton[] }) {
  return (
    <div className="dc-toolbar" role="toolbar" aria-label="DC++ toolbar">
      {buttons.map((button, index) =>
        button.separator ? (
          <span key={`sep-${index}`} className="dc-toolsep" aria-hidden />
        ) : (
          <button
            key={button.icon}
            type="button"
            className="dc-toolbutton flat"
            title={button.label}
            aria-label={button.label}
            disabled={!button.onClick}
            onClick={button.onClick}
          >
            <ToolbarIcon name={button.icon} />
          </button>
        ),
      )}
    </div>
  );
}

function FavoritesFrame({ onConnect }: { onConnect: (address: string) => void }) {
  const [selected, setSelected] = useState<string>();
  const hub = findHub(useContext(DcppDepsContext).hubs, FUSEHUB);
  const rows = hub ? [hub] : [];
  return (
    <div className="dc-frame">
      <ListView
        label="Favorite hubs"
        columns={[
          { key: "auto", label: "Auto connect / Name", width: 260, render: (row) => row.name },
          { key: "description", label: "Description", width: 300, render: (row) => row.description },
          { key: "nick", label: "Nick", width: 90, render: () => "" },
          { key: "password", label: "Password", width: 80, render: () => "" },
          { key: "server", label: "Server", width: 170, render: (row) => row.address },
        ]}
        rows={rows}
        rowKey={(row) => row.address}
        selected={selected}
        onSelect={setSelected}
        onOpen={(row) => onConnect(row.address)}
      />
      <div className="dc-favbuttons">
        <button type="button" disabled>
          New...
        </button>
        <button type="button" disabled>
          Properties
        </button>
        <button type="button" disabled>
          Remove
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => {
            if (selected) onConnect(selected);
          }}
        >
          Connect
        </button>
      </div>
    </div>
  );
}

function FrameBody({ frame, vm }: { frame: Frame; vm: DcppViewModel }) {
  const { client, state } = vm;
  const { hubs } = useContext(DcppDepsContext);
  switch (frame.kind) {
    case "publicHubs":
      return (
        <PublicHubsFrame
          hubs={hubs}
          onConnect={vm.connect}
          onRefresh={() => client.note("Hub list downloaded")}
        />
      );
    case "favorites":
      return <FavoritesFrame onConnect={vm.connect} />;
    case "hub": {
      const connection = client.connection(frame.address);
      if (!connection) return <div className="dc-frame" />;
      return (
        <HubFrame
          connection={connection}
          self={state.nick}
          onSend={(text) => client.sendChat(frame.address, text)}
          onFileList={(nick) => vm.openFileList(nick, frame.address)}
          onReconnect={() => client.reconnect(frame.address)}
          onFollowRedirect={vm.followRedirect}
        />
      );
    }
    case "search":
      return (
        <SearchFrame
          search={state.search}
          hubs={state.hubs
            .filter((hub) => hub.status === "connected")
            .map((hub) => ({ name: hub.hub.name, address: hub.address }))}
          onSearch={(query) => client.search(query)}
          onDownload={(row) => client.download(row)}
          onFileList={(row) => vm.openFileList(row.nick, row.hubAddress)}
        />
      );
    case "queue":
      return (
        <QueueFrame
          queue={state.queue}
          onRetry={(id) => client.retry(id)}
          onRemove={(id) => client.remove(id)}
        />
      );
    case "finished":
      return (
        <FinishedFrame
          finished={state.finished}
          onOpen={vm.openFinished}
          onClear={() => client.clearFinished()}
        />
      );
    case "notepad":
      return (
        <div className="dc-frame">
          <textarea
            className="dc-notepad"
            aria-label="Notepad"
            value={vm.notepadText}
            onChange={(event) => vm.setNotepadText(event.target.value)}
          />
        </div>
      );
    case "fileList": {
      const view = state.fileLists.find(
        (list) => list.nick === frame.nick && list.hubAddress === frame.hubAddress,
      );
      if (!view) return <div className="dc-frame" />;
      const hubName = frameTitle({ kind: "hub", address: frame.hubAddress }, state);
      return (
        <FileListFrame
          view={view}
          onDownload={(file) =>
            client.download({
              ...file,
              file: file.name,
              nick: frame.nick,
              hub: hubName,
              hubAddress: frame.hubAddress,
            })
          }
        />
      );
    }
  }
}

/** Bold tabs for hubs with chat the user has not looked at, as DC++ flagged them. */
function useUnread(vm: DcppViewModel): ReadonlySet<string> {
  const [seen, setSeen] = useState<Record<string, number>>({});
  const active = vm.active?.kind === "hub" ? vm.active.address : undefined;
  const activeLines = active
    ? (vm.client.connection(active)?.chat.length ?? 0)
    : 0;
  useEffect(() => {
    if (active)
      setSeen((current) =>
        current[active] === activeLines
          ? current
          : { ...current, [active]: activeLines },
      );
  }, [active, activeLines]);
  return new Set(
    vm.state.hubs
      .filter(
        (hub) =>
          hub.address !== active && hub.chat.length > (seen[hub.address] ?? 0),
      )
      .map((hub) => `hub:${hub.address}`),
  );
}

/** The 1px line along a tab (FlatTabCtrl): green/red for a connected/dropped hub, blue for Search, magenta for a file list. */
function tabLine(frame: Frame, state: DcState): string {
  if (frame.kind === "hub")
    return state.hubs.find((hub) => hub.address === frame.address)?.status ===
      "connected"
      ? "online"
      : "offline";
  if (frame.kind === "search") return "search";
  if (frame.kind === "fileList") return "filelist";
  return "plain";
}

function statusSegments(state: DcState) {
  const connected = state.hubs.filter((hub) => hub.status === "connected").length;
  const running = state.queue.filter((item) => item.state === "running");
  const down = running.reduce((sum, item) => sum + item.speed, 0);
  return [
    `H: ${connected}/0/0`,
    "Slots: 3/3",
    `D: ${formatBytes(state.downloadedTotal)}`,
    `U: ${formatBytes(state.uploadedTotal)}`,
    `D: ${formatSpeed(down)} (${running.length})`,
    `U: ${formatSpeed(0)} (0)`,
  ];
}

/** DC++ 0.401: menu, toolbar, maximized MDI children with tabs along the bottom, the Transfers pane and status bar. */
export function DcppWindow({ windowId }: { windowId: string }) {
  const vm = useDcppViewModel();
  const commands = useWindowCommands();
  const deps = useContext(DcppDepsContext);
  const [showToolbar, setShowToolbar] = useState(true);
  const [showStatus, setShowStatus] = useState(true);
  const [showTransfers, setShowTransfers] = useState(true);
  const unread = useUnread(vm);
  const { state, client } = vm;
  const activeHub =
    vm.active?.kind === "hub" ? client.connection(vm.active.address) : undefined;

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        { label: "Open file list...", disabled: true },
        { label: "Refresh file list", onSelect: () => client.note("File list refreshed") },
        { label: "Open downloads directory", disabled: true },
        { separator: true },
        {
          label: "Follow last redirect",
          disabled: !activeHub?.redirect,
          onSelect: vm.followRedirect,
        },
        { label: "Reconnect", disabled: !activeHub, onSelect: vm.reconnect },
        { separator: true },
        { label: "Import queue from NMDC...", disabled: true },
        { label: "Settings...", onSelect: () => vm.setSettingsOpen(true) },
        { separator: true },
        { label: "Exit", onSelect: () => commands.close(windowId) },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Public Hubs", onSelect: () => vm.openFrame({ kind: "publicHubs" }) },
        { label: "Favorite Hubs", onSelect: () => vm.openFrame({ kind: "favorites" }) },
        { label: "Favorite Users", disabled: true },
        { label: "Search", onSelect: () => vm.openFrame({ kind: "search" }) },
        { label: "ADL Search", disabled: true },
        { label: "Search Spy", disabled: true },
        { label: "Notepad", onSelect: () => vm.openFrame({ kind: "notepad" }) },
        { separator: true },
        { label: "Download Queue", onSelect: () => vm.openFrame({ kind: "queue" }) },
        { label: "Finished Downloads", onSelect: () => vm.openFrame({ kind: "finished" }) },
        { label: "Finished Uploads", disabled: true },
        { separator: true },
        { label: "Toolbar", checked: showToolbar, onSelect: () => setShowToolbar(!showToolbar) },
        { label: "Status bar", checked: showStatus, onSelect: () => setShowStatus(!showStatus) },
        {
          label: "Transfer view",
          checked: showTransfers,
          onSelect: () => setShowTransfers(!showTransfers),
        },
      ],
    },
    {
      label: "Window",
      items: [
        { label: "Cascade", disabled: true },
        { label: "Horizontal Tile", disabled: true },
        { label: "Vertical Tile", disabled: true },
        { label: "Arrange icons", disabled: true },
        { label: "Minimize All", disabled: true },
        { separator: true },
        {
          label: "Close disconnected",
          onSelect: () =>
            state.hubs
              .filter((hub) => hub.status === "disconnected")
              .forEach((hub) => vm.closeFrame(`hub:${hub.address}`)),
        },
        ...vm.frames.map((frame) => ({
          label: frameTitle(frame, state),
          checked: frameKey(frame) === vm.activeKey,
          onSelect: () => vm.activate(frameKey(frame)),
        })),
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Readme", disabled: true },
        { label: "Change Log", disabled: true },
        { label: "About DC++...", onSelect: () => vm.setAboutOpen(true) },
        { separator: true },
        { label: "DC++ Homepage", disabled: true },
        { label: "Help Forum", disabled: true },
      ],
    },
  ];

  const buttons: ToolButton[] = [
    { icon: "publicHubs", label: "Public Hubs", onClick: () => vm.openFrame({ kind: "publicHubs" }) },
    { icon: "reconnect", label: "Reconnect", onClick: activeHub ? vm.reconnect : undefined },
    {
      icon: "redirect",
      label: "Follow last redirect",
      onClick: activeHub?.redirect ? vm.followRedirect : undefined,
    },
    { separator: true },
    { icon: "favorites", label: "Favorite Hubs", onClick: () => vm.openFrame({ kind: "favorites" }) },
    { icon: "favoriteUsers", label: "Favorite Users" },
    { separator: true },
    { icon: "queue", label: "Download Queue", onClick: () => vm.openFrame({ kind: "queue" }) },
    { icon: "finished", label: "Finished Downloads", onClick: () => vm.openFrame({ kind: "finished" }) },
    { icon: "finishedUploads", label: "Finished Uploads" },
    { separator: true },
    { icon: "search", label: "Search", onClick: () => vm.openFrame({ kind: "search" }) },
    { icon: "adlSearch", label: "ADL Search" },
    { icon: "searchSpy", label: "Search Spy" },
    { separator: true },
    { icon: "openFileList", label: "Open file list..." },
    { separator: true },
    { icon: "settings", label: "Settings", onClick: () => vm.setSettingsOpen(true) },
    { icon: "notepad", label: "Notepad", onClick: () => vm.openFrame({ kind: "notepad" }) },
  ];

  return (
    <div className="dcpp" data-testid="dcpp">
      <div className="dc-menurow">
        <MenuBar menus={menus} />
        {vm.active ? (
          <div className="dc-mdicontrols">
            <button
              type="button"
              aria-label={`Close ${frameTitle(vm.active, state)}`}
              onClick={() => vm.activeKey && vm.closeFrame(vm.activeKey)}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
      {showToolbar ? <Toolbar buttons={buttons} /> : null}
      <div className="dc-mdi">
        {/* Every child stays mounted, as MDI windows did, so a search form or a scrolled chat survives a tab switch. */}
        {vm.frames.map((frame) => (
          <div
            key={frameKey(frame)}
            className="dc-child"
            hidden={frameKey(frame) !== vm.activeKey}
          >
            <FrameBody frame={frame} vm={vm} />
          </div>
        ))}
        {vm.active ? null : <div className="dc-mdi-empty" />}
      </div>
      {showTransfers ? (
        <TransferView
          queue={state.queue}
          now={deps.now()}
          onRemove={(id) => client.remove(id)}
          onRetry={(id) => client.retry(id)}
        />
      ) : null}
      <div className="dc-tabs" role="tablist" aria-label="Windows">
        {vm.frames.map((frame) => {
          const key = frameKey(frame);
          const title = frameTitle(frame, state);
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === vm.activeKey}
              title={title}
              aria-label={title}
              className={`dc-tab flat dc-line-${tabLine(frame, state)} ${unread.has(key) ? "dc-tab-unread" : ""} ${
                frame.kind === "hub" &&
                client.connection(frame.address)?.status === "disconnected"
                  ? "dc-tab-offline"
                  : ""
              }`}
              onClick={() => vm.activate(key)}
              onAuxClick={(event) => {
                if (event.button === 1) vm.closeFrame(key);
              }}
            >
              {title.length > 24 ? `${title.slice(0, 22)}...` : title}
            </button>
          );
        })}
      </div>
      {showStatus ? (
        <div className="dc-statusbar" role="status">
          <span className="dc-cell dc-grow">{state.statusText || "Ready"}</span>
          {statusSegments(state).map((text) => (
            <span key={text.slice(0, 3)} className="dc-cell">
              {text}
            </span>
          ))}
        </div>
      ) : null}
      {vm.settingsOpen ? (
        <SettingsDialog
          initial={{ nick: state.nick, shareDirs: state.shareDirs }}
          repoSize={client.repoSize()}
          repoReady={vm.repoReady}
          onOk={(values) => {
            client.setNick(values.nick);
            client.setShareDirs(values.shareDirs);
            vm.setSettingsOpen(false);
          }}
          onCancel={() => vm.setSettingsOpen(false)}
        />
      ) : null}
      {vm.aboutOpen ? (
        <div className="dc-modal" role="presentation">
          <div className="window dc-about" role="dialog" aria-label="About DC++">
            <div className="title-bar">
              <div className="title-bar-text">About DC++</div>
            </div>
            <div className="window-body">
              <p>
                <strong>DC++ v{DCPP_VERSION}</strong>
              </p>
              <p>A Direct Connect client, as it looked in 2003.</p>
              <p>
                This copy is a FuseOS toy: every hub, user and file is made up and
                nothing connects to anything.
              </p>
              <p>
                Total up: {formatBytes(state.uploadedTotal)} · Total down:{" "}
                {formatBytes(state.downloadedTotal)}
              </p>
              <div className="dc-dialogbuttons">
                <button type="button" onClick={() => vm.setAboutOpen(false)}>
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
