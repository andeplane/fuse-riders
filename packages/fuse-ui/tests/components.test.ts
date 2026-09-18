import assert from "node:assert/strict";
import test from "node:test";
import {
  closeOnBackdrop,
  createControllerRow,
  createDialog,
  createInviteCard,
  createJoinByCode,
  createLandingCard,
  createLobby,
  createNameEntry,
  createNotice,
  createRoster,
} from "fuse-ui";
import {
  HOSTILE,
  event,
  manualTimers,
  page,
  recordClose,
} from "./dom-fixture.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("dialog shell: title bar, CLOSE, body, and part classes a game can rename", () => {
  const { document } = page();
  const shell = createDialog({ title: HOSTILE, document });
  assert.equal(shell.dialog.className, "fui-dialog");
  assert.equal(shell.dialog.getAttribute("aria-label"), HOSTILE);
  assert.equal(shell.title.textContent, HOSTILE);
  assert.equal(shell.title.children.length, 0);
  assert.deepEqual(
    [...shell.dialog.children].map((child) => child.className),
    ["fui-dialog-bar", "fui-dialog-body"],
  );
  assert.deepEqual([...shell.bar.children], [shell.title, shell.actions]);
  assert.deepEqual([...shell.actions.children], [shell.close]);
  assert.equal(shell.close.type, "button");
  assert.equal(shell.close.getAttribute("aria-label"), "CLOSE");
  const closed = recordClose(shell.dialog);
  shell.close.click();
  assert.equal(closed.count, 1);

  const fuse = createDialog({
    title: "SETTINGS",
    label: "Settings",
    closeText: "DONE",
    classes: { root: "game-dialog", title: "", close: "" },
    document,
  });
  assert.equal(fuse.dialog.className, "game-dialog");
  assert.equal(fuse.dialog.getAttribute("aria-label"), "Settings");
  assert.equal(fuse.title.hasAttribute("class"), false);
  assert.equal(fuse.close.hasAttribute("class"), false);
  assert.equal(fuse.close.textContent, "DONE");
  assert.equal(fuse.bar.className, "fui-dialog-bar");
});

test("dialog backdrop: a click outside the box closes, inside or on a child does not", () => {
  const { document, window } = page();
  const { dialog, body } = createDialog({ title: "MENU", document });
  const closed = recordClose(dialog);
  Object.defineProperty(dialog, "getBoundingClientRect", {
    value: () => ({ left: 100, right: 300, top: 50, bottom: 250 }),
  });
  dialog.dispatchEvent(event(window, "click", { clientX: 200, clientY: 100 }));
  assert.equal(closed.count, 0, "inside the box");
  body.dispatchEvent(event(window, "click", { clientX: 10, clientY: 10 }));
  assert.equal(closed.count, 0, "the target is a child, not the backdrop");
  for (const [x, y] of [
    [10, 100],
    [400, 100],
    [200, 10],
    [200, 400],
  ] as const)
    dialog.dispatchEvent(event(window, "click", { clientX: x, clientY: y }));
  assert.equal(closed.count, 4);

  const keep = createDialog({
    title: "MENU",
    closeOnBackdrop: false,
    document,
  });
  const kept = recordClose(keep.dialog);
  keep.dialog.dispatchEvent(event(window, "click", { clientX: 0, clientY: 0 }));
  assert.equal(kept.count, 0);
  assert.equal(typeof closeOnBackdrop, "function");
});

test("join by code: normalises, validates, and Enter presses JOIN", () => {
  const { document, window } = page();
  const joined: string[] = [],
    refused: string[] = [];
  const join = createJoinByCode({
    valid: (code) => /^[A-Z]{2}\d{2}$/.test(code),
    onJoin: (code) => joined.push(code),
    onInvalid: (message) => refused.push(message),
    document,
  });
  assert.deepEqual([...join.row.children], [join.input, join.button]);
  assert.equal(join.input.placeholder, "Room code");
  assert.equal(join.input.getAttribute("aria-label"), "Room code");
  assert.equal(join.input.maxLength, 10);
  join.input.value = "  ab42 ";
  join.button.click();
  assert.deepEqual(joined, ["AB42"]);
  join.input.value = "nope";
  join.input.dispatchEvent(event(window, "keydown", { key: "Enter" }));
  assert.deepEqual(refused, ["Enter a room code, for example AB42"]);
  join.input.dispatchEvent(event(window, "keydown", { key: "a" }));
  assert.equal(refused.length, 1, "only Enter presses JOIN");
});

