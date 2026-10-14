import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  CITY,
  END_WEEK,
  FRESHCO,
  JOBHUB,
  KEYNEST,
  MONO,
  PLACES,
  READY,
  WALK,
  doorOf,
  type FuseLaneView,
} from "../src/game/index.js";
import { createArt } from "../src/app/art.js";
import type { ChecklistModel } from "../src/app/checklist.js";
import {
  boardView,
  centreOn,
  clampCamera,
  placeAt,
  stepPoint,
  toMap,
  toScreen,
  type BoardView,
  type Camera,
} from "../src/app/layout.js";
import { LocalMatch, type LocalSetup } from "../src/app/local.js";
import {
  present,
  sparkline,
  type ScreenModel,
  type Viewer,
} from "../src/app/presenter.js";
import {
  createGameScreen,
  money,
  text,
  type Driver,
  type ScreenHooks,
} from "../src/app/screen.js";
import { tourFocus, tourSteps, type TourStep } from "../src/app/tour.js";
import { FakeImages, installDom } from "./fixtures/dom.js";

const dom = installDom();
const art = createArt("/", new FakeImages().make);
const LOCAL: Viewer = {
  me: "",
  host: true,
  solo: true,
  display: false,
  shared: false,
  local: true,
};
const ONLINE: Viewer = {
  me: "p1",
  host: false,
  solo: false,
  display: false,
  shared: false,
};
const setup = (humans: number, bots: number): LocalSetup => ({
  humans: ["Ada", "Bo"]
    .slice(0, humans)
    .map((name, index) => ({ name, avatar: ["fox", "cat"][index]! })),
  bots,
  level: 2,
  goals: [60, 40, 30, 70],
  weekSeconds: 45,
  seed: "screen-1",
});
/** The board's layout while the HUD takes no room (nothing is laid out in it): 6 px kept free top and bottom. */
const viewOf = (width = 1280, height = 720): BoardView =>
  boardView(width, height, CITY.map, { top: 6, bottom: 6, left: 0, right: 0 });
const key = (name: string, props: object = {}) =>
  dom.event("keydown", { key: name, ...props }) as unknown as KeyboardEvent;
const distance = (a: Camera, b: Camera) => Math.hypot(a.x - b.x, a.y - b.y);

let previous: { destroy(): void } | undefined;
interface Options {
  humans?: number;
  bots?: number;
  viewer?: Viewer;
  debugRoads?: boolean;
  width?: number;
  height?: number;
  checklistHooks?: boolean;
}
/**
 * The game screen over a match on this device, laid out at `width` × `height`: `render` shows the presenter's model
 * (or one the test made), `step` folds ticks and renders, `frame` runs an animation frame `ms` later. Entries the
 * screen logs go to the match and into `plays`.
 */
function harness(options: Options = {}) {
  previous?.destroy();
  const {
    humans = 1,
    bots = 1,
    viewer = LOCAL,
    debugRoads = true,
    width = 1280,
    height = 720,
    checklistHooks = true,
  } = options;
  const match = LocalMatch.create(setup(humans, bots));
  const plays: unknown[][] = [];
  const calls = {
    again: 0,
    back: 0,
    folds: [] as boolean[],
    hides: [] as [string, boolean][],
  };
  let older: FuseLaneView | undefined,
    newer = match.view(),
    timing = true;
  const driver: Driver = {
    play: (body) => {
      plays.push([...body]);
      return match.play(body);
    },
    frameTiming: () =>
      timing
        ? { ...(older ? { older } : {}), newer, tick: newer.tick }
        : undefined,
  };
  const hooks: ScreenHooks = {
    controls: [dom.document.createElement("button")],
    again: { label: "PLAY AGAIN", run: () => calls.again++ },
    back: { label: "MENU", run: () => calls.back++ },
    ...(checklistHooks
      ? {
          checklist: {
            fold: (open: boolean) => calls.folds.push(open),
            hide: (owner: string, hidden: boolean) =>
              calls.hides.push([owner, hidden]),
          },
        }
      : {}),
  };
  const screen = createGameScreen(art, viewer, () => driver, hooks, {
    debugRoads,
  });
  previous = screen;
  dom.document.body.replaceChildren(...screen.elements);
  const canvas = dom.$<HTMLCanvasElement>("canvas", screen.game);
  const size = (w: number, h: number) => {
    dom.place(screen.game, { width: w, height: h });
    dom.place(canvas, { width: w, height: h });
  };
  size(width, height);
  const model = () => present(match.view(), viewer);
  const render = (next: ScreenModel = model()) => {
    screen.render(next);
    return next;
  };
  return {
    match,
    screen,
    plays,
    calls,
    canvas,
    size,
    model,
    render,
    step(n = 1) {
      for (let k = 0; k < n; k++) {
        older = newer;
        match.step();
        newer = match.view();
      }
      return render();
    },
    frame(ms = 16) {
      dom.advance(ms);
      dom.frame();
    },
    camera(): Camera {
      const [x, y] = (screen.game.dataset.camera ?? "").split(",").map(Number);
      return { x: x!, y: y! };
    },
    setTiming(on: boolean) {
      timing = on;
    },
    pointer(type: string, props: object = {}) {
      const event = dom.event(type, {
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX: 0,
        clientY: 0,
        ...props,
      });
      canvas.dispatchEvent(event);
      return event;
    },
    $<E extends HTMLElement = HTMLElement>(selector: string): E {
      return dom.$<E>(selector, screen.game);
    },
    $$<E extends HTMLElement = HTMLElement>(selector: string): E[] {
      return dom.$$<E>(selector, screen.game);
    },
    me: () => match.room.players.p1!,
  };
}
type Harness = ReturnType<typeof harness>;
const placePanel = (h: Harness) => h.$$(".fl-panel")[0]!;
function walkInto(h: Harness, place: number): ScreenModel {
  h.match.play([WALK, h.match.room.week, place]);
  for (let n = 0; n < 300 && h.me().inside !== place; n++) h.match.step();
  assert.equal(h.me().inside, place);
  return h.step();
}
function monday(h: Harness): ScreenModel {
  h.match.play([END_WEEK, h.match.room.week]);
  for (let n = 0; n < 100 && h.match.view().part !== "briefing"; n++)
    h.match.step();
  assert.equal(h.match.view().part, "briefing");
  return h.step(0);
}

test("money and text helpers: whole dollars with a sign, and text written only when it changed", () => {
  assert.equal(money(-1234.4), "-$1,234");
  assert.equal(money(5), "$5");
  const span = dom.document.createElement("span");
  text(span, "a");
  const node = span.firstChild;
  text(span, "a");
  assert.equal(span.firstChild, node, "untouched");
  text(span, "b");
  assert.equal(span.textContent, "b");
});

test("controls appear at the start of every week and every pass-device handoff", () => {
  const h = harness({ bots: 0 });
  const initial = h.step(0);
  const startup = h.$(".fl-startup-controls");
  assert.equal(startup.hidden, false);
  assert.match(startup.textContent ?? "", /Click \/ tap a building/);
  h.render({ ...initial, hud: { ...initial.hud!, timer: 0.5 } });
  assert.equal(startup.hidden, true);
  const secondWeek = monday(h);
  const briefingGuide = h.$(".fl-briefing .fui-round-controls");
  assert.equal(briefingGuide.hidden, false);
  assert.equal(briefingGuide.dataset.round, "2");
  assert.match(briefingGuide.textContent ?? "", /CALL IT A WEEK/);
  h.render({ ...secondWeek, briefing: { ...secondWeek.briefing!, week: 3 } });
  assert.equal(briefingGuide.dataset.round, "3");
  const pass = harness({ humans: 2, bots: 0 });
  pass.render();
  const handoffGuide = pass.$(".fl-handoff .fui-round-controls");
  assert.equal(handoffGuide.hidden, false);
  assert.match(handoffGuide.textContent ?? "", /Click \/ tap a choice/);
});

