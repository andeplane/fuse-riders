import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ContextMenu } from "../windows/ContextMenu";

import type { HubConnection } from "./dcClient";
import { UserIcon } from "./DcppIcons";
import { formatBytes, formatTimestamp } from "./format";
import type { Column } from "./ListView";
import { ListView } from "./ListView";
import type { HubUser } from "./users";

const COLUMNS: readonly Column<HubUser>[] = [
  {
    key: "nick",
    label: "Nick",
    width: 140,
    render: (user) => (
      <span className="dc-iconcell">
        <UserIcon
          dcpp={user.tag.startsWith("<++")}
          op={user.op}
          passive={user.passive}
        />
        {user.nick}
      </span>
    ),
    sort: (user) => `${user.op ? 0 : 1}${user.nick.toLowerCase()}`,
  },
  {
    key: "shared",
    label: "Shared",
    width: 75,
    align: "right",
    render: (user) => formatBytes(user.shared),
    sort: (user) => user.shared,
  },
  {
    key: "description",
    label: "Description",
    width: 140,
    render: (user) => user.description,
    sort: (user) => user.description,
  },
  {
    key: "tag",
    label: "Tag",
    width: 190,
    render: (user) => user.tag,
    sort: (user) => user.tag,
  },
  {
    key: "connection",
    label: "Connection",
    width: 75,
    render: (user) => user.connection,
    sort: (user) => user.connection,
  },
  {
    key: "email",
    label: "E-Mail",
    width: 140,
    render: (user) => user.email,
    sort: (user) => user.email,
  },
];

/** One line of main chat: "[21:07] <nick> text", "* nick waves" or "*** Connected". */
function ChatRow({
  line,
  self,
}: {
  line: HubConnection["chat"][number];
  self: string;
}) {
  const stamp = formatTimestamp(line.time);
  if (line.kind === "status")
    return (
      <div className="dc-chat-status">
        {stamp} {line.text}
      </div>
    );
  if (line.kind === "me")
    return (
      <div>
        {stamp} * {line.nick} {line.text}
      </div>
    );
  return (
    <div className={line.nick === self ? "dc-chat-self" : undefined}>
      {stamp} &lt;{line.nick}&gt; {line.text}
    </div>
  );
}

/** A hub window: main chat on the left, the user list on the right, the message line and a status strip. */
export function HubFrame({
  connection,
  self,
  onSend,
  onFileList,
  onReconnect,
  onFollowRedirect,
}: {
  connection: HubConnection;
  self: string;
  onSend: (text: string) => void;
  onFileList: (nick: string) => void;
  onReconnect: () => void;
  onFollowRedirect: () => void;
}) {
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<{ user: HubUser; x: number; y: number }>();
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lines = connection.chat;

  // Keep the newest line in view, as the RichEdit did.
  useLayoutEffect(() => {
    const chat = chatRef.current;
    if (chat) chat.scrollTop = chat.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [connection.address]);

  const shared = connection.users.reduce((sum, user) => sum + user.shared, 0);
  const total =
    connection.status === "connected"
      ? Math.max(connection.hub.users, connection.users.length)
      : 0;
  const statusText =
    connection.status === "connecting"
      ? "Connecting..."
      : connection.status === "connected"
        ? "Connected"
        : connection.redirect
          ? `Redirect: ${connection.redirect}`
          : "Disconnected";

  return (
    <div className="dc-frame dc-hub">
      <div className="dc-hub-split">
        <div
          ref={chatRef}
          className="dc-chat"
          role="log"
          aria-label="Main chat"
        >
          {lines.map((line) => (
            <ChatRow key={line.id} line={line} self={self} />
          ))}
        </div>
        <ListView
          className="dc-userlist"
          label="Users"
          columns={COLUMNS}
          rows={connection.users}
          rowKey={(user) => user.nick}
          selected={selected}
          onSelect={setSelected}
          onOpen={(user) => {
            if (user.nick !== self && user.shared > 0) onFileList(user.nick);
          }}
          onContextMenu={(user, position) => setMenu({ user, ...position })}
        />
      </div>
      <form
        className="dc-message"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(message);
          setMessage("");
        }}
      >
        <input
          ref={inputRef}
          type="text"
          aria-label="Message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </form>
      <div className="dc-framestatus">
        <span className="dc-cell dc-grow">{statusText}</span>
        {connection.redirect ? (
          <button
            type="button"
            className="dc-cellbutton"
            onClick={onFollowRedirect}
          >
            Follow redirect
          </button>
        ) : null}
        {connection.status === "disconnected" ? (
          <button type="button" className="dc-cellbutton" onClick={onReconnect}>
            Reconnect
          </button>
        ) : null}
        <span className="dc-cell">{total} users</span>
        <span className="dc-cell">
          {formatBytes(connection.status === "connected" ? Math.max(shared, connection.hub.shared) : 0)}
        </span>
      </div>
      {menu ? (
        <ContextMenu
          label="User"
          position={{ x: menu.x, y: menu.y }}
          items={[
            {
              label: "Get file list",
              bold: true,
              disabled: menu.user.nick === self || menu.user.shared === 0,
              onSelect: () => onFileList(menu.user.nick),
            },
            { label: "Match queue", disabled: true },
            { label: "Send private message", disabled: true },
            { label: "Add to favorites", disabled: true },
            { separator: true },
            { label: "Grant extra slot", disabled: true },
            {
              label: "Copy nick to clipboard",
              disabled: true,
            },
          ]}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}