test("landing card: title, CREATE, JOIN and SOLO fire their callbacks; failures show as text", async () => {
  const { document } = page();
  const calls: string[] = [];
  let fail: Error | undefined;
  const landing = createLandingCard({
    title: HOSTILE,
    tagline: "First to 50",
    onCreate: async () => {
      calls.push("create");
      if (fail) throw fail;
    },
    onSolo: () => calls.push("solo"),
    valid: (code) => code === "AB42",
    onJoin: (code) => calls.push(`join ${code}`),
    document,
  });
  const heading = landing.element.querySelector("h1")!;
  assert.equal(heading.textContent, HOSTILE);
  assert.equal(heading.children.length, 0);
  assert.equal(
    landing.element.querySelector(".fui-landing-tagline")?.textContent,
    "First to 50",
  );
  assert.equal(landing.error.getAttribute("role"), "alert");

  landing.create.click();
  assert.equal(
    landing.create.disabled,
    true,
    "no second room while one is being made",
  );
  await settle();
  assert.equal(landing.create.disabled, false);
  fail = new Error(HOSTILE);
  landing.create.click();
  await settle();
  assert.equal(landing.error.textContent, HOSTILE);
  assert.equal(landing.error.children.length, 0);
  fail = undefined;

  landing.join.input.value = "zz";
  landing.join.button.click();
  assert.equal(
    landing.error.textContent,
    "Enter a room code, for example AB42",
  );
  landing.join.input.value = "ab42";
  landing.join.button.click();
  assert.equal(landing.error.textContent, "");
  landing.solo!.click();
  assert.deepEqual(calls, ["create", "create", "join AB42", "solo"]);

  const noSolo = createLandingCard({
    title: "PIG",
    onCreate: () => {
      throw "offline";
    },
    valid: () => true,
    onJoin: () => {},
    document,
  });
  assert.equal(noSolo.solo, undefined);
  assert.equal(noSolo.element.querySelector(".fui-landing-tagline"), null);
  noSolo.create.click();
  await settle();
  assert.equal(noSolo.error.textContent, "offline");
});

test("invite card: QR, caption, code, link and COPY LINK with its reset", async () => {
  const { document } = page();
  const timers = manualTimers();
  const copies: string[] = [];
  let copyWorks = true;
  const invite = createInviteCard({
    code: "AB42",
    link: "https://play.example/?room=AB42",
    qr: async (link) => `data:image/png;base64,${link.length}`,
    copy: async (text) => {
      copies.push(text);
      return copyWorks;
    },
    ...timers,
    document,
  });
  await invite.ready;
  assert.equal(invite.qr.getAttribute("src"), "data:image/png;base64,31");
  assert.equal(invite.qr.alt, "Scan to join this room");
  assert.deepEqual(
    [...invite.element.children].map((child) => child.className),
    ["fui-invite-qr", "fui-invite-caption", "fui-room-code", "fui-invite-link"],
  );
  assert.equal(
    invite.element.querySelector(".fui-invite-url")?.textContent,
    "https://play.example/?room=AB42",
  );
  invite.copy.click();
  await settle();
  assert.deepEqual(copies, ["https://play.example/?room=AB42"]);
  assert.equal(invite.copy.textContent, "COPIED");
  assert.ok(invite.copy.classList.contains("copied"));
  copyWorks = false;
  invite.copy.click();
  await settle();
  assert.equal(invite.copy.textContent, "COPY FAILED");
  assert.deepEqual(
    timers.pending(),
    [1600],
    "a second copy restarts the reset",
  );
  timers.runAll();
  assert.equal(invite.copy.textContent, "COPY LINK");
  assert.equal(invite.copy.classList.contains("copied"), false);

  const failed = createInviteCard({
    code: "AB42",
    link: "x",
    qr: () => Promise.reject(new Error("no canvas")),
    showLink: false,
    document,
  });
  await failed.ready;
  assert.equal(failed.qr.hidden, true);
  assert.equal(failed.element.querySelector(".fui-invite-link"), null);
  const none = createInviteCard({ code: "AB42", link: "x", document });
  await none.ready;
  assert.equal(none.qr.hidden, true);
});

