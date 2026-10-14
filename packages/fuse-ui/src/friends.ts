import { createDialog, type DialogPart } from "./dialog.js";
import { el, partClass, type PartClasses } from "./dom.js";

/**
 * The friends dialog and the ADD FRIEND button that goes wherever other players are listed. The game owns the data
 * (a `FriendsPanelState` it renders on every change) and the actions; this owns the DOM. Everything a server or
 * another player supplied is written with textContent, never as markup. The dialog is rebuilt only when its state
 * changed, so a poll that brought nothing new moves no focus.
 */
export interface FriendsPanelCard {
  publicId: string;
  name: string;
  avatarId?: string;
}
export interface FriendsPanelFriend extends FriendsPanelCard {
  online: boolean;
  room?: { code: string; gameId: string };
}
export interface FriendsPanelInvite {
  id: string;
  from: FriendsPanelCard;
  code: string;
  gameId: string;
  at: number;
}
export type FriendsPanelRelation =
  "you" | "friend" | "incoming" | "outgoing" | "none";
export interface FriendsPanelView {
  me: FriendsPanelCard;
  friends: FriendsPanelFriend[];
  incoming: FriendsPanelCard[];
  outgoing: FriendsPanelCard[];
  invites: FriendsPanelInvite[];
}
export type FriendsNotifications = "unsupported" | "off" | "on" | "denied";
export interface FriendsPanelState {
  signedIn: boolean;
  view?: FriendsPanelView;
  loading: boolean;
  error?: string;
  /** The room this device is in, where friends can be invited; a friend already there gets no INVITE. */
  roomCode?: string;
  notifications: FriendsNotifications;
}
export interface FriendsPanelActions {
  add(publicId: string): void;
  remove(publicId: string): void;
  invite(publicIds: readonly string[]): void;
  join(code: string): void;
  dismiss(inviteId: string): void;
  notifications(enable: boolean): void;
  /** Called when the dialog opens, so the list is fresh. */
  refresh(): void;
  /** Offered when signed out; omit for a game without sign-in. */
  signIn?(): void;
}
export interface FriendsText {
  title: string;
  button: string;
  signedOut: string;
  signIn: string;
  empty: string;
  loading: string;
  online: string;
  offline: string;
  /** `{code}` is the room code. */
  inRoom: string;
  requests: string;
  sent: string;
  invites: string;
  /** `{name}` and `{code}`. */
  invited: string;
  inviteAll: string;
  notificationsOn: string;
  notificationsOff: string;
  notificationsDenied: string;
  add: string;
  accept: string;
  decline: string;
  cancel: string;
  friends: string;
  remove: string;
  invite: string;
  join: string;
  you: string;
}
export type FriendsPart =
  | "button"
  | "body"
  | "note"
  | "error"
  | "section"
  | "heading"
  | "list"
  | "row"
  | "info"
  | "name"
  | "status"
  | "actions"
  | "action"
  | "primary"
  | "friend"
  | "banner"
  | "bannerText";

const DEFAULT_TEXT: FriendsText = {
  title: "FRIENDS",
  button: "FRIENDS",
  signedOut:
    "Sign in to add friends, see who is online and invite them to your room.",
  signIn: "SIGN IN",
  empty:
    "No friends yet. Add players from the leaderboard, a match or the room you are in.",
  loading: "Loading…",
  online: "ONLINE",
  offline: "OFFLINE",
  inRoom: "IN ROOM {code}",
  requests: "REQUESTS",
  sent: "SENT",
  invites: "INVITES",
  invited: "{name} invited you to room {code}",
  inviteAll: "INVITE EVERYONE ONLINE",
  notificationsOn: "🔔 INVITE ALERTS ON",
  notificationsOff: "🔕 INVITE ALERTS OFF",
  notificationsDenied: "🔕 ALERTS BLOCKED BY BROWSER",
  add: "+ ADD FRIEND",
  accept: "ACCEPT",
  decline: "DECLINE",
  cancel: "CANCEL",
  friends: "✓ FRIENDS",
  remove: "REMOVE",
  invite: "INVITE",
  join: "JOIN",
  you: "YOU",
};
const FRIENDS_CLASSES: Record<FriendsPart, string> = {
  button: "fui-button",
  body: "fui-friends",
  note: "fui-friends-note",
  error: "fui-friends-error",
  section: "fui-friends-section",
  heading: "fui-friends-heading",
  list: "fui-friends-list",
  row: "fui-friends-row",
  info: "fui-friends-info",
  name: "fui-friends-name",
  status: "fui-friends-status",
  actions: "fui-friends-actions",
  action: "fui-button fui-friends-action",
  primary: "fui-button fui-button-primary fui-friends-action",
  friend: "fui-button fui-friends-add",
  banner: "fui-friends-banner",
  bannerText: "fui-friends-banner-text",
};

