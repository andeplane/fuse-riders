import type { FormEvent, ReactNode } from "react";
import { useState } from "react";

import type { IrcNetwork } from "./irc/networks";
import { NETWORKS } from "./irc/networks";
import { MircLogo } from "./mircIcons";
import type { MircPrefs } from "./mircPrefs";
import { isValidNick } from "./mircPrefs";

function Dialog({
  title,
  label,
  width,
  onClose,
  children,
}: {
  title: string;
  label?: string;
  width: number;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mirc-modal">
      <div
        className="window mirc-dialog"
        role="dialog"
        aria-label={label ?? title}
        style={{ width }}
      >
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div className="window-body">{children}</div>
      </div>
    </div>
  );
}

/** A message from mIRC itself ("not available in this edition", the register joke). */
export function NoteDialog({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} width={340} onClose={onClose}>
      <p className="mirc-note">{text}</p>
      <div className="mirc-buttons">
        <button type="button" onClick={onClose} autoFocus>
          OK
        </button>
      </div>
    </Dialog>
  );
}

/** mIRC's single-line input box: Join channel, Query user, Change nick. */
export function PromptDialog({
  title,
  label,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim().length === 0) return;
    onClose();
    onSubmit(value.trim());
  };
  return (
    <Dialog title={title} width={300} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="mirc-field-label" htmlFor="mirc-prompt">
          {label}
        </label>
        <input
          type="text"
          id="mirc-prompt"
          className="mirc-wide"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <div className="mirc-buttons">
          <button type="submit">OK</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * "About mIRC", shown at every start like the shareware original, with its day counter. The wording is
 * generic: no author, no photo, no logo, and it says plainly that this is a FuseOS tribute.
 */
export function AboutDialog({
  days,
  onClose,
  onNote,
}: {
  days: number;
  onClose: () => void;
  onNote: (title: string, text: string) => void;
}) {
  const expired = days > 30;
  return (
    <Dialog title="About mIRC" width={380} onClose={onClose}>
      <div className="mirc-about">
        <MircLogo width={48} height={48} />
        <div>
          <p>
            <b>mIRC</b> v6.03 32bit - FuseOS edition
          </p>
          <p>An Internet Relay Chat client</p>
          <p className="mirc-muted">
            A tribute for FuseOS; not affiliated with mIRC Co. Ltd.
          </p>
        </div>
      </div>
      <fieldset>
        <legend>Licensed to:</legend>
        <div className="mirc-licence">Unlicensed Copy</div>
      </fieldset>
      <p className="mirc-nag" data-testid="mirc-nag">
        mIRC is shareware.{" "}
        {expired ? "Your 30 day evaluation period is over! " : ""}You have been
        using it for <b>{days}</b> day{days === 1 ? "" : "s"}. If you like it,
        please register. Thanks :)
      </p>
      <div className="mirc-buttons">
        <button
          type="button"
          onClick={() =>
            onNote(
              "Introduction",
              "IRC is a worldwide network of chat servers. Connect to a network, join a channel like #fuseos-test, and talk. Type /help for the commands.",
            )
          }
        >
          Introduction
        </button>
        <button
          type="button"
          onClick={() =>
            onNote(
              "How to register",
              "Print the order form, put a cheque in an envelope and wait six to eight weeks... Just kidding: this FuseOS edition is free. Nothing to buy, ever.",
            )
          }
        >
          How to register
        </button>
        <button type="button" onClick={onClose} autoFocus>
          Continue
        </button>
      </div>
    </Dialog>
  );
}

const CATEGORIES: readonly {
  name: string;
  depth: number;
  page?: "connect" | "options" | "display";
}[] = [
  { name: "Connect", depth: 0, page: "connect" },
  { name: "Options", depth: 1, page: "options" },
  { name: "Local Info", depth: 1 },
  { name: "Identd", depth: 1 },
  { name: "Firewall", depth: 1 },
  { name: "IRC", depth: 0 },
  { name: "Sounds", depth: 0 },
  { name: "Mouse", depth: 0 },
  { name: "DCC", depth: 0 },
  { name: "Display", depth: 0, page: "display" },
  { name: "General", depth: 0 },
];