test("roster: rows diff in place, names stay text, avatars rebuild only on change", () => {
  const { document } = page();
  const drawn: string[] = [];
  const roster = createRoster({
    emptyText: "Nobody here yet",
    avatar: (key) => {
      drawn.push(key);
      const head = document.createElement("i");
      head.className = `avatar-${key}`;
      return head;
    },
    document,
  });
  assert.equal(roster.empty?.hidden, false);
  roster.update([
    {
      id: "a",
      name: HOSTILE,
      status: "READY",
      color: "#16e7ff",
      avatar: "cat",
      host: true,
      ready: true,
    },
    { id: "b", name: "Bob", status: "OFFLINE", avatar: "dog" },
  ]);
  assert.equal(roster.empty?.hidden, true);
  const a = roster.row("a")!;
  assert.equal(a.querySelector(".fui-roster-name")?.textContent, HOSTILE);
  assert.equal(a.querySelector("img"), null, "a hostile name adds no element");
  assert.equal(a.querySelector(".fui-roster-status")?.textContent, "READY");
  assert.equal(a.querySelector<HTMLElement>(".fui-roster-host")?.hidden, false);
  assert.equal(a.dataset.ready, "true");
  assert.equal(a.style.getPropertyValue("--rider-color"), "#16e7ff");
  assert.equal(a.firstElementChild?.className, "avatar-cat");
  assert.equal(roster.row("b")!.querySelector(".fui-roster-host"), null);
  assert.deepEqual(drawn, ["cat", "dog"]);

  roster.update([
    { id: "b", name: "Bobby", status: "READY", avatar: "fox" },
    { id: "a", name: HOSTILE, avatar: "cat", host: false },
  ]);
  assert.equal(roster.row("a"), a, "the row element is kept");
  assert.equal(a.querySelector<HTMLElement>(".fui-roster-host")?.hidden, true);
  assert.equal(a.querySelector(".fui-roster-status")?.textContent, "");
  assert.equal(a.dataset.ready, undefined);
  assert.deepEqual(
    drawn,
    ["cat", "dog", "fox"],
    "only the changed avatar is drawn",
  );
  assert.equal(roster.row("b")!.firstElementChild?.className, "avatar-fox");
  assert.equal(
    roster.row("b")!.querySelector(".fui-roster-name")?.textContent,
    "Bobby",
  );
  assert.deepEqual(
    [...roster.entries()].map(([id]) => id),
    ["a", "b"],
  );
  assert.deepEqual(
    [...roster.element.children].slice(1),
    [a, roster.row("b")],
    "a reordered list keeps the rows where they are; order is the stylesheet's",
  );

  roster.update([{ id: "b", name: "Bobby" }]);
  assert.equal(roster.row("a"), undefined);
  assert.equal(a.parentElement, null, "a departed member's row is removed");
  assert.equal(
    roster.row("b")!.querySelector("i"),
    null,
    "no avatar key, no avatar",
  );
  roster.update([]);
  assert.equal(roster.empty?.hidden, false);

  const plain = createRoster({
    classes: { root: "room-riders", row: "room-rider", info: "" },
    document,
  });
  assert.equal(plain.empty, undefined);
  plain.update([{ id: "c", name: "Cy", avatar: "cat" }]);
  assert.equal(plain.element.className, "room-riders");
  assert.equal(plain.row("c")!.className, "room-rider");
  assert.equal(plain.row("c")!.firstElementChild?.hasAttribute("class"), false);
  assert.equal(plain.row("c")!.querySelector("i"), null, "no avatar renderer");
});