test("the HUD: hours, week, clock, money and goal rings; CALL IT A WEEK logs this week's entry", () => {
  const h = harness();
  const model = h.render();
  const hud = model.hud!;
  assert.equal(h.$(".fl-clock-dial b").textContent, "60");
  assert.equal(h.$(".fl-week").textContent, "WEEK 1");
  assert.equal(h.$(".fl-timer-text").textContent, `${hud.seconds}s left`);
  assert.equal(h.$(".fl-cash").textContent, "$200");
  assert.equal(h.$(".fl-bank").textContent, "bank $0");
  assert.equal(
    h.$(".fl-clock-dial").style.getPropertyValue("--left"),
    (1 - hud.ring).toFixed(3),
  );
  const rings = h.$$(".fl-goal-ring");
  assert.deepEqual(
    rings.map((ring) => ring.getAttribute("aria-label")),
    hud.goals.map((goal) => `${goal.name} ${goal.value} of ${goal.goal}`),
  );
  assert.deepEqual(
    rings.map((ring) => ring.querySelector("b")!.textContent),
    hud.goals.map((goal) => `${goal.value}/${goal.goal}`),
  );
  const end = h.$<HTMLButtonElement>(".fl-end-week");
  assert.equal(end.disabled, false);
  assert.equal(end.textContent, "CALL IT A WEEK");
  end.click();
  assert.deepEqual(h.plays.at(-1), [END_WEEK, 1]);

  h.render({
    ...model,
    hud: {
      ...hud,
      timer: 0.1,
      seconds: 0,
      done: true,
      goals: hud.goals.map((goal) => ({
        ...goal,
        value: goal.goal,
        met: true,
      })),
    },
    canEndWeek: false,
  });
  assert.ok(h.$(".fl-timer-text").classList.contains("low"));
  assert.equal(h.$(".fl-timer-text").textContent, "Week over");
  assert.equal(end.textContent, "WEEK OVER");
  assert.equal(end.disabled, true);
  assert.ok(rings.every((ring) => ring.classList.contains("met")));
  assert.equal(
    rings[0]!
      .querySelector<HTMLElement>(".fl-dial")!
      .style.getPropertyValue("--share"),
    "1.000",
  );

  // The shared screen has no HUD of its own.
  const { hud: _hud, ...bare } = model;
  h.render(bare);
  assert.ok(h.$(".fl-hud").classList.contains("bare"));
  assert.equal(h.$(".fl-clock").hidden, true);
  assert.equal(end.hidden, true);
  assert.equal(h.$(".fl-corners").hidden, true);
});

test("the cash counts to a new value with a pop saying by how much, a goal's gain bumps its ring, and a new player's simply show", () => {
  const h = harness();
  const model = h.render();
  const hud = model.hud!;
  const pops = () => h.$$(".fl-pop").map((pop) => pop.textContent);
  h.render({
    ...model,
    hud: {
      ...hud,
      cash: hud.cash + 40,
      goals: hud.goals.map((goal, k) =>
        k === 0 ? { ...goal, value: goal.value + 2 } : goal,
      ),
    },
  });
  assert.deepEqual(pops(), ["+$40", "+2"]);
  assert.ok(h.$(".fl-money").classList.contains("bump"));
  assert.ok(h.$$(".fl-goal-ring")[0]!.classList.contains("bump"));
  h.frame(250);
  const midway = Number(h.$(".fl-cash").textContent!.replace(/[$,]/g, ""));
  assert.ok(midway > hud.cash && midway < hud.cash + 40, `${midway}`);
  h.frame(300);
  assert.equal(h.$(".fl-cash").textContent, money(hud.cash + 40));
  h.render({ ...model, hud: { ...hud, cash: hud.cash + 40 - 34 } });
  assert.equal(h.$$(".fl-money .fl-pop").at(-1)!.textContent, "−$34");

  // Another player's turn (or a new week) is not a change anyone made: no pop.
  const before = pops().length;
  h.render({ ...model, hud: { ...hud, name: "Someone else", cash: 999 } });
  assert.equal(pops().length, before);
  assert.equal(h.$(".fl-cash").textContent, "$999");
});

