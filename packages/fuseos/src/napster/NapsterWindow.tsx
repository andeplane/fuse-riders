import "./napster.css";

import type { ReactNode } from "react";
import { useState } from "react";

import { MenuBar } from "../windows/MenuBar";

import { formatCount } from "./fakeNetwork";
import { NapsterLogo } from "./NapsterLogo";
import {
  ChatPane,
  DiscoverPane,
  HelpPane,
  HomePane,
  HotListPane,
  LibraryPane,
  TransferPane,
} from "./NapsterPanes";
import type { NapsterState, NapsterTab } from "./napsterSession";
import type { SearchForm } from "./SearchTab";
import { EMPTY_SEARCH_FORM, SearchTab } from "./SearchTab";
import { useNapsterViewModel } from "./useNapsterViewModel";

/** Every tab on the bar, in the 2.0 beta 7 order; the session only tracks the five with live state. */
export type NapsterTabId = NapsterTab | "home" | "discover" | "help";

const TABS: readonly { id: NapsterTabId; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <NapsterLogo width={14} height={14} /> },
  { id: "chat", label: "Chat", icon: <TabGlyph kind="chat" /> },
  { id: "library", label: "Library", icon: <TabGlyph kind="library" /> },
  { id: "search", label: "Search", icon: <TabGlyph kind="search" /> },
  { id: "hotlist", label: "Hot List", icon: <TabGlyph kind="hotlist" /> },
  { id: "transfer", label: "Transfer", icon: <TabGlyph kind="transfer" /> },
  { id: "discover", label: "Discover", icon: <TabGlyph kind="discover" /> },
  { id: "help", label: "Help", icon: <TabGlyph kind="help" /> },
];

/** Small hand-drawn glyphs for the tab buttons, in the client's colours. */
function TabGlyph({
  kind,
}: {
  kind:
    | "chat"
    | "library"
    | "search"
    | "hotlist"
    | "transfer"
    | "discover"
    | "help";
}) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 14 14",
    "aria-hidden": true,
  } as const;
  switch (kind) {
    case "chat":
      return (
        <svg {...common}>
          <path d="M1 2h12v7H6l-3 3V9H1z" fill="#fff" stroke="#000" />
          <path d="M3 4.5h8M3 6.5h6" stroke="#808080" />
        </svg>
      );
    case "library":
      return (
        <svg {...common}>
          <path d="M1 3h5l1 1h6v8H1z" fill="#ffd800" stroke="#806000" />
          <rect x="3" y="6" width="3" height="4" fill="#0000a0" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle
            cx="5.5"
            cy="5.5"
            r="3.6"
            fill="#c0e0ff"
            stroke="#000"
            strokeWidth="1.4"
          />
          <path d="M8.2 8.2 12.5 12.5" stroke="#800000" strokeWidth="2.2" />
        </svg>
      );
    case "hotlist":
      return (
        <svg {...common}>
          <path d="M2 1h8l2 2v10H2z" fill="#fff" stroke="#000" />
          <path d="M4 5h6M4 7.5h6M4 10h4" stroke="#c00000" />
        </svg>
      );
    case "transfer":
      return (
        <svg {...common}>
          <path
            d="M1 4h7V1.5L12.5 5 8 8.5V6H1z"
            fill="#00a000"
            stroke="#004000"
            strokeWidth=".6"
          />
          <path
            d="M13 10H6v2.5L1.5 9 6 5.5V8h7z"
            fill="#00c000"
            stroke="#004000"
            strokeWidth=".6"
          />
        </svg>
      );
    case "discover":
      return (
        <svg {...common}>
          <path
            d="M5 2v8.2A2 2 0 1 0 6.4 12V5l5-1.5v5.7A2 2 0 1 0 12.8 11V1z"
            fill="#d00000"
          />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <path d="M1 2h12v8H7l-3 3v-3H1z" fill="#fffbd0" stroke="#000" />
          <text
            x="7"
            y="9"
            fontSize="8"
            textAnchor="middle"
            fontWeight="bold"
            fill="#0000c0"
          >
            ?
          </text>
        </svg>
      );
  }
}

