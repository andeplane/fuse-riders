import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoomLayout, createRoster, roomLayoutMarkup } from "fuse-ui";
import { page } from "./dom-fixture.js";

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
  assert.equal(form.parentElement?.className, "fui-room-join");
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
      (n) => !n.hidden,
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
  assert.equal(form.parentElement?.className, "fui-room-join");
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
  assert.equal(second.parentElement?.className, "fui-room-join");
  assert.equal(root.querySelector(".fui-room-count")?.textContent, "2 / 2");
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
  assert.equal(root.querySelectorAll(".fui-room-open-slot").length, 3);
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
