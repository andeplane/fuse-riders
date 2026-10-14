import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFriendsPanel,
  type FriendsPanelActions,
  type FriendsPanelState,
  type FriendsPanelView,
} from "fuse-ui";
import { HOSTILE, page } from "./dom-fixture.js";

function modal(dialog: HTMLDialogElement) {
  Object.defineProperty(dialog, "open", {
    get: () => dialog.hasAttribute("open"),
  });
  Object.defineProperty(dialog, "showModal", {
    value: () => dialog.setAttribute("open", ""),
  });
  Object.defineProperty(dialog, "close", {
    value: () => dialog.removeAttribute("open"),
  });
}

function fixture() {
  const { document } = page();
  const calls: string[] = [];
  const on: FriendsPanelActions = {
    add: (id) => calls.push(`add:${id}`),
    remove: (id) => calls.push(`remove:${id}`),
    invite: (ids) => calls.push(`invite:${ids.join(",")}`),
    join: (code) => calls.push(`join:${code}`),
    dismiss: (id) => calls.push(`dismiss:${id}`),
    notifications: (enable) => calls.push(`notifications:${enable}`),
    refresh: () => calls.push("refresh"),
    signIn: () => calls.push("signIn"),
  };
  const heads: string[] = [];
  const panel = createFriendsPanel({
    on,
    document,
    avatar: (id) => {
      heads.push(id);
      const head = document.createElement("i");
      head.className = "head";
      head.dataset.avatar = id;
      return head;
    },
  });
  modal(panel.dialog);
  document.body.append(panel.button, panel.dialog, panel.banner);
  const texts = (selector: string) =>
    [...panel.dialog.querySelectorAll(selector)].map((n) =>
      n.textContent?.trim(),
    );
  const click = (label: string, within: ParentNode = panel.dialog) => {
    const target = [...within.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === label,
    );
    assert.ok(target, `no button ${label}`);
    target.click();
  };
  return { document, panel, calls, heads, texts, click };
}

const view = (extra: Partial<FriendsPanelView> = {}): FriendsPanelView => ({
  me: { publicId: "me000", name: "Me" },
  friends: [
    { publicId: "on111", name: "Onni", avatarId: "cat", online: true },
    {
      publicId: "rm222",
      name: HOSTILE,
      online: true,
      room: { code: "CD34", gameId: "fuse-riders" },
    },
    { publicId: "off33", name: "Ofelia", online: false },
  ],
  incoming: [{ publicId: "in444", name: "Ines" }],
  outgoing: [{ publicId: "out55", name: "Otto" }],
  invites: [],
  ...extra,
});
const state = (extra: Partial<FriendsPanelState> = {}): FriendsPanelState => ({
  signedIn: true,
  view: view(),
  loading: false,
  notifications: "off",
  ...extra,
});

test("signed out, the panel explains and offers sign-in; the button opens it and asks for a refresh", () => {
  const f = fixture();
  f.panel.render({
    signedIn: false,
    loading: false,
    notifications: "unsupported",
  });
  assert.equal(f.panel.button.textContent, "FRIENDS");
  f.panel.button.click();
  assert.deepEqual(f.calls, ["refresh"]);
  assert.equal(f.panel.dialog.open, true);
  assert.match(f.panel.dialog.textContent!, /Sign in to add friends/);
  f.click("SIGN IN");
  assert.deepEqual(f.calls, ["refresh", "signIn"]);
  // Loading and failure, before any view.
  f.panel.render({
    signedIn: true,
    loading: true,
    notifications: "unsupported",
  });
  assert.match(f.panel.dialog.textContent!, /Loading/);
  f.panel.render({
    signedIn: true,
    loading: false,
    error: "Friends unavailable (500)",
    notifications: "unsupported",
  });
  assert.match(f.panel.dialog.textContent!, /Friends unavailable \(500\)/);
  assert.doesNotMatch(f.panel.dialog.textContent!, /Loading/);
});