test("place buttons walk there; inside a place its panel opens, cards log their entry, and × closes it for this visit", () => {
  const h = harness();
  h.render();
  const strip = h.$$<HTMLButtonElement>(".fl-strip .fl-place");
  assert.deepEqual(
    strip.map((button) => button.textContent),
    PLACES.map((place) => place.name),
  );
  strip[MONO]!.click();
  assert.deepEqual(h.plays.at(-1), [WALK, 1, MONO]);

  const model = walkInto(h, JOBHUB);
  const panel = placePanel(h);
  assert.equal(panel.hidden, false);
  assert.equal(panel.dataset.place, String(JOBHUB));
  assert.ok(strip[JOBHUB]!.classList.contains("here"));
  assert.equal(panel.querySelector(".fl-banner")!.textContent, "Job Hub");
  assert.equal(
    panel.querySelector(".fl-greeting")!.textContent,
    model.panel!.greeting,
  );
  assert.equal(h.$(".fl-panel-building").dataset.art, "building-jobhub");
  assert.equal(
    h.$(".fl-keeper-art").dataset.label,
    art.asset(model.panel!.keeper)!.label,
  );
  const sections = model.panel!.sections;
  assert.deepEqual(
    dom.$$(".fl-section h3", panel).map((title) => title.textContent),
    sections.map((section) => section.title),
  );
  assert.deepEqual(
    dom.$$(".fl-section-info", panel).map((info) => info.textContent),
    sections.flatMap((section) => (section.info ? [section.info] : [])),
  );
  const cards = dom.$$<HTMLButtonElement>(".fl-card", panel),
    models = sections.flatMap((section) => section.cards);
  assert.equal(cards.length, models.length);
  models.forEach((card, index) => {
    const shown = cards[index]!;
    assert.equal(shown.dataset.key, card.key);
    assert.equal(shown.disabled, !card.enabled || !card.entry);
    assert.equal(
      shown.querySelector(".fl-card-title")!.textContent,
      card.title,
    );
    assert.equal(
      shown.querySelector(".fl-card-detail")?.textContent ?? "",
      card.detail,
    );
    assert.equal(
      shown.querySelector(".fl-card-note")?.textContent ?? "",
      card.note,
    );
    assert.equal(
      shown.querySelector(".fl-card-price")?.textContent ?? "",
      card.price,
    );
    assert.equal(
      shown.querySelector(".fl-card-hours")?.textContent ?? "",
      card.hours,
    );
  });
  const sure = models.findIndex((card) => card.enabled && card.entry);
  cards[sure]!.click();
  assert.deepEqual(h.plays.at(-1), models[sure]!.entry);

  // The same panel again leaves the cards alone; a changed one is rebuilt where it was scrolled to.
  h.render(model);
  assert.equal(dom.$$(".fl-card", panel)[0], cards[0]);
  const body = h.$(".fl-panel-body");
  body.scrollTop = 120;
  h.render({ ...model, panel: { ...model.panel!, greeting: "Back again?" } });
  assert.notEqual(dom.$$(".fl-card", panel)[0], cards[0]);
  assert.equal(body.scrollTop, 120);
  // Another place's panel starts at the top.
  const other = {
    ...model.panel!,
    place: FRESHCO,
    name: "FreshCo",
    keeper: "keeper-freshco",
  };
  body.scrollTop = 120;
  h.render({ ...model, panel: other });
  assert.equal(h.$(".fl-panel-building").dataset.art, "building-freshco");
  h.render(model);

  // While you stay, cards keep the rows they had (a hire that unlocks jobs doesn't shuffle them); new ones go after,
  // and leaving the place starts afresh.
  const keys = () => dom.$$(".fl-card", panel).map((card) => card.dataset.key);
  const [first, ...more] = sections;
  const reordered = {
    ...model.panel!,
    greeting: "Reordered",
    sections: [{ ...first!, cards: [...first!.cards].reverse() }, ...more],
  };
  const before = keys();
  h.render({ ...model, panel: reordered });
  assert.deepEqual(keys(), before);
  const extra = { ...first!.cards[0]!, key: "job-extra" };
  h.render({
    ...model,
    panel: {
      ...reordered,
      greeting: "One more",
      sections: [{ ...first!, cards: [extra, ...first!.cards] }, ...more],
    },
  });
  assert.equal(keys()[first!.cards.length], "job-extra");
  const { panel: _gone, ...outside } = model;
  h.render(outside);
  h.render({ ...model, panel: reordered });
  assert.deepEqual(
    keys().slice(0, first!.cards.length),
    reordered.sections[0]!.cards.map((card) => card.key),
    "a new visit takes the new order",
  );
  h.render(model);

  // × closes it for this visit; the place's own button opens it again without walking.
  const logged = h.plays.length;
  dom.$<HTMLButtonElement>(".fl-close", panel).click();
  assert.equal(panel.hidden, true);
  h.render(model);
  assert.equal(panel.hidden, true, "stays closed");
  assert.equal(
    h.$(".fl-tip").hidden,
    model.tip === undefined,
    "the tip is back",
  );
  strip[JOBHUB]!.click();
  assert.equal(panel.hidden, false);
  assert.equal(h.plays.length, logged, "no walk logged");
  h.screen.keydown(key("Escape"));
  assert.equal(panel.hidden, true, "Escape closes it too");
  // Out in the street there is no panel; the next visit opens it again.
  h.render({ ...model, panel: undefined });
  h.render(model);
  assert.equal(panel.hidden, false);
  h.screen.hidePanel();
  assert.equal(panel.hidden, true);
});

test("the you panel: the clock opens it with money, job, chips, tips and goals; ×, the clock or Escape close it; news opens it once", () => {
  const h = harness();
  const model = h.render();
  const hud = model.hud!;
  const you = h.$(".fl-you"),
    clock = h.$<HTMLButtonElement>(".fl-clock");
  assert.equal(you.hidden, true);
  clock.click();
  assert.equal(you.hidden, false);
  assert.equal(dom.$(".fl-banner", you).textContent, hud.name);
  assert.equal(dom.$(".fl-greeting", you).textContent, hud.where);
  assert.deepEqual(
    dom.$$(".fl-you-money span", you).map((line) => line.textContent),
    ["Cash $200", "Bank $0", "60 hours left"],
  );
  assert.equal(dom.$(".fl-job", you).textContent, hud.job);
  assert.deepEqual(
    dom
      .$$(".fl-chip", you)
      .map((chip) => [chip.textContent, chip.classList.contains("warn")]),
    hud.chips.map((chip) => [chip.label, chip.warn]),
  );
  assert.ok(hud.tips.length > 0);
  assert.deepEqual(
    dom.$$(".fl-tips li", you).map((line) => line.textContent),
    hud.tips,
  );
  assert.equal(dom.$(".fl-tips", you).hidden, false);
  assert.deepEqual(
    dom.$$(".fl-goal-value", you).map((value) => value.textContent),
    hud.goals.map((goal) => `${goal.value}/${goal.goal}`),
  );
  assert.equal(dom.$(".fl-you-face", you).dataset.avatar, "fox");
  assert.equal(h.$(".fl-corners").hidden, true, "the rivals step aside");
  assert.equal(h.$(".fl-tip").hidden, true);
  clock.click();
  assert.equal(you.hidden, true);
  clock.click();
  dom.$<HTMLButtonElement>(".fl-close", you).click();
  assert.equal(you.hidden, true);
  clock.click();
  h.screen.keydown(key("Escape"));
  assert.equal(you.hidden, true);

  // A goal met, no tips, another avatar.
  clock.click();
  h.render({
    ...model,
    hud: {
      ...hud,
      tips: [],
      goals: hud.goals.map((goal, index) =>
        index ? goal : { ...goal, value: 99, met: true },
      ),
    },
    scores: model.scores.map((row) =>
      row.you ? { ...row, avatar: "cat" } : row,
    ),
  });
  assert.equal(dom.$(".fl-tips", you).hidden, true);
  assert.ok(dom.$(".fl-goal", you).classList.contains("met"));
  assert.equal(
    dom.$<HTMLElement>(".fl-goal-meter i", you).style.width,
    "100.0%",
  );
  assert.equal(dom.$(".fl-you-face", you).dataset.avatar, "cat");
  clock.click();

  // This week's news opens it once.
  const news = {
    ...model,
    hud: { ...hud, notices: ["Rent is due on Monday."] },
  };
  h.render(news);
  assert.equal(you.hidden, false);
  assert.equal(h.$(".fl-badge").hidden, false);
  assert.deepEqual(
    dom.$$(".fl-news li", you).map((line) => line.textContent),
    ["Rent is due on Monday."],
  );
  clock.click();
  h.render(news);
  assert.equal(you.hidden, true, "news already seen");
  h.render({
    ...news,
    hud: { ...news.hud, notices: ["Your laptop landed a side gig."] },
  });
  assert.equal(you.hidden, false);
  clock.click();
  // Behind a card (Monday, a handoff, the result) it waits.
  h.render({
    ...news,
    hud: { ...news.hud, notices: ["Later news"] },
    result: { title: "YOU WIN!", lines: [], host: true, waiting: "" },
  });
  assert.equal(you.hidden, true);
  // No HUD: the panel closes and stays closed.
  clock.click();
  const { hud: _hud, ...bare } = model;
  h.render(bare);
  assert.equal(you.hidden, true);
  h.render(model);
  assert.equal(you.hidden, true);
});

