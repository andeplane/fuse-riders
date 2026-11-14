import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import type { VictoryKind } from "../src/engine/index.js";
import type { Icon } from "../src/app/art.js";
import { countdownCard, type CountdownState } from "../src/app/briefing.js";
import { createBriefCardView } from "../src/app/brief-view.js";

/** A fresh linkedom document per test; nothing is installed on globalThis. */
const page = (): Document =>
  parseHTML("<!doctype html><html><body></body></html>")
    .document as unknown as Document;

/** The art the page would have after the manifest loaded: one picture per way to win. */
const ICONS: Partial<Record<VictoryKind, Icon>> = Object.fromEntries(
  (["military", "economy", "snail"] as const).map((kind) => [
    kind,
    {
      url: `art/${kind}.png`,
      width: 40,
      height: 40,
      size: "80px 80px",
      position: "0px 0px",
    },
  ]),
);
/** The first game's countdown, 8 s, at `elapsed` log ticks. */
const first = (elapsed: number): CountdownState => ({
  round: 1,
  elapsed,
  left: 161 - elapsed,
});
/** Every frame of a first-game countdown for `slot`, shown in order on one card. */
function countdown(slot: number): {
  card: HTMLElement;
  frames: number;
  show: (elapsed: number) => void;
} {
  const view = createBriefCardView(page());
  return {
    card: view.element,
    frames: 162,
    show: (elapsed) =>
      view.show(
        countdownCard(first(elapsed), slot, "keys", "Twin Hives"),
        ICONS,
        "3",
      ),
  };
}
/** What the card shows, apart from the counting title: the text and the pictures, in order. */
const body = (card: HTMLElement): string =>
  [...card.querySelectorAll(".kf-brief-win, .kf-brief-role, .kf-control")]
    .map((node) => `${node.className}|${node.textContent ?? ""}`)
    .join("\n");
const icons = (card: HTMLElement): string[] =>
  [...card.querySelectorAll(".kf-brief-icon")].map(
    (node) => (node as HTMLElement).style.backgroundImage,
  );

test("the card shows all three ways to win on its very first frame", () => {
  const { card, show } = countdown(0);
  show(0);
  const kinds = [...card.querySelectorAll(".kf-brief-win")].map(
    (item) => (item as HTMLElement).dataset.kind,
  );
  assert.deepEqual(kinds, ["military", "economy", "snail"]);
  assert.deepEqual(icons(card), [
    'url("art/military.png")',
    'url("art/economy.png")',
    'url("art/snail.png")',
  ]);
  const captions = [...card.querySelectorAll(".kf-brief-win span")].map(
    (span) => span.textContent,
  );
  assert.deepEqual(captions, [
    "Kill the Queen 3×",
    "Fill your hive with berries",
    "Ride the snail home",
  ]);
  assert.equal(card.hidden, false);
  assert.equal(
    card.querySelector<HTMLElement>(".kf-brief-wins")!.hidden,
    false,
  );
});

test("nothing on the card appears, moves or is replaced over the whole countdown", () => {
  for (const slot of [0, 3, -1]) {
    const { card, frames, show } = countdown(slot);
    show(0);
    const opening = body(card),
      pictures = icons(card),
      first = [...card.querySelectorAll(".kf-brief-win")];
    for (let elapsed = 1; elapsed < frames; elapsed++) {
      show(elapsed);
      assert.equal(body(card), opening, `slot ${slot} at tick ${elapsed}`);
      assert.deepEqual(icons(card), pictures, `pictures at tick ${elapsed}`);
    }
    // The very same elements, never torn down and built again: a rebuild is what restarted the animation.
    const now = [...card.querySelectorAll(".kf-brief-win")];
    assert.equal(now.length, first.length);
    for (const [index, item] of now.entries())
      assert.ok(item === first[index], `picture ${index} is the same element`);
    assert.equal(card.hidden, false, "and the card never blinks out");
  }
});

