import test from "node:test";
import assert from "node:assert/strict";
import type { FriendInvite } from "fuse-platform/friends-api";
import { createMemoryStorage } from "../src/client/safe-storage.js";
import {
  browserNotifications,
  createInviteNotifier,
  type NotificationApi,
  type NotificationLike,
  type NotificationPermissionState,
} from "../src/online/friends-notify.js";

const invite: FriendInvite = {
  id: "i1",
  from: { publicId: "f", name: "Fay" },
  code: "AB12",
  gameId: "fuse-riders",
  at: 1,
};

/** A Notification API whose permission the test sets, recording what was shown. */
function fakeNotifications(initial: NotificationPermissionState) {
  const shown: {
    title: string;
    body: string;
    tag: string;
    note: NotificationLike & { closed: boolean };
  }[] = [];
  let permission = initial,
    asked = 0,
    answer: NotificationPermissionState = "granted",
    refuse = false;
  const api: NotificationApi = {
    get permission() {
      return permission;
    },
    async requestPermission() {
      asked++;
      permission = answer;
      return permission;
    },
    show(title, options) {
      if (refuse) throw new TypeError("Illegal constructor");
      const note = {
        onclick: null as (() => void) | null,
        closed: false,
        close() {
          note.closed = true;
        },
      };
      shown.push({ title, body: options.body, tag: options.tag, note });
      return note;
    },
  };
  return {
    api,
    shown,
    asked: () => asked,
    answer: (next: NotificationPermissionState) => {
      answer = next;
    },
    refuse: () => {
      refuse = true;
    },
  };
}

function notifier(
  api: NotificationApi | undefined,
  options: { unattended?: boolean } = {},
) {
  const storage = createMemoryStorage(),
    opened: string[] = [];
  let focused = 0,
    unattended = options.unattended ?? true;
  const result = createInviteNotifier({
    notifications: api,
    storage,
    unattended: () => unattended,
    focus: () => focused++,
    open: (i) => opened.push(i.code),
    gameName: "Fuse Riders",
  });
  return {
    notifier: result,
    storage,
    opened,
    focused: () => focused,
    attend: () => {
      unattended = false;
    },
  };
}

test("without the API there is nothing to turn on", async () => {
  const n = notifier(undefined);
  assert.equal(n.notifier.state(), "unsupported");
  assert.equal(await n.notifier.enable(), "unsupported");
  n.notifier.notify(invite);
  assert.deepEqual(n.opened, []);
});

test("enabling asks once, inside the tap, and remembers the choice on this browser", async () => {
  const fake = fakeNotifications("default");
  const n = notifier(fake.api);
  assert.equal(n.notifier.state(), "off");
  n.notifier.notify(invite);
  assert.equal(fake.shown.length, 0);
  assert.equal(await n.notifier.enable(), "on");
  assert.equal(fake.asked(), 1);
  assert.equal(n.storage.getItem("fuse-riders-friend-notifications"), "1");
  // Already granted: enabling again asks nothing.
  assert.equal(await n.notifier.enable(), "on");
  assert.equal(fake.asked(), 1);
  n.notifier.disable();
  assert.equal(n.notifier.state(), "off");
  assert.equal(await n.notifier.enable(), "on");
});

test("a refused permission is denied for good and never asked again", async () => {
  const fake = fakeNotifications("default");
  fake.answer("denied");
  const n = notifier(fake.api);
  assert.equal(await n.notifier.enable(), "denied");
  assert.equal(await n.notifier.enable(), "denied");
  assert.equal(fake.asked(), 1);
  n.notifier.notify(invite);
  assert.equal(fake.shown.length, 0);
});

test("a dismissed prompt leaves notifications off", async () => {
  const fake = fakeNotifications("default");
  fake.answer("default");
  const n = notifier(fake.api);
  assert.equal(await n.notifier.enable(), "off");
});

test("an invite is shown only to a player who is not looking, and its click opens the room", async () => {
  const fake = fakeNotifications("granted");
  const n = notifier(fake.api);
  n.notifier.notify(invite);
  assert.equal(fake.shown.length, 0, "off until enabled");
  await n.notifier.enable();
  n.notifier.notify(invite);
  assert.equal(fake.shown.length, 1);
  assert.equal(fake.shown[0]!.title, "Fay invited you to Fuse Riders");
  assert.match(fake.shown[0]!.body, /Room AB12/);
  assert.equal(fake.shown[0]!.tag, "fuse-invite-AB12");
  fake.shown[0]!.note.onclick!();
  assert.equal(fake.shown[0]!.note.closed, true);
  assert.equal(n.focused(), 1);
  assert.deepEqual(n.opened, ["AB12"]);
  n.attend();
  n.notifier.notify(invite);
  assert.equal(fake.shown.length, 1, "a visible page has the banner");
});

test("a browser that refuses to construct a notification is left alone", async () => {
  const fake = fakeNotifications("granted");
  fake.refuse();
  const n = notifier(fake.api);
  await n.notifier.enable();
  n.notifier.notify(invite);
  assert.equal(fake.shown.length, 0);
  assert.deepEqual(n.opened, []);
});

test("the browser adapter maps the window's Notification onto the injected shape", async () => {
  assert.equal(browserNotifications({}), undefined);
  const made: {
    title: string;
    options: NotificationOptions | undefined;
    onclick: unknown;
    closed: boolean;
  }[] = [];
  let permission = "default";
  class FakeNotification {
    static get permission() {
      return permission;
    }
    static async requestPermission() {
      permission = "granted";
      return permission;
    }
    onclick: unknown = null;
    constructor(
      public title: string,
      public options?: NotificationOptions,
    ) {
      made.push(this as unknown as (typeof made)[number]);
    }
    close() {
      (this as unknown as { closed: boolean }).closed = true;
    }
  }
  const api = browserNotifications({
    Notification: FakeNotification as unknown as NonNullable<
      Parameters<typeof browserNotifications>[0]["Notification"]
    >,
  })!;
  assert.equal(api.permission, "default");
  assert.equal(await api.requestPermission(), "granted");
  assert.equal(api.permission, "granted");
  const note = api.show("Hi", { body: "there", tag: "t" });
  note.onclick = () => {};
  note.close();
  assert.equal(made.length, 1);
  assert.equal(made[0]!.title, "Hi");
  assert.equal(typeof made[0]!.onclick, "function");
  assert.equal(made[0]!.closed, true);
  permission = "weird";
  assert.equal(api.permission, "default");
});
