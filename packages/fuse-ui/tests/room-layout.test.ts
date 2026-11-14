import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRoomLayout,
  createRoster,
  roomLayoutMarkup,
  requestedRoomSlot,
} from "fuse-ui";
import { page } from "./dom-fixture.js";

test("Back is the room's first control, top left, and can reuse the game's leave handler", () => {
  const { document } = page(),
    root = document.createElement("section"),
    leave = document.createElement("button");
  document.body.append(root);
  leave.textContent = "Back";
  let left = 0;
  leave.onclick = () => left++;
  const layout = createRoomLayout({
    element: root,
    roster: createRoster({ document }),
    capacity: 2,
    mainMenuAction: leave,
  });
  const head = root.firstElementChild!;
  assert.equal(head.className, "fui-page-head fui-room-head");
  assert.equal(head.firstElementChild === leave, true);
  assert.equal(leave.classList.contains("fui-back"), true);
  leave.click();
  assert.equal(left, 1);
  const configure = root.querySelector<HTMLElement>(".fui-room-settings")!,
    column = configure.parentElement!;
  assert.equal(column.lastElementChild === configure, true);
  column.append(document.createElement("p"));
  layout.update(0);
  assert.equal(
    column.lastElementChild === configure,
    true,
    "Game settings closes the invitation's column whatever a game adds to it",
  );
  const other = document.createElement("section");
  document.body.append(other);
  createRoomLayout({
    element: other,
    roster: createRoster({ document }),
    capacity: 2,
    mainMenuHref: "/fuse-volley/?mute",
  });
  assert.equal(
    other
      .querySelector<HTMLAnchorElement>(".fui-room-main-menu")
      ?.getAttribute("href"),
    "/fuse-volley/?mute",
  );
});

test("the main room action stays above Game settings without changing its handler or disabled state", () => {
  const { document } = page(),
    root = document.createElement("section"),
    start = document.createElement("button");
  document.body.append(root);
  start.textContent = "Play";
  start.disabled = true;
  let starts = 0;
  start.onclick = () => starts++;
  createRoomLayout({
    element: root,
    roster: createRoster({ document }),
    capacity: 6,
    primaryAction: start,
    actions: [start],
  });
  const configure = root.querySelector(".fui-room-settings")!;
  assert.equal(configure.previousElementSibling, start.parentElement);
  assert.equal(start.parentElement?.className, "fui-room-primary-action");
  assert.ok(start.closest(".fui-room-invitation"));
  assert.equal(start.disabled, true);
  start.disabled = false;
  start.click();
  assert.equal(starts, 1);
  assert.ok(!root.querySelector(".fui-room-actions")!.contains(start));
});

test("HTML room markup puts its primary action before settings in the invitation column", () => {
  const { document } = page(),
    root = document.createElement("div");
  root.innerHTML = roomLayoutMarkup({
    invite: "<p>Scan to join</p>",
    primaryAction: "<button disabled data-start>Play</button>",
    players: "",
    join: "",
    settings: "",
    actions: "",
    occupied: 0,
    capacity: 6,
  });
  const primary = root.querySelector(".fui-room-primary-action")!;
  assert.equal(
    primary.nextElementSibling?.getAttribute("data-action"),
    "open-room-settings",
  );
  assert.equal(primary.parentElement?.className, "fui-room-invitation");
  assert.equal(
    root.querySelector<HTMLButtonElement>("[data-start]")?.disabled,
    true,
  );
});

test("switching teams moves the existing row to its new slot without losing its controls", () => {
  const { document } = page(),
    root = document.createElement("section"),
    roster = createRoster({ document });
  document.body.append(root);
  createRoomLayout({ element: root, roster, capacity: 2 });
  roster.update([{ id: "one", name: "Ada", slot: 0 }]);
  const row = roster.row("one")!;
  roster.update([{ id: "one", name: "Ada", slot: 1 }]);
  assert.equal(
    root.querySelector('[data-slot="1"] .fui-slot-occupant')?.firstElementChild,
    row,
  );
  assert.equal(
    root.querySelector('[data-slot="0"] .fui-slot-occupant')?.childElementCount,
    0,
  );
});

