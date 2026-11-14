import { useEffect, useRef, useState } from "react";

import type { SearchResult } from "./fakeNetwork";
import { formatCount, formatLength } from "./fakeNetwork";
import { userFacts } from "./chat";
import { CATALOG, CHAT_ROOMS } from "./napsterCatalog";
import { NapsterLogo } from "./NapsterLogo";
import type {
  LibraryFile,
  NapsterSession,
  NapsterState,
} from "./napsterSession";
import { baseName } from "./napsterSession";
import type { Column } from "./NapsterTable";
import { NapsterTable } from "./NapsterTable";
import { RESULT_COLUMNS, SpeedDot } from "./SearchTab";
import type { Transfer } from "./transfers";
import {
  formatRate,
  formatTimeLeft,
  formatTransferSize,
  isFinished,
  transferPercent,
  transferStatus,
} from "./transfers";
import type { NapsterViewModel } from "./useNapsterViewModel";

type PaneProps = { state: NapsterState; session: NapsterSession };

function ProgressBar({
  percent,
  direction,
}: {
  percent: number;
  direction: "down" | "up";
}) {
  return (
    <div
      className={`napster-progress ${direction}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="napster-progress-fill" style={{ width: `${percent}%` }} />
      <span>{percent} %</span>
    </div>
  );
}

function transferColumns(direction: "down" | "up"): Column<Transfer>[] {
  return [
    {
      key: "filename",
      label: "Filename",
      width: 196,
      render: (row) => baseName(row.filename),
    },
    {
      key: "size",
      label: "File Size",
      width: 118,
      align: "right",
      render: formatTransferSize,
    },
    { key: "user", label: "User", width: 82, render: (row) => row.user },
    {
      key: "status",
      label: "Status",
      width: 112,
      render: (row) => (
        <span className={row.phase === "error" ? "napster-error" : undefined}>
          {transferStatus(row, direction)}
        </span>
      ),
    },
    { key: "speed", label: "Speed", width: 50, render: (row) => row.lineSpeed },
    {
      key: "progress",
      label: "Progress",
      width: 80,
      render: (row) =>
        row.phase === "downloading" ||
        (row.phase === "error" && row.received > 0) ? (
          <ProgressBar percent={transferPercent(row)} direction={direction} />
        ) : null,
    },
    {
      key: "rate",
      label: "Rate",
      width: 58,
      align: "right",
      render: (row) => formatRate(row.rate),
    },
    {
      key: "left",
      label: "Time Left",
      width: 60,
      align: "right",
      render: formatTimeLeft,
    },
  ];
}

const DOWN_COLUMNS = transferColumns("down");
const UP_COLUMNS = transferColumns("up");

export function TransferPane({
  state,
  session,
  onPlay,
}: PaneProps & { onPlay: (file: LibraryFile) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const active = (list: readonly Transfer[]) =>
    list.filter((transfer) => !isFinished(transfer)).length;
  const open = (transfer: Transfer) => {
    const file = state.library.find((item) => item.id === `dl:${transfer.id}`);
    if (file) onPlay(file);
  };
  return (
    <div className="napster-pane napster-transfer">
      <NapsterTable
        label="Downloads"
        columns={DOWN_COLUMNS}
        rows={state.downloads}
        rowKey={(row) => row.id}
        selected={selected}
        onSelect={setSelected}
        onOpen={open}
        marker={() => (
          <span className="napster-arrow down" aria-hidden>
            ↓
          </span>
        )}
      />
      <NapsterTable
        label="Uploads"
        columns={UP_COLUMNS}
        rows={state.uploads}
        rowKey={(row) => row.id}
        selected={selected}
        onSelect={setSelected}
        marker={() => (
          <span className="napster-arrow up" aria-hidden>
            ↑
          </span>
        )}
      />
      <div className="napster-concurrent">
        <span>Concurrent Downloads: {active(state.downloads)}</span>
        <span>Concurrent Uploads: {active(state.uploads)}</span>
      </div>
      <div className="napster-bottom even">
        <button type="button" onClick={() => session.clearFinished()}>
          Clear Finished
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => {
            selected.forEach((id) => session.cancel(id));
            setSelected([]);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const LIBRARY_COLUMNS: readonly Column<LibraryFile>[] = [
  {
    key: "filename",
    label: "Filename",
    width: 330,
    render: (row) => baseName(row.filename),
    sortValue: (row) => baseName(row.filename).toLowerCase(),
  },
  {
    key: "filesize",
    label: "Filesize",
    width: 76,
    align: "right",
    render: (row) => formatCount(row.filesize),
    sortValue: (row) => row.filesize,
  },
  {
    key: "bitrate",
    label: "Bitrate",
    width: 50,
    align: "center",
    render: (row) => row.bitrate,
  },
  {
    key: "frequency",
    label: "Frequency",
    width: 66,
    align: "center",
    render: (row) => row.frequency,
  },
  {
    key: "length",
    label: "Length",
    width: 50,
    align: "center",
    render: (row) => (row.length > 0 ? formatLength(row.length) : "0:00"),
  },
];

function CdButton({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="napster-cd"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <span className="napster-cd-disc" aria-hidden />
      <span className="napster-cd-glyph" aria-hidden>
        {glyph}
      </span>
    </button>
  );
}

export function LibraryPane({
  state,
  vm,
}: {
  state: NapsterState;
  vm: Pick<NapsterViewModel, "play" | "transport">;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [playlist, setPlaylist] = useState<string[]>([]);
  const [playlistPick, setPlaylistPick] = useState<number>();
  const files = (ids: readonly string[]) =>
    ids.flatMap((id) => state.library.filter((file) => file.id === id));
  const chosen = files(selected);
  return (
    <div className="napster-pane napster-library">
      <NapsterTable
        label="Library"
        columns={LIBRARY_COLUMNS}
        rows={state.library}
        rowKey={(row) => row.id}
        selected={selected}
        onSelect={setSelected}
        onOpen={(row) => vm.play([row])}
      />
      <div className="napster-library-controls">
        <fieldset className="napster-group">
          <legend>Internal Audio Controls</legend>
          <div className="napster-cds">
            <CdButton
              label="Previous"
              glyph="◀◀"
              onClick={() => vm.transport("previous")}
            />
            <CdButton
              label="Stop"
              glyph="■"
              onClick={() => vm.transport("stop")}
            />
            <CdButton
              label="Play"
              glyph="▶"
              onClick={() =>
                vm.play(chosen.length > 0 ? chosen : files(playlist))
              }
            />
            <CdButton
              label="Next"
              glyph="▶▶"
              onClick={() => vm.transport("next")}
            />
          </div>
        </fieldset>
        <fieldset className="napster-group napster-playlist">
          <legend>Playlist Control Panel</legend>
          <div className="napster-playlist-buttons">
            <button
              type="button"
              onClick={() =>
                setPlaylist((current) => [...current, ...selected])
              }
              disabled={selected.length === 0}
            >
              Add
            </button>
            <button
              type="button"
              disabled={playlistPick === undefined}
              onClick={() => {
                setPlaylist((current) =>
                  current.filter((_, index) => index !== playlistPick),
                );
                setPlaylistPick(undefined);
              }}
            >
              Delete
            </button>
            <button type="button" disabled>
              Save
            </button>
            <button type="button" disabled>
              Load
            </button>
            <button type="button" onClick={() => setPlaylist([])}>
              Clear
            </button>
          </div>
          <ul className="napster-playlist-box" aria-label="Playlist">
            {files(playlist).map((file, index) => (
              <li
                key={`${file.id}-${index}`}
                aria-selected={playlistPick === index}
                className={playlistPick === index ? "selected" : undefined}
                onMouseDown={() => setPlaylistPick(index)}
              >
                {baseName(file.filename)}
              </li>
            ))}
          </ul>
          <div className="napster-playlist-buttons">
            <button
              type="button"
              disabled={playlist.length === 0}
              onClick={() =>
                vm.play(
                  [...files(playlist)].sort(
                    (a, b) =>
                      ((a.filesize * 7919) % 101) - ((b.filesize * 7919) % 101),
                  ),
                )
              }
            >
              Random Play
            </button>
            <button
              type="button"
              disabled={playlist.length === 0}
              onClick={() => vm.play(files(playlist))}
            >
              Continuous Play
            </button>
          </div>
        </fieldset>
      </div>
    </div>
  );
}

const HOTLIST_COLUMNS: readonly Column<SearchResult>[] = [
  {
    key: "filename",
    label: "Filename",
    width: 330,
    render: (row) => row.filename,
    sortValue: (row) => row.filename.toLowerCase(),
  },
  ...RESULT_COLUMNS.filter((column) =>
    ["filesize", "bitrate", "freq", "length"].includes(column.key),
  ),
];

export function HotListPane({ state, session }: PaneProps) {
  const [picked, setPicked] = useState<string>();
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState<string>();
  const browsing = state.browsing;
  const results = browsing?.results ?? [];
  const totalMegs =
    results.reduce((sum, row) => sum + row.filesize, 0) / 1_048_576;
  const pings = results.flatMap((row) =>
    row.ping === undefined ? [] : [row.ping],
  );
  const pingAverage =
    pings.length === 0
      ? ""
      : String(
          Math.round(pings.reduce((sum, ping) => sum + ping, 0) / pings.length),
        );
  const pick = (user: string) => {
    setPicked(user);
    setSelected([]);
    session.browse(user);
  };
  const list = (online: boolean) => (
    <ul className="napster-userlist" aria-label={online ? "Online" : "Offline"}>
      {state.hotList
        .filter((entry) => entry.online === online)
        .map((entry) => (
          <li
            key={entry.user}
            aria-selected={picked === entry.user}
            className={picked === entry.user ? "selected" : undefined}
            onMouseDown={() => pick(entry.user)}
          >
            {online ? <span className="napster-dot fast" aria-hidden /> : null}
            {entry.user}
          </li>
        ))}
    </ul>
  );
  return (
    <div className="napster-pane napster-hotlist">
      <div className="napster-hotlist-main">
        <div className="napster-hotlist-users">
          <div className="napster-mini-head">Online</div>
          {list(true)}
          <div className="napster-mini-head">Offline</div>
          {list(false)}
        </div>
        <NapsterTable
          label={browsing ? `${browsing.user}'s files` : "Shared files"}
          columns={HOTLIST_COLUMNS}
          rows={results}
          rowKey={(row) => row.id}
          selected={selected}
          onSelect={setSelected}
          onOpen={(row) => session.download([row])}
          marker={(row) => <SpeedDot speed={row.lineSpeed} />}
          empty={
            browsing && results.length === 0
              ? `${browsing.user} is not online.`
              : undefined
          }
        />
      </div>
      <div className="napster-hotlist-bar">
        {adding === undefined ? (
          <button type="button" onClick={() => setAdding("")}>
            Add User
          </button>
        ) : (
          <form
            className="napster-add-user"
            onSubmit={(event) => {
              event.preventDefault();
              const name = adding.trim();
              if (name.length > 0) session.addToHotList(name);
              setAdding(undefined);
            }}
          >
            <input
              type="text"
              aria-label="User to add"
              autoFocus
              value={adding}
              maxLength={24}
              onChange={(event) => setAdding(event.target.value)}
            />
            <button type="submit">OK</button>
          </form>
        )}
        <label>
          Number Shared: <output>{browsing ? results.length : ""}</output>
        </label>
        <label>
          Total Megs Shared:{" "}
          <output>{browsing ? formatCount(totalMegs) : ""}</output>
        </label>
        <label>
          Ping Time Average: <output>{pingAverage}</output>
        </label>
      </div>
      <div className="napster-hotlist-bar">
        <button
          type="button"
          disabled={picked === undefined}
          onClick={() => {
            if (picked === undefined) return;
            session.removeFromHotList(picked);
            setPicked(undefined);
          }}
        >
          Remove User
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => {
            session.download(
              results.filter((row) => selected.includes(row.id)),
            );
            setSelected([]);
          }}
        >
          Download Selected Song(s)
        </button>
        <button
          type="button"
          disabled={picked === undefined}
          onClick={() => picked !== undefined && pick(picked)}
        >
          Refresh Visible List
        </button>
      </div>
    </div>
  );
}