/** The banner strip under the menus: the site address on the busy tabs, the ad slot nobody bought elsewhere. */
function Banner({ tab }: { tab: NapsterTabId }) {
  if (tab === "search" || tab === "transfer")
    return (
      <div className="napster-banner address" aria-label="Banner">
        <span>www.fusegames.ai</span>
      </div>
    );
  return (
    <div className="napster-banner ad" aria-label="Banner">
      <span className="napster-ad-big">Want Your Ad Here?</span>
      <span className="napster-ad-small">
        Inquire
        <br />
        Within
      </span>
    </div>
  );
}

export function statusLines(state: NapsterState): [string, string] {
  const shared = state.library.filter((file) => file.shared).length;
  switch (state.connection) {
    case "connecting":
      return ["Connecting to server...", ""];
    case "offline":
      return ["Offline", "Not connected to the Napster network."];
    case "shutdown":
      return [
        "Offline",
        "The Napster network is unavailable due to a court order.",
      ];
    case "online": {
      const stats = state.stats;
      return [
        `Online (${state.username}): Sharing ${shared} files.`,
        stats
          ? `Currently ${formatCount(stats.files)} files (${formatCount(stats.gigabytes)} gigabytes) available in ${formatCount(stats.libraries)} libraries.`
          : "",
      ];
    }
  }
}

/** Napster v2.0 BETA 7 on the FuseOS desktop: grey Win98 chrome, black chat, nothing real behind it. */
export function NapsterWindow({ windowId }: { windowId: string }) {
  const vm = useNapsterViewModel(windowId);
  const { state, session } = vm;
  const [form, setForm] = useState<SearchForm>(EMPTY_SEARCH_FORM);
  const [extraTab, setExtraTab] = useState<"home" | "discover" | "help">();
  const tab: NapsterTabId = extraTab ?? state.tab;
  const choose = (id: NapsterTabId) => {
    if (id === "home" || id === "discover" || id === "help") setExtraTab(id);
    else {
      setExtraTab(undefined);
      session.setTab(id);
    }
  };
  const online = state.connection === "online";
  const [left, right] = statusLines(state);

  return (
    <div className="napster">
      <MenuBar
        menus={[
          {
            label: "File",
            items: [
              {
                label: "Connect",
                disabled: online || state.connection === "connecting",
                onSelect: () => session.connect(),
              },
              {
                label: "Disconnect",
                disabled: !online,
                onSelect: () => session.disconnect(),
              },
              { separator: true },
              { label: "Exit", onSelect: vm.close },
            ],
          },
          {
            label: "Actions",
            items: [
              { label: "Search", onSelect: () => choose("search") },
              { label: "Join Channel", onSelect: () => choose("chat") },
              {
                label: "Clear Finished Transfers",
                onSelect: () => session.clearFinished(),
              },
            ],
          },
          {
            label: "Help",
            items: [
              { label: "Help Topics", onSelect: () => choose("help") },
              { separator: true },
              { label: "About Napster...", onSelect: vm.showAbout },
            ],
          },
        ]}
      />
      <Banner tab={tab} />
      <div className="napster-tabs" role="tablist" aria-label="Napster">
        {TABS.map((item) => (
          <button
            type="button"
            role="tab"
            key={item.id}
            aria-selected={tab === item.id}
            className={`napster-tab${tab === item.id ? " active" : ""}`}
            onClick={() => choose(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div
        className="napster-body"
        role="tabpanel"
        aria-label={TABS.find((item) => item.id === tab)?.label}
      >
        {tab === "search" ? (
          <SearchTab
            state={state}
            session={session}
            form={form}
            onFormChange={setForm}
          />
        ) : tab === "transfer" ? (
          <TransferPane
            state={state}
            session={session}
            onPlay={(file) => vm.play([file])}
          />
        ) : tab === "library" ? (
          <LibraryPane state={state} vm={vm} />
        ) : tab === "hotlist" ? (
          <HotListPane state={state} session={session} />
        ) : tab === "chat" ? (
          <ChatPane state={state} session={session} />
        ) : tab === "discover" ? (
          <DiscoverPane state={state} />
        ) : tab === "help" ? (
          <HelpPane />
        ) : (
          <HomePane state={state} />
        )}
      </div>
      <div className="napster-status">
        <div className="napster-status-pane" data-testid="napster-status-left">
          {left}
        </div>
        <div className="napster-status-pane" data-testid="napster-status-right">
          {right}
        </div>
      </div>
    </div>
  );
}