test("the tip pill walks you to its place, and steps aside for a panel, the you panel and cards", () => {
  const h = harness();
  const model = h.render();
  const tip = { text: "Find a job at the Job Hub.", place: JOBHUB };
  const withTip = { ...model, tip };
  const pill = h.$<HTMLButtonElement>(".fl-tip");
  h.render(withTip);
  assert.equal(pill.hidden, false);
  assert.equal(h.$(".fl-tip-text").textContent, tip.text);
  assert.equal(pill.disabled, false);
  assert.equal(
    pill.getAttribute("aria-label"),
    "Tip: Find a job at the Job Hub. Tap to walk to Job Hub.",
  );
  pill.click();
  assert.deepEqual(h.plays.at(-1), [WALK, 1, JOBHUB]);

  const logged = h.plays.length;
  h.render({ ...model, tip: { text: "Sleep it off.", place: -1 } });
  assert.equal(pill.disabled, true);
  assert.equal(pill.getAttribute("aria-label"), "Tip: Sleep it off.");
  pill.onclick!(dom.event("click") as unknown as PointerEvent);
  assert.equal(h.plays.length, logged, "nowhere to go");
  const { walk: _walk, ...stuck } = withTip;
  h.render(stuck);
  assert.equal(pill.disabled, true, "not while you cannot walk");

  h.render(withTip);
  h.$<HTMLButtonElement>(".fl-clock").click();
  assert.equal(pill.hidden, true, "the you panel is open");
  h.$<HTMLButtonElement>(".fl-clock").click();
  assert.equal(pill.hidden, false);
  h.render({
    ...withTip,
    panel: {
      place: JOBHUB,
      name: "Job Hub",
      greeting: "",
      keeper: "keeper-jobhub",
      sections: [],
    },
  });
  assert.equal(pill.hidden, true, "a panel is open");
  h.render({
    ...withTip,
    result: { title: "", lines: [], host: true, waiting: "" },
  });
  assert.equal(pill.hidden, true, "a card is up");
  h.render({ ...model, tip: undefined });
  assert.equal(pill.hidden, true);
  pill.onclick!(dom.event("click") as unknown as PointerEvent);
  assert.equal(h.plays.length, logged);
});

const LIST: ChecklistModel = {
  owner: "p1",
  items: [
    { id: "job", label: "Find a job", done: true, place: JOBHUB },
    { id: "food", label: "Buy food for the week", done: false, place: MONO },
  ],
  done: 1,
  total: 2,
  complete: false,
  hidden: false,
};

test("the Getting started checklist: starts open on a wide screen, folds, its steps walk there, and × hides it any time until the you panel brings it back", () => {
  const h = harness();
  const model = h.render();
  const card = h.$(".fl-checklist"),
    head = h.$<HTMLButtonElement>(".fl-checklist-head"),
    close = h.$<HTMLButtonElement>(".fl-checklist-close"),
    items = h.$(".fl-checklist-items");
  assert.equal(card.hidden, true, "the page adds it");
  h.render({ ...model, checklist: LIST });
  assert.equal(card.hidden, false);
  assert.equal(h.$(".fl-checklist-title").textContent, "Getting started");
  assert.equal(h.$(".fl-checklist-count").textContent, "1/2");
  assert.ok(card.classList.contains("open"));
  assert.equal(head.getAttribute("aria-expanded"), "true");
  assert.equal(items.hidden, false);
  assert.equal(close.hidden, false, "it can be hidden at any time");
  const steps = h.$$<HTMLButtonElement>(".fl-checklist-step");
  assert.deepEqual(
    steps.map((step) => [step.getAttribute("aria-label"), step.disabled]),
    [
      ["Find a job: done", true],
      ["Buy food for the week: walk to Mono Burger", false],
    ],
  );
  assert.equal(steps[0]!.parentElement!.className, "done");
  assert.equal(dom.$(".fl-checklist-mark", steps[0]!).textContent, "✓");
  steps[1]!.click();
  assert.deepEqual(h.plays.at(-1), [WALK, 1, MONO]);

  head.click();
  assert.deepEqual(h.calls.folds, [false]);
  assert.ok(!card.classList.contains("open"));
  assert.equal(items.hidden, true);
  head.click();
  assert.deepEqual(h.calls.folds, [false, true]);
  assert.equal(items.hidden, false);

  // The same steps keep their buttons; once you cannot walk they are rebuilt, disabled.
  h.render({ ...model, checklist: LIST });
  assert.equal(h.$$(".fl-checklist-step")[1], steps[1]);
  const { walk: _walk, ...stuck } = model;
  h.render({ ...stuck, checklist: LIST });
  assert.equal(
    h.$$<HTMLButtonElement>(".fl-checklist-step")[1]!.disabled,
    true,
  );

  // A panel, the you panel or a card covers it.
  h.render({
    ...model,
    checklist: LIST,
    panel: {
      place: JOBHUB,
      name: "Job Hub",
      greeting: "",
      keeper: "keeper-jobhub",
      sections: [],
    },
  });
  assert.equal(card.hidden, true);
  h.render({
    ...model,
    checklist: LIST,
    briefing: monday(harnessless()).briefing!,
  });
  assert.equal(card.hidden, true);

  const complete: ChecklistModel = {
    ...LIST,
    items: LIST.items.map((item) => ({ ...item, done: true })),
    done: 2,
    complete: true,
  };
  h.render({ ...model, checklist: complete });
  assert.equal(h.$(".fl-checklist-title").textContent, "All set!");
  assert.ok(card.classList.contains("complete"));
  const show = h.$<HTMLButtonElement>(".fl-show-checklist");
  assert.equal(show.hidden, true, "nothing to bring back");
  close.click();
  assert.deepEqual(h.calls.hides, [["p1", true]]);
  assert.equal(card.hidden, true);
  assert.equal(h.$(".fl-toast").hidden, false);
  assert.equal(
    h.$(".fl-toast").textContent,
    "Checklist hidden. Tap the clock to bring it back.",
  );
  h.$<HTMLButtonElement>(".fl-clock").click();
  assert.equal(h.$(".fl-you").hidden, false);
  assert.equal(show.hidden, false, "the you panel offers it back");
  h.render({ ...model, checklist: complete });
  assert.equal(card.hidden, true, "hidden here before the save catches up");
  show.click();
  assert.equal(h.$(".fl-you").hidden, true, "the you panel steps aside for it");
  assert.deepEqual(h.calls.hides, [
    ["p1", true],
    ["p1", false],
  ]);
  assert.equal(card.hidden, false);
  assert.equal(show.hidden, true);
  // Another player's list follows its own save.
  h.render({ ...model, checklist: { ...LIST, owner: "p2", hidden: true } });
  assert.equal(card.hidden, true);
  assert.equal(show.hidden, false);
  h.render(model);
  assert.equal(show.hidden, true);
  close.click();
  assert.equal(h.calls.hides.length, 2, "nothing to hide");
});

/** A Monday model from a match of its own (for a briefing to cover things with). */
function harnessless() {
  const match = LocalMatch.create(setup(1, 1));
  return {
    match,
    me: () => match.room.players.p1!,
    step: (n = 1) => {
      for (let k = 0; k < n; k++) match.step();
      return present(match.view(), LOCAL);
    },
  } as unknown as Harness;
}

test("the checklist's fold follows the save until the player picks, folded on a phone held upright, and works without hooks", () => {
  const saved = harness();
  saved.render({ ...saved.model(), checklist: { ...LIST, open: false } });
  assert.ok(!saved.$(".fl-checklist").classList.contains("open"));
  const phone = harness({ width: 390, height: 844, checklistHooks: false });
  const model = phone.render({ ...phone.model(), checklist: LIST });
  assert.ok(!phone.$(".fl-checklist").classList.contains("open"));
  phone.$<HTMLButtonElement>(".fl-checklist-head").click();
  assert.ok(phone.$(".fl-checklist").classList.contains("open"));
  phone.render({ ...model, checklist: { ...LIST, done: 2, complete: true } });
  phone.$<HTMLButtonElement>(".fl-checklist-close").click();
  assert.equal(phone.$(".fl-checklist").hidden, true);
});

