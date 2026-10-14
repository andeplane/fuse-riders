import type { FriendInvite } from "fuse-platform/friends-api";
import type { SafeStorage } from "../client/safe-storage.js";

/**
 * Invites as system notifications. The browser's Notification API is injected so the rule can be tested: permission
 * is asked only inside the tap that turns notifications on, never on load; a notification is shown only for a page
 * that is not being looked at, since the panel's own banner serves a visible one; and clicking it brings the page
 * forward and opens the room. Without a service worker a notification needs the page open somewhere: a closed tab
 * hears nothing, which is the honest limit of a game with no push service.
 */
export type NotificationPermissionState = "default" | "granted" | "denied";
export interface NotificationLike {
  onclick: (() => void) | null;
  close(): void;
}
export interface NotificationApi {
  permission: NotificationPermissionState;
  requestPermission(): Promise<NotificationPermissionState>;
  show(
    title: string,
    options: { body: string; tag: string; icon?: string },
  ): NotificationLike;
}
export interface InviteNotifierDependencies {
  /** undefined where the browser has no Notification API. */
  notifications: NotificationApi | undefined;
  storage: SafeStorage;
  /** Whether the page is hidden or unfocused: a notification is for a player who is not looking. */
  unattended: () => boolean;
  /** Bring the page forward, then open the room. */
  focus: () => void;
  open: (invite: FriendInvite) => void;
  gameName?: string;
}
export type InviteNotificationsState = "unsupported" | "off" | "on" | "denied";
export interface InviteNotifier {
  state(): InviteNotificationsState;
  /** From a tap: ask permission if needed, then remember the choice. Resolves with the resulting state. */
  enable(): Promise<InviteNotificationsState>;
  disable(): void;
  notify(invite: FriendInvite): void;
}

const ENABLED_KEY = "fuse-riders-friend-notifications";

/** The page's own Notification API, or undefined where there is none. */
export function browserNotifications(window: {
  Notification?: {
    permission: string;
    requestPermission(): Promise<string>;
    new (title: string, options?: NotificationOptions): Notification;
  };
}): NotificationApi | undefined {
  const Api = window.Notification;
  if (!Api) return undefined;
  const permission = (value: string): NotificationPermissionState =>
    value === "granted" || value === "denied" ? value : "default";
  return {
    get permission() {
      return permission(Api.permission);
    },
    requestPermission: async () => permission(await Api.requestPermission()),
    show: (title, options) => {
      const notification = new Api(title, options);
      return {
        set onclick(run: (() => void) | null) {
          notification.onclick = run;
        },
        close: () => notification.close(),
      };
    },
  };
}

export function createInviteNotifier(
  dependencies: InviteNotifierDependencies,
): InviteNotifier {
  const api = dependencies.notifications,
    storage = dependencies.storage;
  const state = (): InviteNotificationsState => {
    if (!api) return "unsupported";
    if (api.permission === "denied") return "denied";
    return api.permission === "granted" && storage.getItem(ENABLED_KEY) === "1"
      ? "on"
      : "off";
  };
  return {
    state,
    async enable() {
      if (!api || api.permission === "denied") return state();
      const permission =
        api.permission === "granted"
          ? "granted"
          : await api.requestPermission();
      if (permission === "granted") storage.setItem(ENABLED_KEY, "1");
      return state();
    },
    disable() {
      storage.removeItem(ENABLED_KEY);
    },
    notify(invite) {
      if (state() !== "on" || !dependencies.unattended()) return;
      let notification: NotificationLike;
      try {
        notification = api!.show(
          `${invite.from.name} invited you to ${dependencies.gameName ?? "a game"}`,
          {
            body: `Room ${invite.code} — click to join`,
            tag: `fuse-invite-${invite.code}`,
          },
        );
      } catch {
        // A browser that has the API but refuses a page notification (some mobile browsers) is left alone.
        return;
      }
      notification.onclick = () => {
        notification.close();
        dependencies.focus();
        dependencies.open(invite);
      };
    },
  };
}