export function ChatPane({ state, session }: PaneProps) {
  const [draft, setDraft] = useState("");
  const [joining, setJoining] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const room = state.rooms.find((item) => item.name === state.activeRoom);
  const lines = room?.lines;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines]);
  const online = state.connection === "online";
  return (
    <div className="napster-pane napster-chat">
      <div className="napster-topic" role="heading" aria-level={2}>
        {room ? (
          <>
            <span className="napster-topic-name">{room.name}:</span>{" "}
            <span className="napster-topic-text">{room.topic}</span>
          </>
        ) : (
          <span className="napster-topic-text">
            {online ? "Join a channel to chat." : "Not connected."}
          </span>
        )}
      </div>
      <div className="napster-chat-main">
        <div
          className="napster-chat-log"
          ref={logRef}
          role="log"
          aria-label="Chat"
        >
          {room?.lines.map((line) =>
            line.kind === "system" ? (
              <div
                key={line.id}
                className={`napster-chat-system${line.text.includes("has left") ? " left" : ""}`}
              >
                * {line.text}
              </div>
            ) : (
              <div key={line.id} className="napster-chat-line">
                <span
                  className={line.own ? "napster-chat-me" : "napster-chat-user"}
                >
                  &lt;{line.user}&gt;
                </span>{" "}
                {line.text}
              </div>
            ),
          )}
        </div>
        <div className="napster-chat-side">
          <div
            className="napster-list napster-chat-users"
            role="grid"
            aria-label="Users in channel"
          >
            <div className="napster-list-head" role="row">
              <span
                className="napster-list-header"
                role="columnheader"
                style={{ width: 86 }}
              >
                User
              </span>
              <span
                className="napster-list-header"
                role="columnheader"
                style={{ width: 44 }}
              >
                Songs
              </span>
              <span
                className="napster-list-header"
                role="columnheader"
                style={{ width: 52 }}
              >
                Speed
              </span>
            </div>
            {room?.users.map((user) => {
              const facts = userFacts(user);
              const speedClassName =
                facts.speed === "56K" || facts.speed.startsWith("ISDN")
                  ? "medium"
                  : facts.speed === "33.6"
                    ? "slow"
                    : "fast";
              return (
                <div key={user} className="napster-list-row" role="row">
                  <span
                    className="napster-list-cell"
                    role="gridcell"
                    style={{ width: 86 }}
                  >
                    <span
                      className={`napster-dot ${speedClassName}`}
                      aria-hidden
                    />
                    {user}
                  </span>
                  <span
                    className="napster-list-cell"
                    role="gridcell"
                    style={{ width: 44, textAlign: "right" }}
                  >
                    {user === state.username
                      ? state.library.filter((file) => file.shared).length
                      : formatCount(facts.songs)}
                  </span>
                  <span
                    className="napster-list-cell"
                    role="gridcell"
                    style={{ width: 52 }}
                  >
                    {facts.speed}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="napster-chat-input-row">
        <form
          className="napster-chat-input"
          onSubmit={(event) => {
            event.preventDefault();
            session.say(draft);
            setDraft("");
          }}
        >
          <input
            type="text"
            aria-label="Message"
            value={draft}
            maxLength={300}
            disabled={!room}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
        <div className="napster-blackbox">
          {room ? `${room.users.length} users in channel.` : ""}
        </div>
      </div>
      <div className="napster-chat-bar">
        <div className="napster-channel-buttons">
          {state.rooms.map((item) => (
            <button
              type="button"
              key={item.name}
              className={item.name === state.activeRoom ? "active" : undefined}
              aria-pressed={item.name === state.activeRoom}
              onClick={() => session.setActiveRoom(item.name)}
            >
              {item.name.replace(/^#/, "")}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!online}
          onClick={() => setJoining(!joining)}
        >
          Join
        </button>
        <button
          type="button"
          disabled={!room}
          onClick={() => room && session.leaveRoom(room.name)}
        >
          Leave
        </button>
      </div>
      {joining ? (
        <div
          className="napster-join window"
          role="dialog"
          aria-label="Join Channel"
        >
          <div className="title-bar">
            <div className="title-bar-text">Channel List</div>
          </div>
          <div className="window-body">
            <ul className="napster-userlist">
              {CHAT_ROOMS.map((item) => (
                <li
                  key={item.name}
                  onDoubleClick={() => {
                    session.joinRoom(item.name);
                    setJoining(false);
                  }}
                >
                  <button
                    type="button"
                    className="napster-link"
                    onClick={() => {
                      session.joinRoom(item.name);
                      setJoining(false);
                    }}
                  >
                    {item.name}
                  </button>{" "}
                  <span className="napster-muted">{item.topic}</span>
                </li>
              ))}
            </ul>
            <div className="napster-bottom even">
              <button type="button" onClick={() => setJoining(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const NEWS = [
  "Napster v2.0 BETA 7 is here: faster searches, Hot List browsing, and fewer Transfer Errors (we think).",
  "Over 20 million users and counting. Tell your roommate to stop hogging the phone line.",
  "Court update: our lawyers say everything is fine. Probably.",
  "Tip: if a download says Remotely Queued, the other user is busy. Go make a sandwich.",
];

export function HomePane({ state }: { state: NapsterState }) {
  return (
    <div className="napster-pane napster-home">
      <div className="napster-home-logo">
        <NapsterLogo width={96} height={96} />
        <span className="napster-wordmark">napster</span>
      </div>
      <p className="napster-home-status" role="status">
        {state.connection === "online"
          ? "Connected to the Napster network."
          : state.connection === "connecting"
            ? "Connecting to the Napster network..."
            : state.connection === "shutdown"
              ? "Disconnected: the Napster network is not available due to a court order."
              : "Not connected. Choose File, Connect."}
      </p>
      <fieldset className="napster-group">
        <legend>Napster News</legend>
        <ul className="napster-news">
          {NEWS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}

/** Discover: "people who share X also share Y", made up from the catalogue around your downloads. */
export function DiscoverPane({ state }: { state: NapsterState }) {
  const seed = state.downloads.length;
  const picks = [0, 1, 2, 3, 4].map(
    (offset) => CATALOG[(seed * 7 + offset * 13) % CATALOG.length],
  );
  return (
    <div className="napster-pane napster-home">
      <fieldset className="napster-group">
        <legend>Discover</legend>
        <p>People who share songs like yours also share:</p>
        <ul className="napster-news">
          {picks.map((song) =>
            song ? (
              <li key={`${song.artist}-${song.title}`}>
                {song.artist} - {song.title}
              </li>
            ) : null,
          )}
        </ul>
      </fieldset>
    </div>
  );
}

const FAQ: readonly [string, string][] = [
  [
    "What does Remotely Queued mean?",
    "The other user has too many uploads running. You are in their queue. Forever, possibly.",
  ],
  [
    "Why do I get Transfer Error!?",
    "The other user hung up, went offline, or their mom picked up the phone.",
  ],
  ["Why is everything 128 kbps?", "Because it is 2000."],
  ["Is this legal?", "Due to a court order, we cannot answer that question."],
];

export function HelpPane() {
  return (
    <div className="napster-pane napster-home">
      <fieldset className="napster-group">
        <legend>Frequently Asked Questions</legend>
        <dl className="napster-faq">
          {FAQ.map(([question, answer]) => (
            <div key={question}>
              <dt>{question}</dt>
              <dd>{answer}</dd>
            </div>
          ))}
        </dl>
      </fieldset>
    </div>
  );
}