test("lobby: code, invite, roster, and START only for whoever may start", () => {
  const { document } = page();
  let started = 0;
  const lobby = createLobby({
    code: "AB42",
    link: "https://play.example/?room=AB42",
    title: "PIG // FIRST TO 50",
    startText: "START GAME",
    onStart: () => started++,
    roster: { emptyText: "Share the code" },
    document,
  });
  assert.equal(lobby.element.getAttribute("aria-label"), "Room AB42");
  assert.equal(
    lobby.element.querySelector("h2")?.textContent,
    "PIG // FIRST TO 50",
  );
  assert.equal(
    lobby.element.querySelector(".fui-room-code")?.textContent,
    "AB42",
  );
  assert.equal(lobby.start.hidden, true);
  lobby.update({
    members: [{ id: "a", name: HOSTILE, host: true }],
    canStart: false,
    showStart: true,
    note: "Waiting for at least 2 players",
  });
  assert.equal(lobby.start.hidden, false);
  assert.equal(lobby.start.disabled, true);
  assert.equal(lobby.note.textContent, "Waiting for at least 2 players");
  assert.equal(
    lobby.roster.row("a")?.querySelector("strong")?.textContent,
    HOSTILE,
  );
  lobby.update({
    members: [
      { id: "a", name: HOSTILE, host: true },
      { id: "b", name: "Bo" },
    ],
    canStart: true,
  });
  assert.equal(lobby.note.hidden, true);
  assert.equal(lobby.start.disabled, false);
  lobby.start.click();
  assert.equal(started, 1);
  lobby.update({ members: [], canStart: false });
  assert.equal(lobby.start.hidden, true, "a guest never sees START");

  const untitled = createLobby({
    code: "CD34",
    link: "y",
    onStart: () => {},
    document,
  });
  assert.equal(untitled.element.querySelector("h2"), null);
});

test("name entry: an empty name says so; a name is normalised and submitted", () => {
  const { document, window } = page();
  const submitted: string[] = [],
    typed: string[] = [];
  const entry = createNameEntry({
    normalize: (raw) => raw.trim().slice(0, 12),
    onSubmit: (name) => submitted.push(name),
    onInput: (value) => typed.push(value),
    initial: "Remembered",
    buttonText: "JOIN AS PLAYER",
    document,
  });
  assert.equal(entry.input.value, "Remembered");
  assert.equal(entry.submit.textContent, "JOIN AS PLAYER");
  assert.equal(entry.submit.type, "submit");
  assert.equal(entry.hint.hidden, true);
  assert.deepEqual(submitted, [], "a remembered name never joins by itself");

  entry.input.value = "   ";
  entry.form.dispatchEvent(event(window, "submit"));
  assert.equal(entry.hint.hidden, false);
  assert.equal(entry.hint.textContent, "Enter your name to join");
  assert.equal(entry.input.getAttribute("aria-invalid"), "true");
  assert.deepEqual(submitted, []);

  entry.input.value = ` ${HOSTILE} `;
  entry.input.dispatchEvent(event(window, "input"));
  assert.equal(entry.hint.hidden, true);
  assert.equal(entry.input.hasAttribute("aria-invalid"), false);
  assert.deepEqual(typed, [HOSTILE]);
  const submit = event(window, "submit");
  entry.form.dispatchEvent(submit);
  assert.ok(submit.defaultPrevented, "the page never navigates");
  assert.deepEqual(submitted, [HOSTILE.slice(0, 12)]);
  assert.equal(entry.input.value, HOSTILE.slice(0, 12));

  const bare = createNameEntry({
    normalize: (raw) => raw,
    onSubmit: () => {},
    document,
  });
  assert.equal(bare.input.value, "");
  bare.input.dispatchEvent(event(window, "input"));
  assert.equal(bare.input.placeholder, "Your name");
});