test("a message shows as a toast when your count goes up, in its tone, and goes after 2.6 s", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const h = harness();
    const model = h.render();
    const toast = h.$(".fl-toast");
    const say = (n: number, text: string, bad = false) =>
      h.render({ ...model, toast: { owner: "p1", n, text, bad } });
    say(0, "");
    assert.equal(toast.hidden, true, "where the count starts");
    say(1, "Hired at Mono Burger!");
    assert.equal(toast.hidden, false);
    assert.equal(toast.textContent, "Hired at Mono Burger!");
    assert.equal(toast.dataset.tone, "good");
    mock.timers.tick(2000);
    say(2, "Not enough cash", true);
    assert.equal(toast.dataset.tone, "warn");
    mock.timers.tick(2599);
    assert.equal(toast.hidden, false, "the timer starts again");
    mock.timers.tick(1);
    assert.equal(toast.hidden, true);
    say(2, "Not enough cash", true);
    assert.equal(toast.hidden, true, "an old message is not shown again");
  } finally {
    mock.timers.reset();
  }
});

test("rivals in the corners and on the panels: a chip each with face, goals and what they do; gone when they leave", () => {
  const h = harness({ bots: 2 });
  const model = h.render();
  const rivals = model.scores.filter((row) => !row.you);
  const chips = () => h.$$(".fl-corners .fl-rival");
  assert.equal(chips().length, 2);
  assert.equal(h.$$(".fl-panel-standings .fl-rival").length, 2);
  assert.deepEqual(
    chips().map((chip) => chip.querySelector(".fl-rival-name")!.textContent),
    rivals.map((row) => `${row.name} · AI`),
  );
  assert.deepEqual(
    chips().map((chip) => chip.dataset.corner),
    ["0", "1"],
  );
  assert.equal(
    chips()[0]!.style.getPropertyValue("--player"),
    rivals[0]!.color,
  );
  assert.equal(
    chips()[0]!.getAttribute("aria-label"),
    `${rivals[0]!.name}: ${rivals[0]!.goals.map((goal) => `${goal.name} ${goal.value} of ${goal.goal}`).join(", ")}`,
  );
  const first = chips()[0]!;
  const face = first.querySelector(".fl-rival-face")!.firstChild;
  h.render({
    ...model,
    scores: model.scores.map((row) =>
      row.id === rivals[0]!.id
        ? {
            ...row,
            done: true,
            present: false,
            progress: 0.42,
            bot: false,
            name: "Cy",
          }
        : row.id === rivals[1]!.id
          ? { ...row, turn: "Up next", avatar: "owl" }
          : row,
    ),
  });
  assert.equal(chips()[0], first, "the same chip, updated");
  assert.ok(
    first.classList.contains("done") && first.classList.contains("away"),
  );
  assert.equal(
    first.querySelector(".fl-rival-state")!.textContent,
    "Done · 42%",
  );
  assert.equal(first.querySelector(".fl-rival-name")!.textContent, "Cy");
  assert.equal(first.querySelector(".fl-rival-face")!.firstChild, face);
  assert.match(
    chips()[1]!.querySelector(".fl-rival-state")!.textContent!,
    /^Up next · \d+%$/,
  );
  assert.equal(
    chips()[1]!.querySelector<HTMLElement>(".fl-rival-face")!.dataset.avatar,
    "owl",
  );
  h.render({
    ...model,
    scores: model.scores.filter((row) => row.id !== rivals[0]!.id),
  });
  assert.equal(chips().length, 1);
  assert.equal(chips()[0]!.dataset.corner, "0");
});

test("Monday on this device: the ticker, chart, headlines and your news; START THE WEEK (or Enter) logs READY", () => {
  const h = harness();
  h.render();
  const model = monday(h);
  const b = model.briefing!;
  const briefing = h.$(".fl-briefing");
  assert.equal(briefing.hidden, false);
  assert.ok(h.screen.game.classList.contains("modal"));
  assert.equal(h.$(".fl-clock").hidden, true);
  assert.ok(
    h.$$<HTMLButtonElement>(".fl-strip .fl-place").every((go) => go.disabled),
  );
  assert.equal(dom.$(".fl-banner", briefing).textContent, "MONDAY · WEEK 2");
  const ticks = dom.$$(".fl-tick", briefing);
  assert.deepEqual(
    ticks.map((tick) => [
      tick.querySelector("small")!.textContent,
      tick.querySelector("b")!.textContent,
      tick.classList.contains("up")
        ? true
        : tick.classList.contains("down")
          ? false
          : undefined,
    ]),
    b.ticker.map((item) => [item.label, item.value, item.up]),
  );
  assert.equal(
    h.$(".fl-chart").innerHTML.includes("<polyline"),
    sparkline(b.history, 300, 60) !== "",
  );
  assert.deepEqual(
    h.$$(".fl-headlines li").map((line) => line.textContent),
    b.headlines,
  );
  assert.equal(h.$(".fl-notices").hidden, b.notices.length === 0);
  const ready = h.$<HTMLButtonElement>(".fl-ready");
  assert.equal(ready.textContent, "START THE WEEK");
  assert.equal(
    h.$(".fl-ready-note").textContent,
    `Starts by itself in ${b.seconds}s`,
  );
  ready.click();
  assert.deepEqual(h.plays.at(-1), [READY, 2]);
  h.screen.keydown(key("Enter"));
  assert.deepEqual(h.plays.at(-1), [READY, 2]);
  assert.equal(h.plays.length, 2);

  // The same briefing keeps its chips; another one rebuilds them, with a chart once there are two weeks to draw.
  h.render(model);
  assert.equal(dom.$$(".fl-tick", briefing)[0], ticks[0]);
  h.render({
    ...model,
    briefing: {
      ...b,
      history: [100, 104, 99],
      notices: ["You were paid."],
      ready: true,
    },
  });
  assert.ok(h.$(".fl-chart").innerHTML.includes("<polyline"));
  assert.equal(h.$(".fl-notices").hidden, false);
  assert.equal(ready.textContent, "READY ✓");
  h.render({ ...model, briefing: { ...b, history: [100] } });
  assert.equal(h.$(".fl-chart").innerHTML, "");
  h.render({ ...model, readyEntry: undefined });
  assert.equal(ready.disabled, true);
});

test("Monday online: READY with how many are ready; a watcher without a seat gets no button", () => {
  const h = harness({ viewer: ONLINE });
  h.render(present(h.match.view(), LOCAL));
  const model = monday(harnessless());
  const b = model.briefing!;
  h.render({ ...model, seated: true });
  const ready = h.$<HTMLButtonElement>(".fl-ready");
  assert.equal(ready.textContent, "READY");
  assert.equal(
    h.$(".fl-ready-note").textContent,
    `${b.readyCount}/${b.total} ready · the week starts in ${b.seconds}s`,
  );
  assert.equal(ready.hidden, false);
  h.render({ ...model, seated: false });
  assert.equal(ready.hidden, true);
});

