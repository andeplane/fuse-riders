import { button, copyText, el, partClass, type PartClasses } from "./dom.js";

export type InvitePart =
  "root" | "qr" | "caption" | "code" | "link" | "url" | "copy";

const INVITE_CLASSES: Record<InvitePart, string> = {
  root: "fui-invite",
  qr: "fui-invite-qr",
  caption: "fui-invite-caption",
  code: "fui-room-code",
  link: "fui-invite-link",
  url: "fui-invite-url",
  copy: "fui-invite-copy",
};

export interface InviteOptions {
  code: string;
  /** The absolute link a phone opens to join. */
  link: string;
  /**
   * Turns the link into an image URL for the QR code, e.g. `QRCode.toDataURL` from the `qrcode` package. Omit it
   * and the card has no QR image; a rejection hides the image and leaves the code and link.
   */
  qr?: (link: string) => Promise<string>;
  /** Show the link and COPY LINK. Default true. */
  showLink?: boolean;
  caption?: string;
  /** Called with `true` when the link was copied. Defaults to the browser clipboard. */
  copy?: (text: string) => Promise<boolean>;
  /** How long COPIED / COPY FAILED stays before COPY LINK returns. */
  copyResetMs?: number;
  /** Timer for the COPIED reset; inject in tests. */
  setTimeout?: (run: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  classes?: PartClasses<InvitePart>;
  document?: Document;
}

export interface InviteCard {
  element: HTMLElement;
  qr: HTMLImageElement;
  copy: HTMLButtonElement;
  /** Settles once the QR image is set or hidden. */
  ready: Promise<void>;
}

/** The room invitation: QR code, SCAN TO JOIN, the room code, and the link with COPY LINK beside it. */
export function createInviteCard(options: InviteOptions): InviteCard {
  const doc = options.document ?? document;
  const c = (part: InvitePart) =>
    partClass(INVITE_CLASSES, options.classes, part);
  const element = el("div", "", c("root"), doc),
    qr = el("img", "", c("qr"), doc);
  qr.alt = "Scan to join this room";
  const link = el("div", "", c("link"), doc),
    url = el("span", options.link, c("url"), doc),
    copy = button("COPY LINK", c("copy"), doc);
  copy.title = "Copy the join link";
  link.append(url, copy);
  const later = options.setTimeout ?? ((run, ms) => setTimeout(run, ms));
  const cancel =
    options.clearTimeout ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let reset: unknown;
  copy.onclick = async () => {
    const copied = await (options.copy ?? copyText)(options.link);
    copy.textContent = copied ? "COPIED" : "COPY FAILED";
    copy.classList.toggle("copied", copied);
    if (reset !== undefined) cancel(reset);
    reset = later(() => {
      copy.textContent = "COPY LINK";
      copy.classList.remove("copied");
    }, options.copyResetMs ?? 1600);
  };
  element.append(
    qr,
    el("p", options.caption ?? "SCAN TO JOIN", c("caption"), doc),
    el("strong", options.code, c("code"), doc),
  );
  if (options.showLink ?? true) element.append(link);
  const ready = options.qr
    ? options.qr(options.link).then(
        (data) => {
          qr.src = data;
        },
        () => {
          qr.hidden = true;
        },
      )
    : Promise.resolve().then(() => {
        qr.hidden = true;
      });
  return { element, qr, copy, ready };
}

export type RosterPart =
  "root" | "title" | "empty" | "row" | "info" | "name" | "status" | "host";

const ROSTER_CLASSES: Record<RosterPart, string> = {
  root: "fui-roster",
  title: "fui-roster-title",
  empty: "fui-roster-empty",
  row: "fui-roster-row",
  info: "fui-roster-info",
  name: "fui-roster-name",
  status: "fui-roster-status",
  host: "fui-roster-host",
};

export interface RosterMember {
  id: string;
  name: string;
  /** A short state under the name, e.g. READY or OFFLINE. */
  status?: string;
  /** Sets `--rider-color` on the row. */
  color?: string;
  /** A key for `RosterOptions.avatar`; the avatar is rebuilt only when it changes. */
  avatar?: string;
  host?: boolean;
  ready?: boolean;
}

export interface RosterOptions {
  /** A heading inside the list, before the rows (e.g. WATCHING). Omit for none. */
  title?: string;
  /** Shown while nobody is seated. Omit for none. */
  emptyText?: string;
  /** Draws an avatar for a member's `avatar` key. Omit for rows without avatars. */
  avatar?: (key: string) => HTMLElement;
  hostText?: string;
  classes?: PartClasses<RosterPart>;
  document?: Document;
}

interface RosterRow {
  entry: HTMLElement;
  head: HTMLElement | undefined;
  avatar: string | undefined;
  name: HTMLElement;
  status: HTMLElement;
  host: HTMLElement;
  shown: string;
}

export interface Roster {
  element: HTMLElement;
  empty: HTMLElement | undefined;
  /** Diff the rows to `members`, in order of first appearance: rows stay put, so their handlers and focus do too. */
  update(members: readonly RosterMember[]): void;
  /** The row element for a member, to hang a game's own controls on. */
  row(id: string): HTMLElement | undefined;
  /** Every row, as `[id, row element]`, in insertion order. */
  entries(): IterableIterator<[string, HTMLElement]>;
}

/** The lobby's list of who is in the room: avatar, name, status and a HOST badge. */
export function createRoster(options: RosterOptions = {}): Roster {
  const doc = options.document ?? document;
  const c = (part: RosterPart) =>
    partClass(ROSTER_CLASSES, options.classes, part);
  const element = el("div", "", c("root"), doc);
  if (options.title) element.append(el("p", options.title, c("title"), doc));
  const empty = options.emptyText
    ? el("p", options.emptyText, c("empty"), doc)
    : undefined;
  if (empty) element.append(empty);
  const rows = new Map<string, RosterRow>();
  return {
    element,
    empty,
    row: (id) => rows.get(id)?.entry,
    *entries() {
      for (const [id, row] of rows) yield [id, row.entry];
    },
    update(members) {
      const present = new Set(members.map((member) => member.id));
      for (const [id, row] of rows)
        if (!present.has(id)) {
          row.entry.remove();
          rows.delete(id);
        }
      for (const member of members) {
        let row = rows.get(member.id);
        if (!row) {
          const entry = el("div", "", c("row"), doc),
            info = el("div", "", c("info"), doc),
            name = el("strong", "", c("name"), doc),
            status = el("small", "", c("status"), doc),
            host = el("span", options.hostText ?? "HOST", c("host"), doc);
          host.hidden = true;
          info.append(name, status);
          entry.append(info);
          row = {
            entry,
            head: undefined,
            avatar: undefined,
            name,
            status,
            host,
            shown: "",
          };
          rows.set(member.id, row);
          element.append(entry);
        }
        if (options.avatar && row.avatar !== member.avatar) {
          const head =
            member.avatar === undefined
              ? undefined
              : options.avatar(member.avatar);
          if (row.head && head) row.head.replaceWith(head);
          else if (head) row.entry.prepend(head);
          else row.head?.remove();
          row.head = head;
          row.avatar = member.avatar;
        }
        if (member.color !== undefined)
          row.entry.style.setProperty("--rider-color", member.color);
        if (row.shown !== member.name)
          row.name.textContent = row.shown = member.name;
        // A roster is diffed every frame; writing a value the DOM already holds still mutates it.
        const status = member.status ?? "";
        if (row.status.textContent !== status) row.status.textContent = status;
        if (member.host) {
          if (row.host.hidden) row.host.hidden = false;
          if (!row.host.parentElement) row.name.after(row.host);
        } else if (!row.host.hidden) row.host.hidden = true;
        const ready =
          member.ready === undefined ? undefined : String(member.ready);
        if (row.entry.dataset.ready !== ready) {
          if (ready === undefined) delete row.entry.dataset.ready;
          else row.entry.dataset.ready = ready;
        }
      }
      if (empty && empty.hidden !== rows.size > 0) empty.hidden = rows.size > 0;
    },
  };
}

export interface LobbyOptions {
  code: string;
  link: string;
  qr?: InviteOptions["qr"];
  /** Heading over the invitation. */
  title?: string;
  startText?: string;
  onStart(): void;
  roster?: Omit<RosterOptions, "document">;
  document?: Document;
}

export interface LobbyState {
  members: readonly RosterMember[];
  /** This device may start the game (the host, with enough players). START is disabled when false. */
  canStart: boolean;
  /** This device sees START at all (the host). Defaults to `canStart`, so a guest never sees it. */
  showStart?: boolean;
  /** One line under the roster, e.g. "Waiting for at least 2 players". */
  note?: string;
}

export interface Lobby {
  element: HTMLElement;
  invite: InviteCard;
  roster: Roster;
  start: HTMLButtonElement;
  note: HTMLElement;
  update(state: LobbyState): void;
}

/** A room's waiting screen: invitation (QR, code, link), roster, a note, and START for whoever may start. */
export function createLobby(options: LobbyOptions): Lobby {
  const doc = options.document ?? document;
  const element = el("section", "", "fui-lobby", doc);
  element.setAttribute("aria-label", `Room ${options.code}`);
  const invite = createInviteCard({
    code: options.code,
    link: options.link,
    ...(options.qr ? { qr: options.qr } : {}),
    document: doc,
  });
  const roster = createRoster({ ...options.roster, document: doc });
  const note = el("p", "", "fui-lobby-note", doc),
    start = el(
      "button",
      options.startText ?? "START",
      "fui-button fui-button-primary",
      doc,
    );
  start.type = "button";
  start.hidden = true;
  start.onclick = () => options.onStart();
  if (options.title)
    element.append(el("h2", options.title, "fui-lobby-title", doc));
  element.append(invite.element, roster.element, note, start);
  return {
    element,
    invite,
    roster,
    start,
    note,
    update(state) {
      roster.update(state.members);
      note.textContent = state.note ?? "";
      note.hidden = !state.note;
      start.hidden = !(state.showStart ?? state.canStart);
      start.disabled = !state.canStart;
    },
  };
}

export type LobbyShellPart = "root" | "intro" | "footer";

const LOBBY_SHELL_CLASSES: Record<LobbyShellPart, string> = {
  root: "fui-lobby",
  intro: "fui-lobby-intro",
  footer: "fui-lobby-footer",
};

export interface LobbyShellOptions {
  /** The game's pitch beside the invitation: a heading, how to play. Omit for no intro block. */
  intro?: readonly Node[];
  /** The invitation, e.g. `createInviteCard(...).element`. */
  invite?: HTMLElement;
  /** Who is in the room, e.g. `createRoster(...).element`. */
  roster?: HTMLElement;
  /** The line under everything: a count, the host's actions. Omit for no footer. */
  footer?: readonly Node[];
  label?: string;
  classes?: PartClasses<LobbyShellPart>;
  document?: Document;
}

export interface LobbyShell {
  element: HTMLElement;
  intro: HTMLElement | undefined;
  footer: HTMLElement | undefined;
}

/**
 * A room's waiting screen as a layout of the game's own parts: intro, invitation, roster and footer, in that order.
 * `createLobby` is the ready-made version; this one is for a game that owns its copy and actions.
 */
export function createLobbyShell(options: LobbyShellOptions): LobbyShell {
  const doc = options.document ?? document;
  const c = (part: LobbyShellPart) =>
    partClass(LOBBY_SHELL_CLASSES, options.classes, part);
  const element = el("section", "", c("root"), doc);
  if (options.label) element.setAttribute("aria-label", options.label);
  let intro: HTMLElement | undefined, footer: HTMLElement | undefined;
  if (options.intro) {
    intro = el("div", "", c("intro"), doc);
    intro.append(...options.intro);
    element.append(intro);
  }
  if (options.invite) element.append(options.invite);
  if (options.roster) element.append(options.roster);
  if (options.footer) {
    footer = el("footer", "", c("footer"), doc);
    footer.append(...options.footer);
    element.append(footer);
  }
  return { element, intro, footer };
}
