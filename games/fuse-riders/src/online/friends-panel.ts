import {
  createFriendsPanel as createFriendsDialog,
  type FriendsPanelState,
} from "fuse-ui";
import type { AvatarId } from "../engine/avatar-id.js";
import { createAvatarPortrait } from "../client/avatar-heads.js";
import type { SafeStorage } from "../client/safe-storage.js";
import "./friends-panel.css";
import { identityToken, watchAccount, type Account } from "./account.js";
import {
  createFriendsClient,
  type FriendsClient,
  type FriendsRoom,
} from "./friends-client.js";
import {
  browserNotifications,
  createInviteNotifier,
  type NotificationApi,
} from "./friends-notify.js";

/**
 * Fuse Riders' friends panel: fuse-ui's dialog over the polling client, the account's sign-in state and invite
 * notifications. One per view (the landing page and a room each make their own, as they do the account panel);
 * `friendButton` is what every list of riders puts beside a name.
 */
export interface FriendsPanelAuth {
  watch: (listener: (account: Account | undefined) => void) => () => void;
  token: () => Promise<string | undefined>;
}
export interface FriendsPanelDependencies {
  fetch: typeof fetch;
  apiUrl: (path: string) => string;
  storage: SafeStorage;
  /** The name and head this device rides under right now. */
  identity: () => { name?: string; avatarId?: string };
  /** Open a room: in this document on the landing page, by navigation inside another room. */
  join: (code: string) => void;
  /** Opens the sign-in flow; omit where the page has no PLAYER button to hand off to. */
  signIn?: () => void;
  track: (event: string, props?: Record<string, unknown>) => void;
  /** Browser smoke tests inject an explicit identity surface, never real credentials. */
  auth?: FriendsPanelAuth;
  /** The page's Notification API; injected in tests. Default: the window's. */
  notifications?: NotificationApi | undefined;
  /** Whether nobody is looking at the page; default: hidden or unfocused. */
  unattended?: () => boolean;
  clock?: {
    now: () => number;
    schedule: (callback: () => void, delayMs: number) => () => void;
  };
  /** The poll interval; smokes shorten it. */
  pollMs?: number;
}
export interface FriendsPanelHandle {
  button: HTMLButtonElement;
  dialog: HTMLDialogElement;
  /** The newest invite with JOIN; put it where a player sees it. */
  banner: HTMLElement;
  /** ADD FRIEND for a listed player, kept current; hidden for this account. */
  friendButton: (publicId: string) => HTMLButtonElement;
  /** The room this device is in, for presence and invites; undefined once it left. */
  setRoom: (room: FriendsRoom | undefined) => void;
  /** The public id of a seat in this room, once the service has matched it to an account. */
  publicIdOfMember: (memberId: string) => string | undefined;
  open: () => void;
  refresh: () => void;
  client: FriendsClient;
  dispose: () => void;
}

export function createFriendsPanel(
  dependencies: FriendsPanelDependencies,
): FriendsPanelHandle {
  const auth: FriendsPanelAuth = dependencies.auth ?? {
    watch: watchAccount,
    token: identityToken,
  };
  const client = createFriendsClient({
    fetch: dependencies.fetch,
    token: auth.token,
    apiUrl: dependencies.apiUrl,
    identity: dependencies.identity,
    ...(dependencies.clock ? { clock: dependencies.clock } : {}),
    ...(dependencies.pollMs ? { pollMs: dependencies.pollMs } : {}),
  });
  const notifier = createInviteNotifier({
    notifications:
      "notifications" in dependencies
        ? dependencies.notifications
        : browserNotifications(window),
    storage: dependencies.storage,
    unattended:
      dependencies.unattended ??
      (() => document.hidden || !document.hasFocus()),
    focus: () => window.focus(),
    open: (invite) => {
      dependencies.track("Friend Invite Opened", { via: "notification" });
      dependencies.join(invite.code);
    },
    gameName: "Fuse Riders",
  });
  let signedIn = false;
  const panel = createFriendsDialog({
    avatar: (id) => createAvatarPortrait(id as AvatarId),
    on: {
      add: (publicId) => {
        dependencies.track("Friend Requested");
        void client.add(publicId).catch(() => undefined);
      },
      remove: (publicId) => void client.remove(publicId).catch(() => undefined),
      invite: (publicIds) => {
        dependencies.track("Friends Invited", { count: publicIds.length });
        void client.invite(publicIds).catch(() => undefined);
      },
      join: (code) => {
        dependencies.track("Friend Invite Opened", { via: "panel" });
        if (panel.dialog.open) panel.dialog.close();
        dependencies.join(code);
      },
      // The dialog closes first: the sign-in popup opens from the account button's own tap handling.
      dismiss: (id) => void client.dismissInvite(id).catch(() => undefined),
      notifications: (enable) => {
        if (enable)
          void notifier.enable().then((state) => {
            dependencies.track("Friend Alerts Toggled", { state });
            render();
          });
        else {
          notifier.disable();
          render();
        }
      },
      refresh: () => client.refresh(),
      ...(dependencies.signIn
        ? {
            signIn: () => {
              if (panel.dialog.open) panel.dialog.close();
              dependencies.signIn!();
            },
          }
        : {}),
    },
    classes: {
      button: "landing-account friends-button",
      action: "fui-button fui-friends-action friends-action",
      primary:
        "fui-button fui-button-primary fui-friends-action friends-action",
      friend: "fui-button fui-friends-add friend-add",
    },
    dialogClasses: {
      root: "fui-dialog game-dialog friends-dialog",
      bar: "fui-dialog-bar dialog-bar",
      title: "fui-dialog-title",
      actions: "fui-dialog-actions dialog-actions",
      close: "dialog-close",
      body: "fui-dialog-body dialog-body friends-panel",
    },
  });
  panel.button.title = "Friends: who is online, requests and invites";
  const render = () => {
    const { view, loading, error } = client.state();
    const state: FriendsPanelState = {
      signedIn,
      ...(view ? { view } : {}),
      loading,
      ...(error ? { error } : {}),
      ...(client.room() ? { roomCode: client.room()!.code } : {}),
      notifications: notifier.state(),
    };
    panel.render(state);
  };
  const stopWatching = client.watch(render);
  const stopInvites = client.onInvite((invite) => {
    dependencies.track("Friend Invite Received");
    notifier.notify(invite);
  });
  const stopAccount = auth.watch((account) => {
    signedIn = account !== undefined;
    client.setSignedIn(signedIn);
    render();
  });
  const refreshOnReturn = () => {
    if (!document.hidden) client.refresh();
  };
  window.addEventListener("focus", refreshOnReturn);
  document.addEventListener("visibilitychange", refreshOnReturn);
  const dispose = () => {
    window.removeEventListener("focus", refreshOnReturn);
    document.removeEventListener("visibilitychange", refreshOnReturn);
    stopWatching();
    stopInvites();
    stopAccount();
    client.dispose();
  };
  window.addEventListener(
    "pagehide",
    () => {
      client.leave();
      dispose();
    },
    { once: true },
  );
  render();
  return {
    button: panel.button,
    dialog: panel.dialog,
    banner: panel.banner,
    friendButton: panel.friendButton,
    setRoom: (room) => {
      client.setRoom(room);
      render();
    },
    publicIdOfMember: (memberId) =>
      client.state().view?.roomPlayers.find((p) => p.memberId === memberId)
        ?.publicId,
    open: panel.open,
    refresh: () => client.refresh(),
    client,
    dispose,
  };
}