export interface FriendsPanelOptions {
  on: FriendsPanelActions;
  /** Draws a player's head for its avatar id. Omit for rows without heads. */
  avatar?: (id: string) => HTMLElement;
  text?: Partial<FriendsText>;
  classes?: PartClasses<FriendsPart>;
  dialogClasses?: PartClasses<DialogPart>;
  document?: Document;
}
export interface FriendsPanel {
  /** The header button: FRIENDS, with how many are online. */
  button: HTMLButtonElement;
  dialog: HTMLDialogElement;
  /** The newest invite, with JOIN, for the game to place where a player sees it. Hidden when there is none. */
  banner: HTMLElement;
  render(state: FriendsPanelState): void;
  /**
   * A button for another listed player: ADD FRIEND, ACCEPT, SENT or FRIENDS by their relation to this account,
   * kept current on every render for as long as it is on the page. Hidden for the account itself.
   */
  friendButton(publicId: string): HTMLButtonElement;
  open(): void;
}

export function createFriendsPanel(options: FriendsPanelOptions): FriendsPanel {
  const doc = options.document ?? document,
    on = options.on,
    text: FriendsText = { ...DEFAULT_TEXT, ...options.text };
  const c = (part: FriendsPart) =>
    partClass(FRIENDS_CLASSES, options.classes, part);
  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    content = "",
    className = "",
  ) => el(tag, content, className, doc);
  const action = (label: string, part: FriendsPart, run: () => void) => {
    const result = node("button", label, c(part));
    result.type = "button";
    result.onclick = run;
    return result;
  };
  const button = node("button", text.button, c("button"));
  button.type = "button";
  const shell = createDialog({
    title: text.title,
    ...(options.dialogClasses ? { classes: options.dialogClasses } : {}),
    document: doc,
  });
  const { dialog, body } = shell;
  body.classList.add(...c("body").split(" ").filter(Boolean));
  const banner = node("aside", "", c("banner"));
  banner.hidden = true;
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  let state: FriendsPanelState = {
    signedIn: false,
    loading: false,
    notifications: "unsupported",
  };
  let rendered = "";
  const relationOf = (publicId: string): FriendsPanelRelation => {
    const view = state.view;
    if (!view) return "none";
    if (view.me.publicId === publicId) return "you";
    if (view.friends.some((f) => f.publicId === publicId)) return "friend";
    if (view.incoming.some((f) => f.publicId === publicId)) return "incoming";
    if (view.outgoing.some((f) => f.publicId === publicId)) return "outgoing";
    return "none";
  };
  // Every ADD FRIEND button handed out, pruned once it has left the page (and had one render's time to be put on it).
  const handed: { button: HTMLButtonElement; publicId: string; at: number }[] =
    [];
  let renders = 0;
  const label = (relation: FriendsPanelRelation): string =>
    relation === "friend"
      ? text.friends
      : relation === "incoming"
        ? text.accept
        : relation === "outgoing"
          ? text.sent
          : text.add;
  const styleFriendButton = (entry: {
    button: HTMLButtonElement;
    publicId: string;
  }) => {
    const relation = relationOf(entry.publicId);
    const hidden = relation === "you";
    if (entry.button.hidden !== hidden) entry.button.hidden = hidden;
    const next = label(relation);
    if (entry.button.textContent !== next) entry.button.textContent = next;
    if (entry.button.dataset.relation !== relation)
      entry.button.dataset.relation = relation;
    const disabled = relation === "friend";
    if (entry.button.disabled !== disabled) entry.button.disabled = disabled;
  };
  const refreshHanded = () => {
    for (let i = handed.length - 1; i >= 0; i--) {
      const entry = handed[i]!;
      if (!entry.button.isConnected && entry.at < renders) handed.splice(i, 1);
      else styleFriendButton(entry);
    }
  };
  const open = () => {
    on.refresh();
    if (!dialog.open) dialog.showModal();
  };
  button.onclick = open;
  const head = (card: FriendsPanelCard): HTMLElement | undefined =>
    options.avatar && card.avatarId ? options.avatar(card.avatarId) : undefined;
  const row = (
    card: FriendsPanelCard,
    status: string,
    actions: readonly HTMLElement[],
  ): HTMLElement => {
    const entry = node("li", "", c("row")),
      info = node("div", "", c("info")),
      name = node("strong", card.name, c("name")),
      state = node("small", status, c("status")),
      buttons = node("span", "", c("actions"));
    info.append(name, state);
    buttons.append(...actions);
    const avatar = head(card);
    if (avatar) entry.append(avatar);
    entry.append(info, buttons);
    return entry;
  };
  const section = (heading: string, rows: readonly HTMLElement[]) => {
    const root = node("section", "", c("section")),
      list = node("ul", "", c("list"));
    if (heading) root.append(node("h3", heading, c("heading")));
    list.append(...rows);
    root.append(list);
    return root;
  };
  const renderBanner = () => {
    const invite = state.view?.invites.find(
      (candidate) => candidate.code !== state.roomCode,
    );
    if (!invite) {
      if (!banner.hidden) banner.hidden = true;
      banner.replaceChildren();
      return;
    }
    const key = `${invite.id}:${invite.at}`;
    if (banner.dataset.invite === key && !banner.hidden) return;
    banner.dataset.invite = key;
    banner.replaceChildren(
      node(
        "span",
        text.invited
          .replace("{name}", invite.from.name)
          .replace("{code}", invite.code),
        c("bannerText"),
      ),
      action(text.join, "primary", () => on.join(invite.code)),
      action("✕", "action", () => on.dismiss(invite.id)),
    );
    banner.hidden = false;
  };
  const renderBody = () => {
    const parts: Node[] = [];
    if (state.error) parts.push(node("p", state.error, c("error")));
    if (!state.signedIn) {
      parts.push(node("p", text.signedOut, c("note")));
      if (on.signIn)
        parts.push(action(text.signIn, "primary", () => on.signIn!()));
      body.replaceChildren(...parts);
      return;
    }
    const view = state.view;
    if (!view) {
      if (!state.error) parts.push(node("p", text.loading, c("note")));
      body.replaceChildren(...parts);
      return;
    }
    if (state.notifications !== "unsupported") {
      const enabled = state.notifications === "on";
      const toggle = action(
        state.notifications === "denied"
          ? text.notificationsDenied
          : enabled
            ? text.notificationsOn
            : text.notificationsOff,
        "action",
        () => on.notifications(!enabled),
      );
      toggle.disabled = state.notifications === "denied";
      toggle.setAttribute("aria-pressed", String(enabled));
      parts.push(toggle);
    }
    const invitable = view.friends.filter(
      (friend) => friend.online && friend.room?.code !== state.roomCode,
    );
    if (state.roomCode) {
      const all = action(text.inviteAll, "primary", () =>
        on.invite(invitable.map((friend) => friend.publicId)),
      );
      all.disabled = invitable.length === 0;
      parts.push(all);
    }
    if (view.invites.length)
      parts.push(
        section(
          text.invites,
          view.invites.map((invite) =>
            row(
              invite.from,
              text.invited
                .replace("{name}", "")
                .replace("{code}", invite.code)
                .trim(),
              [
                ...(invite.code === state.roomCode
                  ? []
                  : [action(text.join, "primary", () => on.join(invite.code))]),
                action("✕", "action", () => on.dismiss(invite.id)),
              ],
            ),
          ),
        ),
      );
    if (view.incoming.length)
      parts.push(
        section(
          text.requests,
          view.incoming.map((card) =>
            row(card, "", [
              action(text.accept, "primary", () => on.add(card.publicId)),
              action(text.decline, "action", () => on.remove(card.publicId)),
            ]),
          ),
        ),
      );
    if (view.friends.length)
      parts.push(
        section(
          "",
          view.friends.map((friend) => {
            const status = !friend.online
              ? text.offline
              : friend.room
                ? text.inRoom.replace("{code}", friend.room.code)
                : text.online;
            const actions: HTMLElement[] = [];
            if (
              friend.online &&
              friend.room &&
              friend.room.code !== state.roomCode
            )
              actions.push(
                action(text.join, "primary", () => on.join(friend.room!.code)),
              );
            if (state.roomCode && invitable.includes(friend))
              actions.push(
                action(text.invite, "primary", () =>
                  on.invite([friend.publicId]),
                ),
              );
            actions.push(
              action(text.remove, "action", () => on.remove(friend.publicId)),
            );
            const entry = row(friend, status, actions);
            entry.dataset.online = String(friend.online);
            return entry;
          }),
        ),
      );
    else parts.push(node("p", text.empty, c("note")));
    if (view.outgoing.length)
      parts.push(
        section(
          text.sent,
          view.outgoing.map((card) =>
            row(card, "", [
              action(text.cancel, "action", () => on.remove(card.publicId)),
            ]),
          ),
        ),
      );
    body.replaceChildren(...parts);
  };
  return {
    button,
    dialog,
    banner,
    open,
    render(next) {
      state = next;
      renders++;
      const online = next.view?.friends.filter((f) => f.online).length ?? 0,
        waiting =
          (next.view?.incoming.length ?? 0) + (next.view?.invites.length ?? 0);
      const caption = `${text.button}${online ? ` · ${online}` : ""}${waiting ? " ●" : ""}`;
      if (button.textContent !== caption) button.textContent = caption;
      button.dataset.online = String(online);
      button.dataset.waiting = String(waiting > 0);
      refreshHanded();
      renderBanner();
      // The dialog's body is rebuilt only for a change it would show.
      const key = JSON.stringify([
        next.signedIn,
        next.view,
        next.error,
        next.roomCode,
        next.notifications,
      ]);
      if (key === rendered) return;
      rendered = key;
      renderBody();
    },
    friendButton(publicId) {
      const result = node("button", "", c("friend"));
      result.type = "button";
      result.dataset.publicId = publicId;
      result.onclick = () => {
        if (!state.signedIn) {
          open();
          return;
        }
        const relation = relationOf(publicId);
        if (relation === "outgoing") on.remove(publicId);
        else if (relation === "none" || relation === "incoming")
          on.add(publicId);
      };
      const entry = { button: result, publicId, at: renders };
      handed.push(entry);
      styleFriendButton(entry);
      return result;
    },
  };
}
