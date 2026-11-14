import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { IrcClient } from "./irc/client";
import { BOLD, colorize, RESET } from "./irc/format";
import type { IrcNetwork } from "./irc/networks";
import {
  DEFAULT_NETWORK_ID,
  findNetwork,
  NETWORKS,
  SIM_SCHEME,
  simNetwork,
} from "./irc/networks";
import type { IrcTransport } from "./irc/transport";
import type { ChatWindow, SessionState } from "./irc/session";
import { STATUS_ID } from "./irc/session";
import type { MircDeps } from "./mircDeps";
import type { MircPrefs } from "./mircPrefs";
import { daysUsed, defaultPrefs, identFor } from "./mircPrefs";
import type { RegularsBrain } from "./sim/brain";
import { DDR_CHANNEL } from "./sim/regulars";
import { createSimTransport } from "./sim/simServer";
import { useRegularsBrain } from "./sim/useRegularsBrain";

export type MircDialog =
  | { type: "about" }
  | { type: "options" }
  | { type: "folder" }
  | { type: "note"; title: string; text: string }
  | {
      type: "prompt";
      title: string;
      label: string;
      initial: string;
      submit: (value: string) => void;
    };

/** Where an MDI child sits inside the frame's workspace, in CSS pixels. */
export type ChildRect = { x: number; y: number; width: number; height: number };

export const CASCADE_STEP = 22;
const DEFAULT_CHILD = { width: 560, height: 330 };

/** The welcome banner printed in Status when mIRC opens: a MOTD in the colours of the time. */
export function welcomeBanner(network: IrcNetwork): string[] {
  const art = [
    "            ___ ____   ____",
    "  _ __ ___ |_ _|  _ \\ / ___|",
    " | '_ ` _ \\ | || |_) | |",
    " | | | | | || ||  _ <| |___",
    " |_| |_| |_|___|_| \\_\\\\____|",
  ];
  return [
    ...art.map((row, index) => colorize(row, [12, 12, 2, 2, 6][index] ?? 2)),
    "",
    `${BOLD}Welcome to mIRC${RESET} - FuseOS edition. ${colorize("Shareware", 4)}: please register!`,
    `- Server list: ${network.name} is selected. Press the ${colorize("lightning bolt", 7)} or type /server to connect.`,
    `- Web pages can't open IRC connections, so FuseOS simulates the networks. Try ${BOLD}/join ${DDR_CHANNEL}${BOLD}.`,
    "- /help lists the commands; Ctrl+K colours, Ctrl+B bold, Ctrl+U underline.",
    "- /list shows the channel list (a 2001 snapshot while you're offline).",
    "",
  ];
}

/** The classic away messages of the Commands menu. */
export const AWAY_MESSAGES: readonly string[] = [
  "Gone to eat",
  "brb",
  "Away from keyboard",
  "Sleeping zZzZz",
  "At school",
  "Mom needs the phone line",
];

/** A child window's caption, as mIRC drew it. */
export function childTitle(window: ChatWindow, state: SessionState): string {
  switch (window.kind) {
    case "status":
      if (state.phase === "offline") return "Status";
      return `Status: ${state.nick}${state.userModes ? ` [+${state.userModes}]` : ""} on ${state.support.network ?? state.network} (${state.server})`;
    case "channel": {
      const modes = window.modes ? ` [+${window.modes}]` : "";
      const count = window.joined ? ` [${window.members.length}]` : "";
      return `${window.name}${count}${modes}${window.topic ? `: ${window.topic}` : ""}`;
    }
    case "query":
      return window.name;
    case "list":
      return `${state.list.entries.length} Channels${state.list.demo ? " (offline snapshot)" : ""}`;
  }
}

/** The switchbar button's label: `EFnet Guest1234` for an online Status, else the window's name. */
export function switchbarLabel(
  window: ChatWindow,
  state: SessionState,
): string {
  if (window.kind === "status")
    return state.phase === "online"
      ? `${state.support.network ?? state.network} ${state.nick}`
      : "Status";
  if (window.kind === "list") return "Channels List";
  return window.name;
}