test("capacity changes keep occupied overflow slots visible and removable", () => {
  const { document } = page(),
    root = document.createElement("section"),
    roster = createRoster({ document });
  document.body.append(root);
  const layout = createRoomLayout({ element: root, roster, capacity: 2 });
  roster.update([
    { id: "host", name: "Ada", slot: 0 },
    { id: "bot", name: "AI", slot: 3 },
  ]);
  const remove = document.createElement("button");
  remove.textContent = "Remove AI";
  roster.row("bot")!.append(remove);
  layout.update(2, 2);
  const overflow = root.querySelector<HTMLElement>(
    '.fui-room-open-slot[data-slot="3"]',
  )!;
  assert.equal(overflow.hidden, false);
  assert.ok(overflow.contains(remove));
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "2 / 2");
  assert.equal(
    root.querySelector<HTMLElement>('.fui-room-open-slot[data-slot="2"]')!
      .hidden,
    true,
  );
});

test("slot buttons prompt only for missing names, use the signed-in name and preserve AI slot choice", () => {
  const { document } = page(),
    root = document.createElement("section"),
    form = document.createElement("form"),
    input = document.createElement("input"),
    submit = document.createElement("button"),
    ai = document.createElement("button");
  submit.type = "submit";
  input.value = "";
  form.append(input, submit);
  document.body.append(root);
  let account: string | undefined,
    joined: number | undefined,
    bot: number | undefined;
  form.requestSubmit = () => {
    joined = requestedRoomSlot(form);
  };
  ai.onclick = () => {
    bot = requestedRoomSlot(ai);
  };
  createRoomLayout({
    element: root,
    roster: createRoster({ document }),
    capacity: 3,
    join: form,
    addAI: ai,
    playerName: () => account,
    slotColor: () => "#16e7ff",
  });
  const dialog = root.querySelector<HTMLDialogElement>(".fui-slot-admission")!;
  dialog.showModal = () => {
    dialog.open = true;
  };
  root
    .querySelector<HTMLButtonElement>('[data-slot="2"] .fui-slot-join')!
    .click();
  assert.equal(dialog.open, true);
  assert.equal(joined, undefined);
  dialog.open = false;
  account = "Anders";
  root
    .querySelector<HTMLButtonElement>('[data-slot="1"] .fui-slot-join')!
    .click();
  assert.equal(joined, 1);
  assert.equal(input.value, "Anders");
  assert.equal(dialog.open, false);
  root
    .querySelector<HTMLButtonElement>('[data-slot="0"] .fui-slot-ai')!
    .click();
  assert.equal(bot, 0);
});

test("room layout: stable occupied slots, explicit admission and game-owned AI actions", () => {
  const { document } = page();
  const root = document.createElement("section"),
    form = document.createElement("form");
  const submit = document.createElement("button");
  submit.type = "submit";
  form.append(submit);
  document.body.append(form, root);
  const roster = createRoster({ document });
  const invite = document.createElement("div");
  invite.className = "fui-invite";
  invite.append(
    document.createElement("img"),
    document.createElement("strong"),
  );
  root.append(invite);
  const ai = document.createElement("button"),
    start = document.createElement("button");
  let bots = 0;
  ai.onclick = () => bots++;
  const map = document.createElement("select");
  map.disabled = true;
  const layout = createRoomLayout({
    element: root,
    roster,
    capacity: 3,
    join: form,
    addAI: ai,
    settings: [map],
    actions: [start],
  });
  assert.equal(invite.parentElement?.className, "fui-room-invitation");
  assert.equal(form.parentElement?.className, "fui-dialog-body");
  assert.equal(submit.textContent, "Join");
  assert.equal(ai.textContent, "Add AI");
  ai.click();
  assert.equal(bots, 1);
  assert.equal(map.disabled, true, "layout cannot grant settings authority");
  roster.update([{ id: "one", name: "Ada" }]);
  const ada = roster.row("one");
  roster.update([
    { id: "one", name: "Ada" },
    { id: "two", name: "AI" },
  ]);
  assert.equal(roster.row("one"), ada);
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "2 / 3");
  assert.equal(
    [...root.querySelectorAll<HTMLElement>(".fui-room-open-slot")].filter(
      (n) => !n.hidden && !n.classList.contains("fui-slot-occupied"),
    ).length,
    1,
  );
  root.hidden = true;
  roster.update([]);
  assert.equal(
    form.parentElement,
    document.body,
    "late admission remains outside a hidden room",
  );
  root.hidden = false;
  roster.update([]);
  assert.equal(form.parentElement?.className, "fui-dialog-body");
  layout.settings.showModal = () => {
    layout.settings.open = true;
  };
  layout.settings.close = () => {
    layout.settings.open = false;
  };
  root.querySelector<HTMLButtonElement>(".fui-room-settings")!.click();
  assert.equal(layout.settings.open, true);
  root.hidden = true;
  roster.update([]);
  assert.equal(layout.settings.open, false);
});