test("a handoff names who is next and starts their week; their HUD then says whose week it is", () => {
  const h = harness({ humans: 2, bots: 0 });
  const model = h.render();
  const handoff = model.handoff!;
  const card = h.$(".fl-handoff");
  assert.equal(card.hidden, false);
  assert.equal(h.$(".fl-handoff-name").textContent, handoff.name);
  assert.equal(h.$(".fl-handoff-step").textContent, `Week 1 · ${handoff.step}`);
  const go = h.$<HTMLButtonElement>(".fl-handoff-go");
  assert.equal(
    go.textContent,
    `I'M ${handoff.name.toUpperCase()}: START MY WEEK`,
  );
  assert.equal(card.style.getPropertyValue("--player"), handoff.color);
  const face = h.$(".fl-handoff-art");
  h.render(model);
  assert.equal(h.$(".fl-handoff-art"), face, "the same face");
  go.click();
  assert.deepEqual(h.plays.at(-1), model.readyEntry);
  const week = h.step();
  assert.equal(card.hidden, true);
  assert.equal(h.$(".fl-week").textContent, `WEEK 1 · ${week.hud!.name}`);
});

test("the result: title, standings and the host's buttons; a guest waits", () => {
  const h = harness();
  const model = h.render();
  const result = {
    title: "YOU WIN!",
    lines: ["1. Ada", "2. Bot 2"],
    host: true,
    waiting: "",
  };
  h.render({ ...model, result });
  assert.equal(h.$(".fl-result").hidden, false);
  assert.equal(h.$(".fl-result-title").textContent, "YOU WIN!");
  const lines = h.$$(".fl-result-lines li");
  assert.deepEqual(
    lines.map((line) => line.textContent),
    result.lines,
  );
  assert.equal(h.$(".fl-result .fl-actions").hidden, false);
  assert.equal(h.$(".fl-result .fl-ready-note").hidden, true);
  const [back, again] = h.$$<HTMLButtonElement>(
    ".fl-result .fl-actions button",
  );
  assert.deepEqual(
    [back!.textContent, again!.textContent],
    ["MENU", "PLAY AGAIN"],
  );
  again!.click();
  back!.click();
  assert.deepEqual([h.calls.again, h.calls.back], [1, 1]);
  h.render({
    ...model,
    result: { ...result, host: false, waiting: "Waiting for the host" },
  });
  assert.equal(h.$$(".fl-result-lines li")[0], lines[0], "the same lines");
  assert.equal(h.$(".fl-result .fl-actions").hidden, true);
  assert.equal(
    h.$(".fl-result .fl-ready-note").textContent,
    "Waiting for the host",
  );
});

test("each animation frame sizes the canvas to the screen and draws the board, with the camera on you", () => {
  const h = harness();
  h.render();
  const c = dom.context(h.canvas);
  h.frame();
  assert.equal(h.canvas.width, 2560, "two pixels a px");
  assert.equal(h.canvas.height, 1440);
  assert.equal(h.canvas.style.width, "1280px");
  assert.equal(h.screen.game.style.getPropertyValue("--free-y"), "6px");
  assert.equal(h.screen.game.style.getPropertyValue("--free-h"), "708px");
  const view = viewOf();
  assert.equal(
    h.screen.game.style.getPropertyValue("--panel-w"),
    `${Math.round(view.panel.w)}px`,
  );
  assert.ok(!h.screen.game.classList.contains("compact"));
  assert.deepEqual(c.named("setTransform")[0]!.args, [2, 0, 0, 2, 0, 0]);
  assert.ok(c.named("drawImage").length > 0, "the map");
  assert.deepEqual(h.camera(), centreOn(view, stepPoint(h.me().pos)));
  assert.equal(dom.pendingFrames(), 1, "and asks for the next");

  // Hidden, off the page, or with nothing to show yet: no drawing.
  c.clear();
  h.screen.game.hidden = true;
  h.frame();
  h.screen.game.hidden = false;
  dom.document.body.replaceChildren();
  h.frame();
  dom.document.body.replaceChildren(...h.screen.elements);
  h.setTiming(false);
  h.frame();
  assert.equal(c.named("drawImage").length, 0);
  h.setTiming(true);
  h.frame();
  assert.ok(c.named("drawImage").length > 0);

  // A short screen keeps its corners free; a phone held upright is compact; no pixel ratio is one.
  h.size(900, 480);
  h.frame();
  assert.ok(h.screen.game.classList.contains("short"));
  dom.window.devicePixelRatio = 0;
  h.size(390, 844);
  h.frame();
  assert.ok(h.screen.game.classList.contains("compact"));
  assert.equal(h.canvas.width, 390);
  dom.window.devicePixelRatio = 2;

  h.screen.destroy();
  h.frame();
  assert.equal(dom.pendingFrames(), 0, "destroyed: the loop stops");
});

test("the HUD's pieces keep the board's free area clear; behind a card the last measure stands", () => {
  const h = harness();
  const model = h.render();
  dom.place(h.$(".fl-clock"), { top: 10, width: 120, height: 50 });
  dom.place(h.$(".fl-end-week"), { top: 650, width: 160, height: 50 });
  dom.place(h.$(".fl-cash"), { top: 10, width: 0, height: 0 });
  h.frame();
  assert.equal(h.screen.game.style.getPropertyValue("--free-y"), "66px");
  assert.equal(
    h.screen.game.style.getPropertyValue("--free-h"),
    `${720 - 66 - 76}px`,
  );
  h.render({
    ...model,
    result: { title: "", lines: [], host: true, waiting: "" },
  });
  dom.place(h.$(".fl-clock"), { width: 0, height: 0 });
  h.frame();
  assert.equal(h.screen.game.style.getPropertyValue("--free-y"), "66px");
});

test("the camera follows you as you walk, stops at a drag, picks you up at your next walk, and keeps the middle on a resize", () => {
  const h = harness();
  h.render();
  h.frame();
  const view = viewOf();
  const start = h.camera();
  assert.deepEqual(start, centreOn(view, stepPoint(h.me().pos)));
  // The Job Hub is down the map from home: the camera eases after you.
  h.match.play([WALK, 1, JOBHUB]);
  for (let n = 0; n < 300 && h.me().inside !== JOBHUB; n++) h.match.step();
  h.step();
  const target = centreOn(view, stepPoint(h.me().pos));
  assert.ok(distance(start, target) > 0);
  h.frame(50);
  const moved = h.camera();
  assert.ok(
    distance(moved, target) < distance(start, target),
    "easing toward you",
  );
  assert.ok(distance(moved, start) > 0);

  h.pointer("pointerdown", { clientX: 600, clientY: 300 });
  h.pointer("pointermove", { clientX: 603, clientY: 302 });
  assert.ok(!h.canvas.classList.contains("dragging"), "inside the tap slop");
  h.pointer("pointermove", { clientX: 700, clientY: 340 });
  assert.ok(h.canvas.classList.contains("dragging"));
  h.frame();
  const dragged = clampCamera(view, { x: moved.x + 100, y: moved.y + 40 });
  assert.deepEqual(h.camera(), dragged);
  h.pointer("pointerup", { clientX: 700, clientY: 340 });
  assert.ok(!h.canvas.classList.contains("dragging"));
  h.step(4);
  h.frame(100);
  assert.deepEqual(h.camera(), dragged, "left where you put it");

  // Keeps the middle of the screen on the same spot of the map when the screen changes size.
  const middle = toMap(
    view,
    dragged,
    view.free.x + view.free.w / 2,
    view.free.y + view.free.h / 2,
  );
  h.size(900, 800);
  h.frame();
  const narrow = viewOf(900, 800);
  const kept = centreOn(narrow, middle);
  assert.deepEqual(h.camera(), kept);

  // A new walk: the camera follows again, all the way.
  const far = PLACES.map((_, index) => index).sort(
    (a, b) =>
      distance(centreOn(narrow, stepPoint(doorOf(b))), kept) -
      distance(centreOn(narrow, stepPoint(doorOf(a))), kept),
  )[0]!;
  h.match.play([WALK, h.match.room.week, far]);
  h.step();
  h.frame(); // a frame sees the walk start
  for (let n = 0; n < 300 && h.me().inside !== far; n++) h.match.step();
  h.step();
  for (let n = 0; n < 60; n++) h.frame(100);
  assert.deepEqual(h.camera(), centreOn(narrow, stepPoint(h.me().pos)));
  assert.notDeepEqual(h.camera(), kept);
});