export function useMircViewModel(deps: MircDeps) {
  const [prefs, setPrefsState] = useState<MircPrefs>(
    () => deps.prefs.get() ?? defaultPrefs(deps.random, deps.now()),
  );
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const network =
    findNetwork(prefs.networkId) ??
    (findNetwork(DEFAULT_NETWORK_ID) as IrcNetwork);

  // The regulars think with the shared model when allowed; the simulated server reads the current brain each time.
  const choice = useRegularsBrain(prefs.smartRegulars, deps.random);
  const brainRef = useRef<RegularsBrain>(deps.brain ?? choice.brain);
  brainRef.current = deps.brain ?? choice.brain;

  const [client] = useState(() => {
    const brain: RegularsBrain = {
      describe: () => brainRef.current.describe(),
      usesModel: () => brainRef.current.usesModel(),
      prepare: (signal) => brainRef.current.prepare(signal),
      reply: (request, signal) => brainRef.current.reply(request, signal),
      dispose: () => undefined,
    };
    const sim = createSimTransport(
      { scheduler: deps.scheduler, now: deps.now, random: deps.random, brain },
      simNetwork,
    );
    const transport: IrcTransport = {
      connect: (url, handlers) =>
        url.startsWith(SIM_SCHEME)
          ? sim.connect(url, handlers)
          : deps.transport.connect(url, handlers),
    };
    const created = new IrcClient(
      {
        transport,
        scheduler: deps.scheduler,
        now: deps.now,
        random: deps.random,
        ...(deps.bridgeUrl ? { bridgeUrl: deps.bridgeUrl } : {}),
      },
      {
        nick: prefs.nick,
        altNick: prefs.altNick,
        realName: prefs.realName,
        ident: identFor(prefs),
        invisible: prefs.invisible,
      },
    );
    created.print("motd", welcomeBanner(network));
    return created;
  });
  const state = useSyncExternalStore(client.subscribe, client.getState);

  // Persist first-run defaults so the Guest nick and the day counter stay put.
  useEffect(() => {
    if (!deps.prefs.get()) deps.prefs.set(prefsRef.current);
  }, [deps.prefs]);

  useEffect(() => () => client.dispose(), [client]);

  const [dialog, setDialog] = useState<MircDialog | null>({ type: "about" });
  const [rects, setRects] = useState<Record<string, ChildRect>>({});
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState<ReadonlySet<string>>(new Set());

  // Pop the Channels Folder up once per successful connection, as mIRC 6 did.
  const wasOnline = useRef(false);
  useEffect(() => {
    const online = state.phase === "online";
    if (online && !wasOnline.current && prefsRef.current.folderOnConnect)
      setDialog({ type: "folder" });
    wasOnline.current = online;
  }, [state.phase]);

  const savePrefs = useCallback(
    (next: MircPrefs) => {
      setPrefsState(next);
      deps.prefs.set(next);
      client.setIdentity({
        nick: next.nick,
        altNick: next.altNick,
        realName: next.realName,
        ident: identFor(next),
        invisible: next.invisible,
      });
    },
    [client, deps.prefs],
  );

  const connect = useCallback(
    (target?: IrcNetwork) => {
      const chosen =
        target ?? findNetwork(prefsRef.current.networkId) ?? network;
      client.connect(chosen);
    },
    [client, network],
  );

  /** A child's rectangle: where it was dragged, else cascaded and sized to most of the workspace. */
  const rectFor = useCallback(
    (
      id: string,
      index: number,
      area: { width: number; height: number },
    ): ChildRect => {
      const existing = rects[id];
      if (existing) return existing;
      const step = (index % 6) * CASCADE_STEP;
      if (area.width <= 0 || area.height <= 0)
        return { x: step, y: step, ...DEFAULT_CHILD };
      return {
        x: step,
        y: step,
        width: Math.max(240, Math.round(area.width * 0.86)),
        height: Math.max(160, Math.round(area.height * 0.86)),
      };
    },
    [rects],
  );

  const moveChild = useCallback((id: string, rect: ChildRect) => {
    setRects((current) => ({ ...current, [id]: rect }));
  }, []);

  const visibleWindows = state.windows.filter(
    (window) => !minimized.has(window.id),
  );

  /** Window > Tile: side by side in a grid that fills the workspace. */
  const tile = useCallback(
    (area: { width: number; height: number }) => {
      const shown = state.windows.filter((window) => !minimized.has(window.id));
      const columns = Math.ceil(Math.sqrt(shown.length));
      const rows = Math.ceil(shown.length / Math.max(1, columns));
      const width = Math.floor(area.width / Math.max(1, columns));
      const height = Math.floor(area.height / Math.max(1, rows));
      setMaximized(false);
      setRects(
        Object.fromEntries(
          shown.map((window, index) => [
            window.id,
            {
              x: (index % columns) * width,
              y: Math.floor(index / columns) * height,
              width,
              height,
            },
          ]),
        ),
      );
    },
    [minimized, state.windows],
  );

  const cascade = useCallback(() => {
    setMaximized(false);
    setRects({});
  }, []);

  const activateChild = useCallback(
    (id: string) => {
      setMinimized((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      client.activate(id);
    },
    [client],
  );

  const minimizeChild = useCallback(
    (id: string) => {
      setMinimized((current) => new Set(current).add(id));
      const other = [...state.windows]
        .reverse()
        .find((window) => window.id !== id && !minimized.has(window.id));
      client.activate(other?.id ?? STATUS_ID);
    },
    [client, minimized, state.windows],
  );

  /** A switchbar click: activate, or minimize the window that is already active. */
  const switchTo = useCallback(
    (id: string) => {
      if (id === state.activeId && !minimized.has(id) && !maximized)
        minimizeChild(id);
      else activateChild(id);
    },
    [activateChild, maximized, minimizeChild, minimized, state.activeId],
  );

  const showNote = useCallback(
    (title: string, text: string) => setDialog({ type: "note", title, text }),
    [],
  );

  const prompt = useCallback(
    (
      title: string,
      label: string,
      submit: (value: string) => void,
      initial = "",
    ) => setDialog({ type: "prompt", title, label, initial, submit }),
    [],
  );

  const setTimestamps = useCallback(
    (on: boolean) => savePrefs({ ...prefsRef.current, timestamps: on }),
    [savePrefs],
  );

  const setSmartRegulars = useCallback(
    (on: boolean) => savePrefs({ ...prefsRef.current, smartRegulars: on }),
    [savePrefs],
  );

  return {
    client,
    brainLabel: deps.brain ? deps.brain.describe() : choice.label,
    canThink: deps.brain ? false : choice.canThink,
    downloadMb: choice.downloadMb,
    setSmartRegulars,
    state,
    prefs,
    network,
    networks: NETWORKS,
    days: daysUsed(prefs.firstRun, deps.now()),
    dialog,
    setDialog,
    showNote,
    prompt,
    savePrefs,
    setTimestamps,
    connect,
    rectFor,
    moveChild,
    maximized,
    setMaximized,
    minimized,
    visibleWindows,
    tile,
    cascade,
    activateChild,
    minimizeChild,
    switchTo,
  };
}

export type MircViewModel = ReturnType<typeof useMircViewModel>;