test("friends are listed online first with their room, then requests and sent ones, every name as text", () => {
  const f = fixture();
  f.panel.render(state());
  assert.equal(f.panel.button.textContent, "FRIENDS · 2 ●");
  assert.equal(f.panel.button.dataset.online, "2");
  assert.equal(f.panel.button.dataset.waiting, "true");
  assert.deepEqual(f.texts(".fui-friends-heading"), ["REQUESTS", "SENT"]);
  assert.deepEqual(f.texts(".fui-friends-name"), [
    "Ines",
    "Onni",
    HOSTILE,
    "Ofelia",
    "Otto",
  ]);
  assert.equal(
    f.panel.dialog.querySelector("img"),
    null,
    "hostile name is text",
  );
  assert.deepEqual(f.texts(".fui-friends-status"), [
    "",
    "ONLINE",
    "IN ROOM CD34",
    "OFFLINE",
    "",
  ]);
  assert.deepEqual(f.heads, ["cat"]);
  assert.deepEqual(
    [...f.panel.dialog.querySelectorAll(".fui-friends-row[data-online]")].map(
      (row) => (row as HTMLElement).dataset.online,
    ),
    ["true", "true", "false"],
  );
  // Out of a room: JOIN a friend's room, no INVITE anywhere, no INVITE EVERYONE.
  assert.deepEqual(f.texts(".fui-friends-action"), [
    "🔕 INVITE ALERTS OFF",
    "ACCEPT",
    "DECLINE",
    "REMOVE",
    "JOIN",
    "REMOVE",
    "REMOVE",
    "CANCEL",
  ]);
  f.click("ACCEPT");
  f.click("DECLINE");
  f.click("JOIN");
  f.click("CANCEL");
  f.click("🔕 INVITE ALERTS OFF");
  assert.deepEqual(f.calls, [
    "add:in444",
    "remove:in444",
    "join:CD34",
    "remove:out55",
    "notifications:true",
  ]);
});

test("in a room, online friends elsewhere get INVITE and INVITE EVERYONE ONLINE covers them", () => {
  const f = fixture();
  f.panel.render(state({ roomCode: "AB12", notifications: "on" }));
  assert.deepEqual(f.texts(".fui-friends-action").slice(0, 2), [
    "🔔 INVITE ALERTS ON",
    "INVITE EVERYONE ONLINE",
  ]);
  f.click("INVITE EVERYONE ONLINE");
  assert.deepEqual(f.calls, ["invite:on111,rm222"]);
  const invites = [...f.panel.dialog.querySelectorAll("button")].filter(
    (b) => b.textContent === "INVITE",
  );
  assert.equal(invites.length, 2);
  invites[1]!.click();
  assert.deepEqual(f.calls.at(-1), "invite:rm222");
  f.click("🔔 INVITE ALERTS ON");
  assert.deepEqual(f.calls.at(-1), "notifications:false");
  // A friend already in this room is not invited, and with nobody to invite the button is disabled.
  f.panel.render(
    state({
      roomCode: "CD34",
      view: view({
        friends: [
          {
            publicId: "rm222",
            name: "Ro",
            online: true,
            room: { code: "CD34", gameId: "fuse-riders" },
          },
          { publicId: "off33", name: "Ofelia", online: false },
        ],
      }),
    }),
  );
  const all = [...f.panel.dialog.querySelectorAll("button")].find(
    (b) => b.textContent === "INVITE EVERYONE ONLINE",
  )!;
  assert.equal(all.disabled, true);
  assert.deepEqual(
    f
      .texts(".fui-friends-action")
      .filter((t) => t === "INVITE" || t === "JOIN"),
    [],
  );
  // Denied notifications cannot be toggled.
  f.panel.render(state({ notifications: "denied" }));
  const denied = [...f.panel.dialog.querySelectorAll("button")].find(
    (b) => b.textContent === "🔕 ALERTS BLOCKED BY BROWSER",
  )!;
  assert.equal(denied.disabled, true);
});

test("an empty list says how to add friends", () => {
  const f = fixture();
  f.panel.render(
    state({ view: view({ friends: [], incoming: [], outgoing: [] }) }),
  );
  assert.match(f.panel.dialog.textContent!, /No friends yet/);
  assert.equal(f.panel.button.textContent, "FRIENDS");
});