test("a tap on a place walks there; a drag, a cancel or another button does not; a mouse over a place shows its hours", () => {
  const h = harness();
  h.render();
  const early = h.plays.length;
  h.pointer("pointerdown");
  h.pointer("pointerup");
  assert.equal(h.plays.length, early, "no camera yet: no taps");
  h.frame();
  const view = viewOf(),
    camera = h.camera();
  const labels = PLACES.map((place) => ({
    w: (place.name.length * 7 + 15.5 * view.scale * 1.2) / 2 / view.scale,
    h: 1,
  }));
  const onScreen = PLACES.findIndex((_, index) => {
    const at = toScreen(view, camera, CITY.places[index]!.label);
    return (
      index !== JOBHUB && at.x > 50 && at.x < 1230 && at.y > 50 && at.y < 670
    );
  });
  const at = toScreen(view, camera, CITY.places[onScreen]!.label);
  let empty: { x: number; y: number } | undefined;
  for (let x = 5; x < 1280 && !empty; x += 37)
    for (let y = 5; y < 720 && !empty; y += 29)
      if (placeAt(toMap(view, camera, x, y), labels) < 0) empty = { x, y };
  assert.ok(empty);
  const captured: number[] = [];
  Object.assign(h.canvas, {
    setPointerCapture: (id: number) => captured.push(id),
  });
  const tap = (point: { x: number; y: number }, props: object = {}) => {
    h.pointer("pointerdown", { clientX: point.x, clientY: point.y, ...props });
    h.pointer("pointerup", { clientX: point.x, clientY: point.y, ...props });
  };
  tap(at);
  assert.deepEqual(h.plays.at(-1), [WALK, 1, onScreen]);
  assert.deepEqual(captured, [1]);
  const logged = h.plays.length;
  tap(empty);
  h.pointer("pointerdown", { clientX: at.x, clientY: at.y });
  h.pointer("pointercancel", { clientX: at.x, clientY: at.y });
  h.pointer("pointerup", { clientX: at.x, clientY: at.y });
  tap(at, { button: 2 });
  assert.equal(h.plays.length, logged, "nothing walked");
  // A second finger is ignored while the first is down.
  h.pointer("pointerdown", {
    clientX: at.x,
    clientY: at.y,
    pointerType: "touch",
  });
  h.pointer("pointerdown", {
    pointerId: 2,
    clientX: 9,
    clientY: 9,
    pointerType: "touch",
  });
  h.pointer("pointermove", {
    pointerId: 2,
    clientX: 300,
    clientY: 300,
    pointerType: "touch",
  });
  h.pointer("pointerup", {
    pointerId: 2,
    clientX: 300,
    clientY: 300,
    pointerType: "touch",
  });
  h.pointer("pointerup", {
    clientX: at.x,
    clientY: at.y,
    pointerType: "touch",
  });
  assert.equal(h.plays.length, logged + 1);
  assert.deepEqual(h.plays.at(-1), [WALK, 1, onScreen]);

  const c = dom.context(h.canvas);
  const name = PLACES[onScreen]!.name;
  h.pointer("pointermove", { clientX: at.x, clientY: at.y });
  assert.equal(h.canvas.style.cursor, "pointer");
  c.clear();
  h.frame();
  assert.ok(
    c.texts().some((line) => line.startsWith(`${name} · `)),
    "its walking hours",
  );
  h.pointer("pointerleave", { pointerType: "touch" });
  h.pointer("pointermove", {
    clientX: empty.x,
    clientY: empty.y,
    pointerType: "touch",
  });
  assert.equal(h.canvas.style.cursor, "pointer", "a touch does not hover");
  h.pointer("pointerdown", { clientX: empty.x, clientY: empty.y });
  h.pointer("pointerleave");
  h.pointer("pointerup", { clientX: empty.x, clientY: empty.y });
  h.pointer("pointerleave");
  c.clear();
  h.frame();
  assert.ok(c.texts().includes(name), "no longer hovered");
  h.pointer("pointermove", { clientX: empty.x, clientY: empty.y });
  assert.equal(h.canvas.style.cursor, "");
  const { walk: _walk, ...stuck } = h.model();
  h.render(stuck);
  h.pointer("pointermove", { clientX: at.x, clientY: at.y });
  assert.equal(h.canvas.style.cursor, "", "nowhere to walk now");
});

test("the wheel pans the board, except with ctrl (the browser zooms)", () => {
  const h = harness();
  h.render();
  const early = dom.event("wheel", { deltaX: 0, deltaY: 40, ctrlKey: false });
  h.canvas.dispatchEvent(early);
  assert.equal(early.defaultPrevented, false, "no camera yet");
  h.frame();
  const view = viewOf(),
    before = h.camera();
  const wheel = dom.event("wheel", { deltaX: 30, deltaY: 40, ctrlKey: false });
  h.canvas.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, true);
  h.frame();
  const after = clampCamera(view, { x: before.x - 30, y: before.y - 40 });
  assert.deepEqual(h.camera(), after);
  h.canvas.dispatchEvent(
    dom.event("wheel", { deltaX: 0, deltaY: 200, ctrlKey: true }),
  );
  h.frame();
  assert.deepEqual(h.camera(), after);
});

