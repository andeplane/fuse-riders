import test from "node:test";
import assert from "node:assert/strict";
import { createArt } from "../src/app/art.js";
import {
  DEFAULT_CHOICE,
  SETUP_KEY,
  chooseSetup,
  createMenu,
  parseStoredSetup,
  type MenuChoice,
  type MenuOptions,
} from "../src/app/menu.js";
import type { Store } from "../src/app/session.js";
import { FakeImages, installDom } from "./fixtures/dom.js";

const dom = installDom();
const art = createArt("/", new FakeImages().make);

/** A store over a map; `broken` makes every call throw. */
function memory(initial: Record<string, string> = {}, broken = false) {
  const map = new Map(Object.entries(initial));
  const store: Store = {
    getItem: (key) => {
      if (broken) throw new Error("refused");
      return map.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (broken) throw new Error("refused");
      map.set(key, value);
    },
    removeItem: (key) => void map.delete(key),
  };
  return { store, map };
}
function menu(options: Partial<MenuOptions> = {}, store = memory().store) {
  const started: MenuChoice[] = [];
  let resumed = 0,
    discarded = 0;
  const root = createMenu({
    art,
    store,
    onStart: (choice) => started.push(choice),
    onResume: () => resumed++,
    onDiscard: () => discarded++,
    ...options,
  });
  dom.document.body.replaceChildren(root);
  const $ = <E extends HTMLElement = HTMLElement>(selector: string) =>
    dom.$<E>(selector, root);
  const label = (aria: string) =>
    $<HTMLButtonElement>(`[aria-label="${aria}"]`);
  const segment = (text: string) =>
    dom
      .$$<HTMLButtonElement>(".fl-segment", root)
      .find((button) => button.textContent === text)!;
  return {
    root,
    $,
    label,
    segment,
    started,
    resumed: () => resumed,
    discarded: () => discarded,
    summary: () => $(".fl-setup-summary").textContent,
    names: () =>
      dom
        .$$<HTMLInputElement>(".fl-person-name", root)
        .map((input) => input.value),
    bots: () => $(".fl-stepper-value").textContent,
  };
}

test("the menu starts with you against one normal AI, and the stepper counts AI opponents within the seats left", () => {
  const m = menu();
  assert.equal(m.root.querySelector(".fl-resume"), null, "no saved game");
  assert.deepEqual(m.names(), ["You"]);
  assert.equal(m.bots(), "1");
  assert.equal(m.summary(), "You vs 1 normal AI · about 25–30 weeks");
  const fewer = m.label("Fewer AI opponents"),
    more = m.label("More AI opponents");
  more.click();
  more.click();
  assert.equal(m.bots(), "3");
  assert.equal(more.disabled, true, "three AI at most");
  more.click();
  assert.equal(m.bots(), "3");
  for (let n = 0; n < 3; n++) fewer.click();
  assert.equal(m.bots(), "0");
  assert.equal(fewer.disabled, true);
  const levelRow = m.segment("Hard").parentElement!.parentElement!;
  assert.equal(levelRow.hidden, true, "no AI, no AI level");
  assert.equal(m.summary(), "Just you against the clock: a practice run.");
});

test("AI level, goals and turn length are one-of choices; the summary follows them", () => {
  const m = menu();
  const hard = m.segment("Hard");
  hard.click();
  assert.equal(hard.getAttribute("aria-pressed"), "true");
  assert.equal(m.segment("Normal").getAttribute("aria-pressed"), "false");
  assert.ok(hard.classList.contains("on"));
  m.segment("Quick · 30").click();
  assert.equal(m.summary(), "You vs 1 hard AI · about 20 weeks");
  m.segment("Long · 80").click();
  assert.equal(m.summary(), "You vs 1 hard AI · about 35–40 weeks");
  m.segment("90s").click();
  assert.equal(m.segment("90s").getAttribute("aria-pressed"), "true");
  m.$<HTMLButtonElement>(".fl-start-game").click();
  assert.deepEqual(m.started, [
    {
      humans: [{ name: "You", avatar: "fox" }],
      bots: 1,
      level: 2,
      goal: 80,
      weekSeconds: 90,
    },
  ]);
});

