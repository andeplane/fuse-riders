import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createJoinByCode,
  createNameEntry,
  createPicker,
  createRadioGroup,
} from "fuse-ui";
import { HOSTILE, event, page } from "./dom-fixture.js";

test("name entry: a second way in, a lockable name with its note, a slot, and part classes", () => {
  const { document, window } = page();
  const joined: string[] = [],
    watched: string[] = [];
  const art = document.createElement("div");
  const entry = createNameEntry({
    normalize: (raw) => raw.trim().slice(0, 12),
    onSubmit: (name) => joined.push(name),
    secondary: {
      text: "JOIN AS SPECTATOR",
      title: "Watch without a seat",
      onSubmit: (name) => watched.push(name),
    },
    note: { text: "Your account name.", id: "account-note" },
    extra: [art],
    disabled: true,
    classes: { root: "join", input: "", submit: "", secondary: "watch" },
    document,
  });
  assert.equal(entry.form.className, "join");
  assert.equal(entry.input.className, "");
  assert.equal(entry.submit.className, "");
  assert.equal(
    entry.hint.className,
    "fui-name-hint",
    "unnamed parts keep defaults",
  );
  assert.deepEqual(
    [...entry.form.children],
    [entry.input, entry.submit, entry.secondary, entry.note, entry.hint, art],
  );
  const secondary = entry.secondary!;
  assert.equal(
    secondary.type,
    "button",
    "the second way never submits the form",
  );
  assert.equal(secondary.className, "watch");
  assert.equal(secondary.title, "Watch without a seat");
  assert.equal(entry.submit.disabled, true);
  assert.equal(secondary.disabled, true);
  entry.setDisabled(false);
  assert.equal(entry.submit.disabled, false);
  assert.equal(secondary.disabled, false);

  secondary.click();
  assert.deepEqual(watched, [], "no name, no spectator");
  assert.equal(entry.hint.hidden, false);
  assert.equal(entry.input.getAttribute("aria-invalid"), "true");

  entry.input.value = `  ${HOSTILE}  `;
  secondary.click();
  assert.deepEqual(watched, [HOSTILE.trim().slice(0, 12)]);
  assert.equal(entry.input.value, HOSTILE.trim().slice(0, 12));
  assert.deepEqual(joined, [], "the second way is not the first");

  const note = entry.note!;
  assert.equal(note.hidden, true);
  assert.equal(note.id, "account-note");
  assert.equal(entry.fixed(), false);
  entry.input.setAttribute("aria-invalid", "true");
  entry.hint.hidden = false;
  entry.fix(HOSTILE);
  assert.equal(entry.fixed(), true);
  assert.equal(entry.input.value, HOSTILE);
  assert.equal(entry.input.readOnly, true);
  assert.equal(entry.input.getAttribute("aria-describedby"), "account-note");
  assert.equal(note.hidden, false);
  assert.equal(entry.hint.hidden, true);
  assert.equal(entry.input.hasAttribute("aria-invalid"), false);
  entry.form.dispatchEvent(event(window, "submit"));
  assert.deepEqual(joined, [HOSTILE.slice(0, 12)]);
  assert.equal(entry.confirm(), HOSTILE.slice(0, 12));

  const bare = createNameEntry({
    normalize: (raw) => raw,
    onSubmit: () => {},
    document,
  });
  assert.equal(bare.secondary, undefined);
  assert.equal(bare.note, undefined);
  bare.fix("Ada");
  assert.equal(bare.input.hasAttribute("aria-describedby"), false);
  assert.deepEqual(
    [...bare.form.children],
    [bare.input, bare.submit, bare.hint],
  );
});

test("picker: pressed state, data key, art, and picks that report once", () => {
  const { document } = page();
  const picks: string[] = [];
  const picker = createPicker({
    legend: "Choose a colour",
    choices: [
      { id: "red", label: HOSTILE },
      { id: "blue", label: "Blue" },
    ],
    selected: "blue",
    art: (id) => {
      const swatch = document.createElement("i");
      swatch.dataset.swatch = id;
      return swatch;
    },
    dataKey: "colourId",
    onPick: (id) => picks.push(id),
    classes: { option: "colour" },
    document,
  });
  assert.equal(picker.element.tagName, "FIELDSET");
  assert.equal(picker.element.className, "fui-picker");
  assert.equal(
    picker.element.querySelector("legend")!.textContent,
    "Choose a colour",
  );
  assert.equal(picker.summary, undefined);
  const [red, blue] = picker.buttons;
  assert.equal(red!.className, "colour");
  assert.equal(red!.type, "button");
  assert.equal(red!.dataset.colourId, "red");
  assert.equal(red!.getAttribute("aria-label"), HOSTILE);
  assert.equal(
    red!.querySelector("img"),
    null,
    "a label is text, never markup",
  );
  assert.equal(red!.lastElementChild!.textContent, HOSTILE);
  assert.equal(red!.firstElementChild!.getAttribute("data-swatch"), "red");
  assert.equal(red!.getAttribute("aria-pressed"), "false");
  assert.equal(blue!.getAttribute("aria-pressed"), "true");
  red!.click();
  assert.deepEqual(picks, ["red"]);
  assert.equal(picker.selected(), "red");
  assert.equal(red!.getAttribute("aria-pressed"), "true");
  assert.equal(blue!.getAttribute("aria-pressed"), "false");
  picker.sync("blue");
  assert.deepEqual(picks, ["red"], "sync never reports a pick");
  assert.equal(picker.selected(), "blue");
  assert.equal(blue!.getAttribute("aria-pressed"), "true");
  picker.unfold(true);
  assert.equal(
    picker.element.hidden,
    false,
    "an unfolded picker has nothing to fold",
  );
});