test("the tour: NEXT and BACK step through its cards, the last says LET'S GO, and SKIP or Escape end it", () => {
  const h = harness();
  const model = walkInto(h, JOBHUB);
  h.$<HTMLButtonElement>(".fl-clock").click();
  h.render(model);
  h.frame();
  const steps = tourSteps(h.match.view());
  dom.place(h.$(".fl-clock"), { left: 10, top: 10, width: 200, height: 50 });
  let done = 0;
  h.screen.tour(steps, () => done++);
  assert.equal(h.screen.touring(), true);
  assert.equal(placePanel(h).hidden, true, "the tour clears the board");
  assert.equal(h.$(".fl-you").hidden, true);
  const under = [...h.screen.game.children].filter(
    (part) => !part.classList.contains("fl-tour"),
  );
  assert.ok(under.length > 0);
  assert.ok(
    under.every((part) => part.hasAttribute("inert")),
    "nothing under the tour takes a tap or focus",
  );
  const layer = h.$(".fl-tour"),
    next = h.$<HTMLButtonElement>(".fl-tour-next"),
    back = h.$<HTMLButtonElement>(".fl-tour-back"),
    skip = h.$<HTMLButtonElement>(".fl-tour-skip");
  const at = () => h.$(".fl-tour-count").textContent;
  assert.equal(layer.hidden, false);
  assert.equal(at(), `1 of ${steps.length}`);
  assert.equal(h.$(".fl-tour-title").textContent, steps[0]!.title);
  assert.equal(h.$(".fl-tour-body").textContent, steps[0]!.body);
  assert.ok(layer.classList.contains("plain"), "the welcome points at nothing");
  assert.equal(back.hidden, true);
  assert.equal(skip.hidden, false);
  assert.equal(next.textContent, "NEXT");
  next.click();
  assert.equal(at(), `2 of ${steps.length}`);
  assert.equal(back.hidden, false);
  assert.ok(!layer.classList.contains("plain"));
  back.click();
  assert.equal(at(), `1 of ${steps.length}`);
  h.screen.keydown(key("ArrowLeft"));
  assert.equal(at(), `1 of ${steps.length}`, "nothing before the first");
  h.screen.keydown(key("ArrowRight"));
  h.screen.keydown(key("Enter"));
  assert.equal(at(), `3 of ${steps.length}`);
  h.screen.keydown(key("ArrowLeft"));
  h.screen.keydown(key("p"));
  assert.equal(at(), `2 of ${steps.length}`);
  for (let n = 2; n < steps.length; n++) next.click();
  assert.equal(at(), `${steps.length} of ${steps.length}`);
  assert.equal(next.textContent, "LET'S GO");
  assert.equal(skip.hidden, true);
  const logged = h.plays.length;
  next.click();
  assert.equal(done, 1);
  assert.equal(h.screen.touring(), false);
  assert.equal(layer.hidden, true);
  assert.ok(under.every((part) => !part.hasAttribute("inert")));
  assert.equal(
    h.plays.length,
    logged,
    "the tour's keys and buttons never play",
  );

  h.screen.tour(steps, () => done++);
  skip.click();
  assert.equal(done, 2);
  h.screen.tour(steps, () => done++);
  h.screen.keydown(key("Escape"));
  assert.equal(done, 3);
  assert.equal(h.screen.touring(), false);
  h.screen.tour([], () => done++);
  assert.equal(done, 4, "an empty tour is over at once");
  assert.equal(h.screen.touring(), false);
});

test("a tour card spotlights its HUD piece and sits below or above it, else along the far edge; with nothing to point at it sits in the middle", () => {
  const h = harness();
  h.render();
  h.frame();
  const card = h.$(".fl-tour-card"),
    spot = h.$(".fl-tour-spot");
  dom.place(card, { width: 300, height: 200 });
  dom.place(h.$(".fl-clock"), { left: 10, top: 10, width: 200, height: 50 });
  dom.place(h.$(".fl-hud-goals"), {
    left: 500,
    top: 600,
    width: 200,
    height: 50,
  });
  const steps: TourStep[] = [
    { title: "Your week", body: "", hud: "clock" },
    { title: "Your goals", body: "", hud: "goals" },
    { title: "Tips", body: "", hud: "tip" },
    { title: "Your move", body: "" },
  ];
  h.screen.tour(steps, () => {});
  assert.equal(spot.hidden, false);
  assert.equal(spot.style.transform, "translate(4px, 4px)");
  assert.equal(spot.style.width, "212px");
  assert.equal(spot.style.height, "62px");
  assert.equal(card.dataset.at, "near");
  assert.equal(card.style.top, "78px", "just below");
  assert.equal(card.style.left, "162px", "kept on the screen");

  h.screen.keydown(key("ArrowRight"));
  assert.equal(card.dataset.at, "near");
  assert.equal(card.style.top, "382px", "no room below: just above");
  assert.equal(card.style.left, "600px");

  // A card too tall for either side goes along the far edge, and moves as the frames go.
  dom.place(card, { width: 300, height: 700 });
  h.frame();
  assert.equal(card.dataset.at, "top");
  assert.equal(card.style.top, "");
  h.screen.keydown(key("ArrowLeft"));
  assert.equal(card.dataset.at, "bottom");

  h.screen.keydown(key("ArrowRight"));
  h.screen.keydown(key("ArrowRight"));
  assert.equal(
    spot.hidden,
    true,
    "the tip is not on screen: nothing to spotlight",
  );
  assert.ok(
    h.$(".fl-tour").classList.contains("plain"),
    "so the whole board dims",
  );
  assert.equal(card.dataset.at, "middle");
  assert.equal(card.style.left, "");
  h.screen.keydown(key("ArrowRight"));
  assert.equal(card.dataset.at, "middle");
  assert.ok(h.$(".fl-tour").classList.contains("plain"));
});

test("a tour card framing places spotlights them and the camera glides there; once the tour ends it follows you again", () => {
  const h = harness();
  h.render();
  const steps: TourStep[] = [
    { title: "Eat", body: "", places: [FRESHCO, KEYNEST] },
    { title: "Find a job", body: "", places: [JOBHUB] },
    { title: "Your move", body: "" },
  ];
  h.screen.tour(steps, () => {});
  assert.equal(
    h.$(".fl-tour-card").dataset.at,
    "middle",
    "no board yet to frame it on",
  );
  h.frame();
  const view = viewOf();
  dom.place(h.$(".fl-tour-card"), { width: 300, height: 200 });
  const glide = (places: number[]) => {
    const target = centreOn(view, tourFocus(places)!);
    let last = distance(h.camera(), target);
    for (let n = 0; n < 60; n++) {
      h.frame(100);
      const now = distance(h.camera(), target);
      assert.ok(now <= last, "always closer");
      last = now;
    }
    assert.equal(last, 0, "there");
  };
  glide([FRESHCO, KEYNEST]);
  const spot = h.$(".fl-tour-spot");
  assert.equal(spot.hidden, false);
  const [x, y] = /translate\((-?\d+)px, (-?\d+)px\)/
    .exec(spot.style.transform)!
    .slice(1)
    .map(Number);
  assert.ok(
    x! >= view.free.x + 4 && y! >= view.free.y + 4,
    "inside the free board",
  );
  assert.notEqual(h.$(".fl-tour-card").dataset.at, "middle");
  h.screen.keydown(key("ArrowRight"));
  glide([JOBHUB]);
  h.screen.keydown(key("ArrowRight"));
  h.screen.keydown(key("ArrowRight"));
  assert.equal(h.screen.touring(), false);
  const you = centreOn(view, stepPoint(h.me().pos));
  const before = distance(h.camera(), you);
  assert.ok(before > 0, "the Job Hub is away from home");
  h.frame(100);
  assert.ok(distance(h.camera(), you) < before, "back to you");
});

test("keys: Escape closes the you panel, then the place panel; Enter taps READY when there is one", () => {
  const h = harness();
  const model = walkInto(h, JOBHUB);
  h.$<HTMLButtonElement>(".fl-clock").click();
  h.screen.keydown(key("Escape"));
  assert.equal(h.$(".fl-you").hidden, true);
  assert.equal(placePanel(h).hidden, false);
  h.screen.keydown(key("Escape"));
  assert.equal(placePanel(h).hidden, true);
  const logged = h.plays.length;
  h.screen.keydown(key("Escape"));
  h.screen.keydown(key("Enter"));
  h.screen.keydown(key("x"));
  assert.equal(h.plays.length, logged, "no READY in the week");
  h.render({ ...model, panel: undefined });
  h.screen.keydown(key("Escape"));
  assert.equal(h.plays.length, logged);
});