test("only the title changes while the countdown runs", () => {
  const { card, frames, show } = countdown(0),
    title = card.querySelector<HTMLElement>(".kf-brief-title")!;
  const seen: string[] = [];
  for (let elapsed = 0; elapsed < frames; elapsed++) {
    show(elapsed);
    const text = title.textContent ?? "";
    if (seen.at(-1) !== text) seen.push(text);
    assert.equal(title.hidden, false, `tick ${elapsed}: the title has text`);
  }
  assert.deepEqual(seen, ["THREE WAYS TO WIN", "3", "2", "1"]);
});

const source = (name: string): string =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

test("the card holds no clock, so it can stage nothing", () => {
  // The view takes a Document and nothing else: with no clock injected it cannot schedule a reveal.
  const code = source("../src/app/brief-view.ts");
  for (const scheduler of [
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
    "Date.now",
    "performance.now",
  ])
    assert.doesNotMatch(code, new RegExp(scheduler.replace(".", "\\.")));
  assert.match(code, /createBriefCardView\(doc: Document = document\)/);
});

test("a Queen is told on the card that she cannot carry berries or ride the snail", () => {
  const queen = countdown(0);
  queen.show(0);
  const line = queen.card.querySelector<HTMLElement>(".kf-brief-role")!;
  assert.equal(line.hidden, false);
  assert.match(
    line.textContent ?? "",
    /cannot carry berries or ride the snail/,
  );
  assert.match(
    line.textContent ?? "",
    /play a Worker to carry berries and ride the snail/,
  );
  const worker = countdown(3);
  worker.show(0);
  assert.equal(
    worker.card.querySelector<HTMLElement>(".kf-brief-role")!.hidden,
    true,
    "a Worker already does both; its own lines stand",
  );
});

test("every control note is a line of its own, not a column", () => {
  const { card, show } = countdown(0);
  show(0);
  for (const row of card.querySelectorAll(".kf-control")) {
    const notes = row.querySelectorAll(".kf-control-note");
    assert.ok(notes.length <= 1, "one note at most");
    for (const note of notes)
      assert.notEqual(note.textContent, "", "no empty note takes a cell");
  }
  // MOVE has nothing to add, so it contributes no note element at all.
  const names = [...card.querySelectorAll(".kf-control")]
    .filter((row) => row.querySelector(".kf-control-note"))
    .map((row) => row.querySelector(".kf-control-name")?.textContent);
  assert.deepEqual(names, ["JUMP / FLAP", "DIVE", "ATTACK"]);
});

const css = source("../src/app/killer-fuse.css");

test("the card's only motion is one short fade-in, and reduced motion drops it", () => {
  const animated = [...css.matchAll(/^\.(kf-brief[\w-]*)\s*\{([^}]*)\}/gm)]
    .filter(([, , block]) => /animation:/.test(block ?? ""))
    .map(([, selector]) => selector);
  assert.deepEqual(animated, ["kf-brief"], "the whole card, nothing inside it");
  const fade = /\.kf-brief \{\s*animation: (kf-brief-in) ([\d.]+)s/.exec(css);
  assert.ok(fade, "the card fades in");
  assert.ok(Number(fade[2]) <= 0.25, `${fade[2]}s is at most 250 ms`);
  // No win picture keeps a staged animation, and nothing on the card loops or alternates.
  assert.doesNotMatch(css, /kf-win-in/);
  for (const [, block] of css.matchAll(/@keyframes kf-brief-in\s*\{([^@]*)\}/g))
    assert.doesNotMatch(block ?? "", /infinite|alternate/);
  assert.doesNotMatch(css, /animation[^;]*infinite/);
  const reduced = /@media \(prefers-reduced-motion: reduce\) \{([^@]*?)\n\}/s;
  const block = reduced.exec(css);
  assert.ok(block, "a reduced-motion block");
  assert.match(block[1] ?? "", /\.kf-brief \{\s*animation: none;/);
});
