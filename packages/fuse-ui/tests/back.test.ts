import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backOnEscape,
  createBackButton,
  createBackLink,
  createPageHeader,
  createPageMessage,
  createSubPage,
} from "fuse-ui";
import { event, page } from "./dom-fixture.js";

function escape(window: { Event: typeof Event }): Event {
  return event(window, "keydown", { key: "Escape" });
}

test("Back is one control: a button or a link, named Back unless a nested view names its parent", () => {
  const { document } = page();
  let pressed = 0;
  const back = createBackButton({ onBack: () => pressed++, document });
  assert.equal(back.tagName, "BUTTON");
  assert.equal(back.type, "button");
  assert.equal(back.className, "fui-back");
  assert.equal(back.textContent, "Back");
  assert.equal(back.getAttribute("aria-label"), "Back");
  back.click();
  assert.equal(pressed, 1);

  const nested = createBackButton({
    label: "Matches",
    className: "game-hook",
    document,
  });
  assert.equal(nested.className, "fui-back game-hook");
  assert.equal(nested.getAttribute("aria-label"), "Matches");

  const link = createBackLink({ href: "/fusemania/?mute", document });
  assert.equal(link.tagName, "A");
  assert.equal(link.getAttribute("href"), "/fusemania/?mute");
  assert.equal(link.className, "fui-back");
  assert.equal(link.textContent, "Back");
});

test("a page header reads Back, title, actions, and hides a title it was not given", () => {
  const { document } = page();
  const back = createBackButton({ document }),
    options = document.createElement("button"),
    play = document.createElement("button");
  const header = createPageHeader({
    title: "Sync timing",
    back,
    actions: [options, play],
    document,
  });
  assert.equal(header.element.tagName, "HEADER");
  assert.deepEqual(
    [...header.element.children].map((child) => child.className),
    ["fui-back", "fui-page-title", "fui-page-actions"],
  );
  assert.equal(header.title.textContent, "Sync timing");
  assert.equal(header.title.hidden, false);
  assert.equal(
    header.actions.lastElementChild === play,
    true,
    "the primary action is the last one, at the right",
  );

  const bare = createPageHeader({ document });
  assert.equal(bare.title.hidden, true);
  assert.equal(bare.element.querySelector(".fui-back"), null);
});

test("a sub page is a main with its header first, Back linking to the front door, and an alert line for errors", () => {
  const { document } = page();
  const message = createPageMessage("That is not a room code.", document);
  const sub = createSubPage({
    title: "Join room",
    backHref: "/fuse-volley/",
    content: [message],
    document,
  });
  assert.equal(sub.element.tagName, "MAIN");
  assert.equal(sub.element.className, "fui-page");
  assert.equal(sub.element.firstElementChild === sub.header.element, true);
  assert.equal(sub.header.element.firstElementChild === sub.back, true);
  assert.equal(sub.back.getAttribute("href"), "/fuse-volley/");
  assert.equal(sub.header.title.textContent, "Join room");
  assert.equal(sub.element.lastElementChild === message, true);
  assert.equal(message.getAttribute("role"), "alert");
  assert.equal(message.className, "fui-page-message");
});

test("Escape presses Back, except when Back is out of reach or Escape already meant something else", () => {
  const { document, window } = page();
  let pressed = 0,
    enabled = true;
  const back = createBackButton({ onBack: () => pressed++, document });
  const header = createPageHeader({ back, document });
  document.body.append(header.element);
  const release = backOnEscape(back, { enabled: () => enabled });

  const first = escape(window);
  document.dispatchEvent(first);
  assert.equal(pressed, 1);
  assert.equal(first.defaultPrevented, true);

  document.dispatchEvent(event(window, "keydown", { key: "Enter" }));
  assert.equal(pressed, 1, "only Escape");

  const used = escape(window);
  used.preventDefault();
  document.dispatchEvent(used);
  assert.equal(pressed, 1, "a key something else used is not Back");

  header.element.hidden = true;
  document.dispatchEvent(escape(window));
  assert.equal(pressed, 1, "a hidden Back is not pressed");
  header.element.hidden = false;

  back.disabled = true;
  document.dispatchEvent(escape(window));
  assert.equal(pressed, 1, "nor a disabled one");
  back.disabled = false;

  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.append(dialog);
  document.dispatchEvent(escape(window));
  assert.equal(pressed, 1, "Escape belongs to an open dialog");
  dialog.remove();

  enabled = false;
  document.dispatchEvent(escape(window));
  assert.equal(pressed, 1, "the page can say Escape is busy");
  enabled = true;

  header.element.remove();
  document.dispatchEvent(escape(window));
  assert.equal(pressed, 1, "a Back that left the page is not pressed");
  document.body.append(header.element);

  document.dispatchEvent(escape(window));
  assert.equal(pressed, 2);
  release();
  document.dispatchEvent(escape(window));
  assert.equal(pressed, 2, "released");
});
