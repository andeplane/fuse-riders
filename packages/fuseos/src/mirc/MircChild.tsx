import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { ContextMenu } from "../windows/ContextMenu";
import type { MenuPosition } from "../windows/menuPosition";

import { ircLower } from "./irc/casemap";
import type { IrcClient } from "./irc/client";
import { formattingKey } from "./irc/format";
import type { ChatWindow, SessionState } from "./irc/session";
import { displayPrefix } from "./irc/session";
import type { MircIconName } from "./mircIcons";
import { MircIcon } from "./mircIcons";
import { ChatLineView } from "./MircText";
import type { ChildRect } from "./useMircViewModel";

export const CHILD_ICONS: Record<ChatWindow["kind"], MircIconName> = {
  status: "status",
  channel: "channel",
  query: "query",
  list: "list",
};

const MIN_WIDTH = 200;
const MIN_HEIGHT = 120;

type Drag = {
  mode: "move" | "size";
  startX: number;
  startY: number;
  rect: ChildRect;
};

export type MircChildProps = {
  window: ChatWindow;
  title: string;
  active: boolean;
  maximized: boolean;
  rect: ChildRect;
  zIndex: number;
  onActivate: () => void;
  onMove: (rect: ChildRect) => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  children: ReactNode;
};

/** An MDI child window inside the mIRC frame: its own caption and buttons, dragged and sized within the workspace. */
export function MircChild(props: MircChildProps) {
  const { window, rect, maximized } = props;
  const drag = useRef<Drag | null>(null);

  const start =
    (mode: Drag["mode"]) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (maximized || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button"))
        return;
      props.onActivate();
      drag.current = {
        mode,
        startX: event.clientX,
        startY: event.clientY,
        rect,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    props.onMove(
      current.mode === "move"
        ? {
            ...current.rect,
            x: current.rect.x + dx,
            y: Math.max(0, current.rect.y + dy),
          }
        : {
            ...current.rect,
            width: Math.max(MIN_WIDTH, current.rect.width + dx),
            height: Math.max(MIN_HEIGHT, current.rect.height + dy),
          },
    );
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <section
      className={`window mirc-child${maximized ? " mirc-child--max" : ""}`}
      aria-label={window.name}
      data-window-id={window.id}
      data-active={props.active ? "true" : "false"}
      style={
        maximized
          ? { zIndex: props.zIndex }
          : {
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              zIndex: props.zIndex,
            }
      }
      onMouseDown={props.onActivate}
    >
      {maximized ? null : (
        <div
          className={`title-bar${props.active ? "" : " inactive"}`}
          onPointerDown={start("move")}
          onPointerMove={move}
          onPointerUp={end}
          onDoubleClick={props.onToggleMaximize}
        >
          <div className="title-bar-text mirc-child-title">
            <MircIcon name={CHILD_ICONS[window.kind]} />
            <span>{props.title}</span>
          </div>
          <div className="title-bar-controls">
            <button
              type="button"
              aria-label="Minimize"
              onClick={props.onMinimize}
            />
            <button
              type="button"
              aria-label="Maximize"
              onClick={props.onToggleMaximize}
            />
            <button type="button" aria-label="Close" onClick={props.onClose} />
          </div>
        </div>
      )}
      <div className="mirc-child-body">{props.children}</div>
      {maximized ? null : (
        <div
          className="mirc-grip"
          aria-hidden
          onPointerDown={start("size")}
          onPointerMove={move}
          onPointerUp={end}
        />
      )}
    </section>
  );
}

type NickMenu = { nick: string; position: MenuPosition };

/** Tab completion: the first nick in the channel starting with the word before the caret. */
export function completeNick(value: string, nicks: readonly string[]): string {
  const match = /(\S+)$/.exec(value);
  if (!match?.[1]) return value;
  const word = ircLower(match[1]);
  const found = nicks.find((nick) => ircLower(nick).startsWith(word));
  if (!found) return value;
  const head = value.slice(0, value.length - match[1].length);
  return `${head}${found}${head.length === 0 ? ": " : " "}`;
}

/** The Status, channel and query body: text buffer, nicklist (channels) and the editbox. */
export function ChatView({
  window,
  client,
  timestamps,
  active,
}: {
  window: ChatWindow;
  client: IrcClient;
  timestamps: boolean;
  active: boolean;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<NickMenu | null>(null);
  const lastLine = window.lines[window.lines.length - 1]?.id;

  useLayoutEffect(() => {
    const element = textRef.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [lastLine, timestamps]);

  useLayoutEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true });
  }, [active]);

  const submit = () => {
    const text = draft;
    if (text.trim().length === 0) return;
    history.current = [
      text,
      ...history.current.filter((entry) => entry !== text),
    ].slice(0, 50);
    historyIndex.current = -1;
    setDraft("");
    stick.current = true;
    client.submit(window.id, text);
  };

  const nickAction = (nick: string, command: string) =>
    client.submit(window.id, `${command} ${nick}`);

  return (
    <div className="mirc-chat">
      <div className="mirc-chat-main">
        <div
          ref={textRef}
          className="mirc-text"
          role="log"
          aria-label={`${window.name} messages`}
          onScroll={(event) => {
            const element = event.currentTarget;
            stick.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              4;
          }}
        >
          {window.lines.map((entry) => (
            <ChatLineView key={entry.id} line={entry} timestamps={timestamps} />
          ))}
        </div>
        {window.kind === "channel" ? (
          <ul className="mirc-nicklist" role="listbox" aria-label="Nicklist">
            {window.members.map((member) => (
              <li
                key={member.nick}
                role="option"
                aria-selected={selected === member.nick}
                onMouseDown={() => setSelected(member.nick)}
                onDoubleClick={() => client.openQuery(member.nick)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelected(member.nick);
                  setMenu({
                    nick: member.nick,
                    position: { x: event.clientX, y: event.clientY },
                  });
                }}
              >
                {displayPrefix(member)}
                {member.nick}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <input
        type="text"
        ref={inputRef}
        className="mirc-editbox"
        aria-label={`Message ${window.name}`}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
            return;
          }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const next =
              historyIndex.current + (event.key === "ArrowUp" ? 1 : -1);
            if (next < -1 || next >= history.current.length) return;
            historyIndex.current = next;
            setDraft(next === -1 ? "" : (history.current[next] ?? ""));
            return;
          }
          if (event.key === "Tab" && window.kind === "channel") {
            event.preventDefault();
            setDraft(
              completeNick(
                draft,
                window.members.map((m) => m.nick),
              ),
            );
            return;
          }
          const code =
            event.ctrlKey && !event.altKey && !event.metaKey
              ? formattingKey(event.key)
              : undefined;
          if (code) {
            event.preventDefault();
            const input = event.currentTarget;
            const at = input.selectionStart ?? draft.length;
            const end = input.selectionEnd ?? at;
            setDraft(draft.slice(0, at) + code + draft.slice(end));
          }
        }}
      />
      {menu ? (
        <ContextMenu
          label="Nicklist menu"
          position={menu.position}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Query",
              bold: true,
              onSelect: () => client.openQuery(menu.nick),
            },
            { label: "Whois", onSelect: () => nickAction(menu.nick, "/whois") },
            { separator: true },
            { label: "Op", onSelect: () => nickAction(menu.nick, "/op") },
            { label: "Deop", onSelect: () => nickAction(menu.nick, "/deop") },
            { label: "Voice", onSelect: () => nickAction(menu.nick, "/voice") },
            {
              label: "Devoice",
              onSelect: () => nickAction(menu.nick, "/devoice"),
            },
            { label: "Kick", onSelect: () => nickAction(menu.nick, "/kick") },
          ]}
        />
      ) : null}
    </div>
  );
}

/** The Channels List window: one channel per line; double-click joins. */
export function ListView({
  state,
  client,
}: {
  state: SessionState;
  client: IrcClient;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const width =
    Math.max(10, ...state.list.entries.map((entry) => entry.channel.length)) +
    1;
  return (
    <div className="mirc-chat">
      <ul className="mirc-text mirc-list" role="listbox" aria-label="Channels">
        {state.list.entries.map((entry, index) => (
          <li
            key={`${index}:${entry.channel}`}
            role="option"
            aria-selected={selected === entry.channel}
            title="Double-click to join"
            onMouseDown={() => setSelected(entry.channel)}
            onDoubleClick={() => client.join(entry.channel)}
          >
            {entry.channel.padEnd(width, " ")}
            {String(entry.users).padStart(4, " ")}
            {"  "}
            {entry.topic}
          </li>
        ))}
        {state.list.complete ? null : (
          <li className="mirc-list-wait">Retrieving channels...</li>
        )}
      </ul>
    </div>
  );
}