test("picker: folded behind a summary that opens it and closes on a pick", () => {
  const { document } = page();
  const picker = createPicker({
    legend: "Choose your avatar",
    choices: [
      { id: "cat", label: "Cat" },
      { id: "owl", label: "Owl" },
    ],
    selected: "cat",
    fold: {
      id: "avatars",
      summary: (id) => [document.createTextNode(`Avatar · ${id}`)],
      label: (id) => `Avatar · ${id}, change`,
    },
    document,
  });
  const summary = picker.summary!;
  assert.equal(summary.type, "button");
  assert.equal(summary.className, "fui-picker-summary");
  assert.equal(picker.element.id, "avatars");
  assert.equal(summary.getAttribute("aria-controls"), "avatars");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(picker.element.hidden, true);
  assert.equal(summary.getAttribute("aria-label"), "Avatar · cat, change");
  assert.equal(summary.textContent, "Avatar · catCHANGE");
  assert.equal(summary.lastElementChild!.className, "fui-picker-change");
  let focused = 0;
  summary.focus = () => {
    focused++;
  };
  summary.click();
  assert.equal(picker.element.hidden, false);
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  picker.buttons[1]!.click();
  assert.equal(picker.element.hidden, true, "a pick folds the grid");
  assert.equal(summary.getAttribute("aria-label"), "Avatar · owl, change");
  assert.equal(focused, 1, "focus returns to the summary");
  picker.sync("cat");
  assert.equal(summary.getAttribute("aria-label"), "Avatar · cat, change");

  const generated = createPicker({
    legend: "x",
    choices: [{ id: "a", label: "A" }],
    selected: "a",
    fold: { summary: () => [], label: () => "A" },
    document,
  });
  assert.match(generated.element.id, /^fui-picker-\d+$/);
});

test("radio group: a labelled fieldset whose value follows the checked radio", () => {
  const { document, window } = page();
  const changes: string[] = [];
  const group = createRadioGroup({
    legend: "Where will you play?",
    name: "mode",
    options: [
      { value: "devices", label: HOSTILE },
      { value: "shared", label: "Shared TV" },
    ],
    selected: "shared",
    onChange: (value) => changes.push(value),
    className: "landing-mode",
    document,
  });
  assert.equal(group.element.className, "landing-mode");
  assert.equal(
    group.element.getAttribute("aria-label"),
    "Where will you play?",
  );
  assert.equal(group.element.firstElementChild!.tagName, "LEGEND");
  const [devices, shared] = group.inputs;
  assert.equal(devices!.type, "radio");
  assert.equal(devices!.name, "mode");
  assert.equal(devices!.checked, false);
  assert.equal(shared!.checked, true);
  assert.equal(devices!.parentElement!.textContent, HOSTILE);
  assert.equal(devices!.parentElement!.querySelector("img"), null);
  assert.equal(group.value(), "shared");
  devices!.checked = true;
  devices!.dispatchEvent(event(window, "change"));
  assert.equal(group.value(), "devices");
  assert.deepEqual(changes, ["devices"]);
});

test("join by code: REJOIN the last room after JOIN", () => {
  const { document } = page();
  const rejoined: string[] = [];
  const join = createJoinByCode({
    valid: () => true,
    onJoin: () => {},
    onInvalid: () => {},
    rejoin: {
      code: "AB42",
      title: "Return to the room you were in last",
      onRejoin: (code) => rejoined.push(code),
    },
    classes: { rejoin: "landing-rejoin" },
    document,
  });
  const rejoin = join.rejoin!;
  assert.deepEqual([...join.row.children], [join.input, join.button, rejoin]);
  assert.equal(rejoin.textContent, "REJOIN AB42");
  assert.equal(rejoin.className, "landing-rejoin");
  assert.equal(rejoin.title, "Return to the room you were in last");
  rejoin.click();
  assert.deepEqual(rejoined, ["AB42"]);
  const fresh = createJoinByCode({
    valid: () => true,
    onJoin: () => {},
    onInvalid: () => {},
    document,
  });
  assert.equal(fresh.rejoin, undefined);
  assert.equal(fresh.row.children.length, 2);
});