const UNAVAILABLE: Record<string, string> = {
  "Local Info":
    "A web page has no local host name or IP address to report: the server sees the WebSocket gateway's address instead.",
  Identd:
    "Identd answers the server on TCP port 113, and a web page cannot listen on a port.",
  Firewall:
    "The browser makes the connection, so its own proxy settings apply.",
  DCC: "DCC sends files and chats straight between two computers, which a web page cannot do.",
};

/** File > Options: the 6.0x "mIRC Options" dialog with the server list on its Connect page. */
export function OptionsDialog({
  prefs,
  onSave,
  onConnect,
  onClose,
}: {
  prefs: MircPrefs;
  onSave: (prefs: MircPrefs) => void;
  onConnect: (network: IrcNetwork) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(prefs);
  const [category, setCategory] = useState("Connect");
  const network =
    NETWORKS.find((entry) => entry.id === draft.networkId) ?? NETWORKS[0];
  const nickOk = isValidNick(draft.nick);
  const altOk = draft.altNick === "" || isValidNick(draft.altNick);
  const valid = nickOk && altOk;
  const page = CATEGORIES.find((entry) => entry.name === category)?.page;
  const reachable = NETWORKS.filter((entry) => entry.servers[0]?.websocket).map(
    (entry) => entry.name,
  );
  const field = (
    key: "realName" | "email" | "nick" | "altNick",
    label: string,
    ok = true,
  ) => (
    <div className="mirc-form-row">
      <label htmlFor={`mirc-${key}`}>{label}</label>
      <input
        type="text"
        id={`mirc-${key}`}
        value={draft[key]}
        aria-invalid={!ok}
        maxLength={key === "nick" || key === "altNick" ? 30 : 100}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
      />
    </div>
  );

  return (
    <Dialog title="mIRC Options" width={460} onClose={onClose}>
      <div className="mirc-options">
        <div>
          <div className="mirc-field-label">Category:</div>
          <ul className="mirc-tree" role="tree" aria-label="Category">
            {CATEGORIES.map((entry) => (
              <li
                key={entry.name}
                role="treeitem"
                aria-selected={category === entry.name}
                style={{ paddingLeft: 4 + entry.depth * 14 }}
                onClick={() => setCategory(entry.name)}
              >
                {entry.depth === 0 ? (
                  <span className="mirc-tree-box">
                    {entry.name === "Connect" ? "−" : "+"}
                  </span>
                ) : null}
                {entry.name}
              </li>
            ))}
          </ul>
        </div>
        <div className="mirc-page">
          {page === "connect" ? (
            <>
              <div className="mirc-servers">
                <div className="mirc-servers-left">
                  <label className="mirc-field-label" htmlFor="mirc-network">
                    IRC Servers:
                  </label>
                  <select
                    id="mirc-network"
                    value={draft.networkId}
                    onChange={(event) =>
                      setDraft({ ...draft, networkId: event.target.value })
                    }
                  >
                    {NETWORKS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="IRC Server"
                    className="mirc-wide"
                    value={network?.servers[0]?.host}
                    disabled
                  >
                    {network?.servers.map((server) => (
                      <option key={server.host} value={server.host}>
                        {network.name}: {server.host}
                      </option>
                    ))}
                  </select>
                  <div className="mirc-muted mirc-hint">
                    Reachable from a browser: {reachable.join(", ")}
                  </div>
                </div>
                <div className="mirc-servers-buttons">
                  <button type="button" disabled>
                    Add
                  </button>
                  <button type="button" disabled>
                    Edit
                  </button>
                  <button type="button" disabled>
                    Delete
                  </button>
                  <button type="button" disabled>
                    Sort
                  </button>
                </div>
              </div>
              <div className="mirc-connect-row">
                <button
                  type="button"
                  disabled={!valid || !network}
                  onClick={() => {
                    if (!network) return;
                    onSave(draft);
                    onClose();
                    onConnect(network);
                  }}
                >
                  Connect to IRC Server
                </button>
              </div>
              {field("realName", "Full Name:")}
              {field("email", "E-Mail Address:")}
              {field("nick", "Nickname:", nickOk)}
              {field("altNick", "Alternative:", altOk)}
              <div className="field-row">
                <input
                  type="checkbox"
                  id="mirc-invisible"
                  checked={draft.invisible}
                  onChange={(event) =>
                    setDraft({ ...draft, invisible: event.target.checked })
                  }
                />
                <label htmlFor="mirc-invisible">Invisible mode</label>
              </div>
              {valid ? null : (
                <p className="mirc-error" role="alert">
                  A nickname starts with a letter and has no spaces (at most 30
                  characters).
                </p>
              )}
            </>
          ) : page === "options" ? (
            <>
              <fieldset>
                <legend>When connecting:</legend>
                <div className="field-row">
                  <input
                    type="checkbox"
                    id="mirc-retry"
                    checked
                    readOnly
                    disabled
                  />
                  <label htmlFor="mirc-retry">
                    Retry 5 time(s), waiting longer each time
                  </label>
                </div>
                <div className="field-row">
                  <input
                    type="checkbox"
                    id="mirc-folder"
                    checked={draft.folderOnConnect}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        folderOnConnect: event.target.checked,
                      })
                    }
                  />
                  <label htmlFor="mirc-folder">
                    Pop up Channels Folder on connect
                  </label>
                </div>
              </fieldset>
            </>
          ) : page === "display" ? (
            <div className="field-row">
              <input
                type="checkbox"
                id="mirc-timestamps"
                checked={draft.timestamps}
                onChange={(event) =>
                  setDraft({ ...draft, timestamps: event.target.checked })
                }
              />
              <label htmlFor="mirc-timestamps">Timestamp events [HH:nn]</label>
            </div>
          ) : (
            <p className="mirc-note">
              {UNAVAILABLE[category] ??
                "These settings are not available in the FuseOS edition."}
            </p>
          )}
        </div>
      </div>
      <div className="mirc-buttons">
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            onSave(draft);
            onClose();
          }}
        >
          OK
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/** mIRC 6's Channels Folder: favourite channels, joined with a double-click or the Join button. */
export function ChannelsFolderDialog({
  prefs,
  online,
  onSave,
  onJoin,
  onClose,
}: {
  prefs: MircPrefs;
  online: boolean;
  onSave: (prefs: MircPrefs) => void;
  onJoin: (channel: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(prefs.favorites[0] ?? "#fuseos-test");
  const channel =
    name.trim().startsWith("#") || name.trim().startsWith("&")
      ? name.trim()
      : `#${name.trim()}`;
  const validChannel = /^[#&][^\s,]{1,49}$/.test(channel);
  const join = (target: string) => {
    onClose();
    onJoin(target);
  };
  return (
    <Dialog title="mIRC Channels Folder" width={320} onClose={onClose}>
      <label className="mirc-field-label" htmlFor="mirc-folder-name">
        Enter name of channel to join:
      </label>
      <div className="mirc-folder">
        <div>
          <input
            type="text"
            id="mirc-folder-name"
            className="mirc-wide"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <ul
            className="mirc-folder-list"
            role="listbox"
            aria-label="Favourite channels"
          >
            {prefs.favorites.map((favorite) => (
              <li
                key={favorite}
                role="option"
                aria-selected={favorite === channel}
                onMouseDown={() => setName(favorite)}
                onDoubleClick={() => join(favorite)}
              >
                {favorite}
              </li>
            ))}
          </ul>
        </div>
        <div className="mirc-servers-buttons">
          <button
            type="button"
            disabled={!online || !validChannel}
            onClick={() => join(channel)}
          >
            Join
          </button>
          <button
            type="button"
            disabled={!validChannel || prefs.favorites.includes(channel)}
            onClick={() =>
              onSave({ ...prefs, favorites: [...prefs.favorites, channel] })
            }
          >
            Add
          </button>
          <button
            type="button"
            disabled={!prefs.favorites.includes(channel)}
            onClick={() =>
              onSave({
                ...prefs,
                favorites: prefs.favorites.filter((entry) => entry !== channel),
              })
            }
          >
            Delete
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="field-row">
        <input
          type="checkbox"
          id="mirc-folder-popup"
          checked={prefs.folderOnConnect}
          onChange={(event) =>
            onSave({ ...prefs, folderOnConnect: event.target.checked })
          }
        />
        <label htmlFor="mirc-folder-popup">Pop up folder on connect</label>
      </div>
    </Dialog>
  );
}