test("room layout: custom rosters can attach admission after mounting and omit settings", () => {
  const { document } = page();
  const root = document.createElement("section"),
    roster = document.createElement("ul");
  document.body.append(root);
  const form = document.createElement("form");
  root.append(form);
  const layout = createRoomLayout({
    element: root,
    roster,
    capacity: 2,
    join: form,
  });
  assert.match(layout.settings.textContent, /fixed match rules/);
  root.hidden = true;
  layout.update(1);
  assert.equal(form.parentElement, document.body);
  const second = document.createElement("form");
  document.body.append(second);
  layout.attachJoin(second);
  root.hidden = false;
  layout.update(2);
  assert.equal(second.parentElement?.className, "fui-dialog-body");
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "2 / 2");
  layout.update(2, 4);
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "2 / 4");
  assert.equal(
    [...root.querySelectorAll<HTMLElement>(".fui-room-open-slot")].filter(
      (slot) => !slot.hidden && !slot.classList.contains("fui-slot-occupied"),
    ).length,
    2,
  );
  layout.update(2, 2);
  assert.ok(
    [...root.querySelectorAll<HTMLElement>(".fui-room-open-slot")].every(
      (slot) => slot.hidden || slot.classList.contains("fui-slot-occupied"),
    ),
  );
});

test("HTML room renderer shares the layout and respects map-dependent capacity", () => {
  const { document } = page();
  const root = document.createElement("div");
  root.innerHTML = roomLayoutMarkup({
    invite: "<strong>AB42</strong>",
    players: "<ul></ul>",
    join: "<button>Join</button>",
    settings: "<select disabled></select>",
    actions: "<button>Start</button>",
    occupied: 1,
    capacity: 4,
  });
  assert.equal(root.querySelectorAll(".fui-room-open-slot").length, 4);
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "1 / 4");
  assert.equal(
    root.querySelector("[data-room-settings]")?.getAttribute("aria-label"),
    "Game settings",
  );
  assert.equal(root.querySelector("select")?.disabled, true);
  assert.ok(
    !roomLayoutMarkup({
      invite: "",
      players: "",
      join: "",
      settings: "",
      actions: "",
      occupied: 5,
      capacity: 2,
    }).includes('fui-room-open-slot"'),
  );
});

test("an existing settings action is the shared room's single trigger", () => {
  const { document } = page();
  const root = document.createElement("section"),
    trigger = document.createElement("button");
  let opened = 0;
  const layout = createRoomLayout({
    element: root,
    roster: document.createElement("div"),
    capacity: 2,
    settingsTrigger: trigger,
    onSettings: () => {
      opened++;
    },
  });
  trigger.click();
  assert.equal(opened, 1);
  assert.equal(
    [...root.querySelectorAll("button")].filter(
      (node) => node.textContent === "Game settings",
    ).length,
    1,
  );
  layout.settings.open = true;
  layout.settings.close = () => {
    layout.settings.open = false;
  };
  layout.setActive(false);
  assert.equal(layout.settings.open, false);
});