test("invites show in the list and the newest in the banner, except for the room this device is in", () => {
  const f = fixture();
  const invites = [
    {
      id: "i2",
      from: { publicId: "on111", name: "Onni" },
      code: "EF56",
      gameId: "fuse-riders",
      at: 2,
    },
    {
      id: "i1",
      from: { publicId: "rm222", name: HOSTILE },
      code: "CD34",
      gameId: "fuse-riders",
      at: 1,
    },
  ];
  f.panel.render(state({ view: view({ invites }) }));
  assert.equal(f.panel.banner.hidden, false);
  assert.match(f.panel.banner.textContent!, /Onni invited you to room EF56/);
  assert.equal(f.panel.banner.querySelector("img"), null);
  f.click("JOIN", f.panel.banner);
  f.click("✕", f.panel.banner);
  assert.deepEqual(f.calls, ["join:EF56", "dismiss:i2"]);
  assert.deepEqual(f.texts(".fui-friends-heading")[0], "INVITES");
  assert.deepEqual(f.texts(".fui-friends-status").slice(0, 2), [
    "invited you to room EF56",
    "invited you to room CD34",
  ]);
  // In EF56 already: the banner shows the other invite, and that row has no JOIN.
  f.panel.render(state({ view: view({ invites }), roomCode: "EF56" }));
  assert.match(f.panel.banner.textContent!, /room CD34/);
  const rows = f.panel.dialog.querySelectorAll(
    ".fui-friends-section .fui-friends-row",
  );
  assert.equal(rows[0]!.querySelectorAll("button").length, 1);
  assert.equal(rows[1]!.querySelectorAll("button").length, 2);
  f.panel.render(
    state({ view: view({ invites: [invites[0]!] }), roomCode: "EF56" }),
  );
  assert.equal(f.panel.banner.hidden, true);
});

test("the dialog is rebuilt only for a change it would show", () => {
  const f = fixture();
  f.panel.render(state());
  const body = f.panel.dialog.querySelector(".fui-friends-row");
  f.panel.render(state({ loading: true }));
  assert.equal(f.panel.dialog.querySelector(".fui-friends-row"), body);
  f.panel.render(state({ error: "nope" }));
  assert.notEqual(f.panel.dialog.querySelector(".fui-friends-row"), body);
});

test("a friend button follows the player's relation and acts on it; the account's own is hidden", () => {
  const f = fixture();
  const buttons = {
    none: f.panel.friendButton("new66"),
    incoming: f.panel.friendButton("in444"),
    outgoing: f.panel.friendButton("out55"),
    friend: f.panel.friendButton("on111"),
    me: f.panel.friendButton("me000"),
  };
  for (const button of Object.values(buttons)) f.document.body.append(button);
  // Signed out: every button opens the panel instead.
  f.panel.render({ signedIn: false, loading: false, notifications: "off" });
  assert.equal(buttons.none.textContent, "+ ADD FRIEND");
  buttons.none.click();
  assert.deepEqual(f.calls, ["refresh"]);
  assert.equal(f.panel.dialog.open, true);
  f.calls.length = 0;
  f.panel.render(state());
  assert.deepEqual(
    Object.values(buttons).map((b) => [
      b.textContent,
      b.dataset.relation,
      b.hidden,
      b.disabled,
    ]),
    [
      ["+ ADD FRIEND", "none", false, false],
      ["ACCEPT", "incoming", false, false],
      ["SENT", "outgoing", false, false],
      ["✓ FRIENDS", "friend", false, true],
      ["+ ADD FRIEND", "you", true, false],
    ],
  );
  buttons.none.click();
  buttons.incoming.click();
  buttons.outgoing.click();
  buttons.friend.click();
  assert.deepEqual(f.calls, ["add:new66", "add:in444", "remove:out55"]);
  // A button that left the page is forgotten after the next render; one still on it keeps following.
  buttons.outgoing.remove();
  f.panel.render(
    state({
      view: view({
        outgoing: [],
        friends: [
          ...view().friends,
          { publicId: "out55", name: "Otto", online: false },
        ],
      }),
    }),
  );
  f.panel.render(
    state({
      view: view({
        outgoing: [],
        friends: [
          ...view().friends,
          { publicId: "out55", name: "Otto", online: false },
        ],
      }),
    }),
  );
  assert.equal(buttons.outgoing.textContent, "SENT", "no longer followed");
  f.panel.render(state({ view: view({ friends: [] }) }));
  assert.equal(buttons.friend.textContent, "+ ADD FRIEND");
});