test("players on this device: added with the next free character, renamed, re-dressed and removed, four at most", () => {
  const m = menu();
  const add = m.$<HTMLButtonElement>(".fl-add-person");
  assert.equal(
    m.root.querySelector(".fl-person-remove"),
    null,
    "one player stays",
  );
  add.click();
  assert.deepEqual(m.names(), ["You", "Player 2"]);
  assert.equal(m.summary(), "2 players vs 1 normal AI · about 25–30 weeks");
  const faces = () =>
    dom.$$(".fl-person-face .fl-art", m.root).map((face) => face.dataset.label);
  assert.deepEqual(faces(), ["F", "R"], "the fox, then the first free one");
  m.label("Change Player 2's character").click();
  assert.deepEqual(faces(), ["F", "C"]);
  m.label("Change You's character").click();
  assert.deepEqual(faces(), ["A", "C"], "the fox becomes the alien");

  // A name like another's is told apart; a name that is not one falls back.
  const second = dom.$$<HTMLInputElement>(".fl-person-name", m.root)[1]!;
  second.value = "You";
  second.onchange!(dom.event("change"));
  assert.deepEqual(m.names(), ["You", "You 2"]);
  second.value = "\u0007";
  second.onchange!(dom.event("change"));
  assert.deepEqual(m.names(), ["You", "Player 2"]);

  add.click();
  add.click();
  assert.deepEqual(m.names(), ["You", "Player 2", "Player 3", "Player 4"]);
  assert.equal(add.hidden, true);
  assert.equal(m.bots(), "1", "one seat left for an AI");
  assert.equal(m.label("More AI opponents").disabled, true);
  m.label("Remove Player 2").click();
  assert.deepEqual(m.names(), ["You", "Player 3", "Player 4"]);
  assert.equal(add.hidden, false);
});

test("the choice is remembered on the device and read back next time; a store that refuses never breaks the menu", () => {
  const { store, map } = memory();
  const first = menu({}, store);
  first.label("More AI opponents").click();
  assert.deepEqual(JSON.parse(map.get(SETUP_KEY)!), {
    humans: [{ name: "You", avatar: "fox" }],
    bots: 2,
    level: 1,
    goal: 50,
    weekSeconds: 60,
  });
  const next = menu({}, store);
  assert.equal(next.bots(), "2");

  const remembered = memory({
    [SETUP_KEY]: JSON.stringify({
      humans: [
        { name: "Ada", avatar: "owl" },
        { name: "Bo", avatar: "cat" },
      ],
      bots: 0,
      goal: 30,
    }),
  });
  const pair = menu({}, remembered.store);
  assert.deepEqual(pair.names(), ["Ada", "Bo"]);
  assert.equal(pair.summary(), "2 players · about 20 weeks");

  const refused = menu({}, memory({}, true).store);
  assert.deepEqual(refused.names(), ["You"]);
  refused.label("More AI opponents").click();
  assert.equal(refused.bots(), "2", "the menu still works");
  refused.$<HTMLButtonElement>(".fl-start-game").click();
  assert.equal(refused.started.length, 1);
});

test("a saved game offers CONTINUE and DISCARD", () => {
  const m = menu({ saved: "Week 4 · You vs 1 AI" });
  assert.equal(m.$(".fl-resume-line").textContent, "Week 4 · You vs 1 AI");
  m.$<HTMLButtonElement>(".fl-resume-go").click();
  assert.equal(m.resumed(), 1);
  m.$<HTMLButtonElement>(".fl-resume-discard").click();
  assert.equal(m.discarded(), 1);
  assert.equal(m.root.querySelector(".fl-resume"), null, "gone once discarded");
});

test("a remembered setup that is not one is the default; an empty or broken player list seats just you", () => {
  for (const raw of ["null", "5", "{}", '{"humans":"Ada"}'])
    assert.equal(parseStoredSetup(raw), DEFAULT_CHOICE, raw);
  assert.deepEqual(parseStoredSetup('{"humans":[]}').humans, [
    { name: "You", avatar: "fox" },
  ]);
  assert.deepEqual(
    parseStoredSetup(
      JSON.stringify({
        humans: [
          null,
          { name: 3 },
          { name: "Ada", avatar: 4 },
          { name: "Ada", avatar: "owl" },
        ],
      }),
    ).humans,
    [{ name: "Ada", avatar: "owl" }],
  );
  // A choice that still makes no valid match (here, a seed with a space) starts the default one.
  const pair = parseStoredSetup(
    JSON.stringify({
      humans: [
        { name: "Ada", avatar: "owl" },
        { name: "Bo", avatar: "cat" },
      ],
    }),
  );
  assert.deepEqual(
    chooseSetup(pair, "not a seed").humans,
    DEFAULT_CHOICE.humans,
  );
  assert.equal(chooseSetup(pair, "seed-1").humans.length, 2);
});

test("ADD A PLAYER does nothing past four, even if pressed while hidden", () => {
  const m = menu();
  const add = m.$<HTMLButtonElement>(".fl-add-person");
  for (let n = 0; n < 5; n++) add.click();
  assert.deepEqual(m.names(), ["You", "Player 2", "Player 3", "Player 4"]);
});