test("notice: a status line holds text; a toast clears itself; repeats are free", () => {
  const { document } = page();
  const line = createNotice({ document });
  assert.equal(line.element.hidden, true);
  line.show(HOSTILE, "warn");
  assert.equal(line.element.textContent, HOSTILE);
  assert.equal(line.element.children.length, 0);
  assert.equal(line.element.dataset.tone, "warn");
  assert.equal(line.element.getAttribute("role"), "status");
  assert.equal(line.element.getAttribute("aria-live"), "polite");
  line.show("Room closed", "error");
  assert.equal(line.element.getAttribute("role"), "alert");
  assert.equal(line.element.getAttribute("aria-live"), "assertive");
  line.show("");
  assert.equal(line.element.hidden, true);

  const timers = manualTimers();
  const toast = createNotice({
    holdMs: 3000,
    className: "toast",
    ...timers,
    document,
  });
  assert.equal(toast.element.className, "toast");
  toast.show("Rolled a 1");
  toast.show("Rolled a 1");
  assert.deepEqual(
    timers.pending(),
    [3000],
    "the same text does not restart the hold",
  );
  toast.show("Held 12", "good");
  assert.deepEqual(timers.pending(), [3000]);
  timers.runAll();
  assert.equal(toast.element.hidden, true);
  assert.equal(toast.element.textContent, "");
  toast.show("Held 12", "good");
  assert.equal(
    toast.element.hidden,
    true,
    "the same text shown every frame stays hidden once its hold ran out",
  );
  assert.deepEqual(timers.pending(), []);
  toast.flash("Rolled a 1");
  toast.flash("Rolled a 1");
  assert.equal(toast.element.textContent, "Rolled a 1");
  assert.deepEqual(
    timers.pending(),
    [3000],
    "a second flash of the same text restarts the one hold",
  );
  timers.runAll();
  toast.flash("Rolled a 1");
  assert.equal(
    toast.element.hidden,
    false,
    "a flash shows again after its hold",
  );
  toast.flash("");
  assert.equal(toast.element.hidden, true);
  toast.show("Again");
  toast.clear();
  assert.deepEqual(timers.pending(), []);
  toast.show("Again");
  assert.equal(toast.element.hidden, false, "clear forgets the text");
});

test("controller row: big buttons press on pointer down and release once", () => {
  const { document, window } = page();
  const log: string[] = [];
  const row = createControllerRow({
    buttons: [
      {
        label: "ROLL",
        keys: "Space",
        title: "Roll the die (Space)",
        onPress: () => log.push("roll"),
      },
      {
        label: "HOLD",
        onPress: () => log.push("hold"),
        onRelease: () => log.push("hold up"),
      },
      { label: HOSTILE },
    ],
    document,
  });
  const [roll, hold, plain] = row.buttons;
  assert.equal(row.element.className, "fui-controller");
  assert.equal(roll.getAttribute("aria-keyshortcuts"), "Space");
  assert.equal(roll.title, "Roll the die (Space)");
  assert.equal(plain.textContent, HOSTILE);
  assert.equal(plain.children.length, 0);
  assert.equal(plain.hasAttribute("aria-keyshortcuts"), false);

  const finger = (type: string, pointerId: number, button = 0) =>
    event(window, type, { pointerId, button });
  const down = finger("pointerdown", 1);
  hold.dispatchEvent(down);
  assert.ok(down.defaultPrevented);
  assert.ok(hold.classList.contains("active"));
  hold.dispatchEvent(finger("pointerdown", 2));
  hold.dispatchEvent(finger("pointerup", 2));
  assert.ok(
    hold.classList.contains("active"),
    "a second finger lifting does not release the first",
  );
  hold.dispatchEvent(finger("pointerup", 1));
  hold.dispatchEvent(finger("pointerleave", 1));
  assert.equal(hold.classList.contains("active"), false);
  assert.deepEqual(log, ["hold", "hold up"], "one press, one release");

  // A right click is not a press, and a disabled button takes no press at all, though browsers still send it pointer events.
  roll.dispatchEvent(finger("pointerdown", 3, 2));
  roll.disabled = true;
  roll.dispatchEvent(finger("pointerdown", 4));
  roll.dispatchEvent(event(window, "click", { detail: 0 }));
  assert.equal(roll.classList.contains("active"), false);
  assert.deepEqual(log, ["hold", "hold up"]);
  roll.disabled = false;

  // A mouse click follows its own pointerdown; a keyboard click (detail 0) is a whole tap by itself.
  roll.dispatchEvent(event(window, "click", { detail: 1 }));
  roll.dispatchEvent(event(window, "click", { detail: 0 }));
  hold.dispatchEvent(event(window, "click", { detail: 0 }));
  assert.deepEqual(log, ["hold", "hold up", "roll", "hold", "hold up"]);

  for (const type of ["selectstart", "contextmenu"]) {
    const blocked = event(window, type);
    row.element.dispatchEvent(blocked);
    assert.ok(blocked.defaultPrevented, type);
  }
  const custom = createControllerRow({
    buttons: [],
    className: "online-controls",
    document,
  });
  assert.equal(custom.element.className, "online-controls");
});
