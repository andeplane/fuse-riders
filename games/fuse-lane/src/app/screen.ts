import { button, el } from "fuse-ui";
import {
  CITY,
  GOAL_NAMES,
  PLACES,
  type FuseLaneView,
  type MapPoint,
} from "../game/index.js";
import type { Art } from "./art.js";
import { FONT, drawBoard, labelFont, type BoardFrame } from "./board.js";
import { BURST } from "./ambience.js";
import {
  boardView,
  centreOn,
  clampCamera,
  easeCamera,
  placeAt,
  SHORT,
  toMap,
  toScreen,
  walkerAt,
  type BoardView,
  type Camera,
  type Insets,
  type LabelSize,
  type Rect,
} from "./layout.js";
import {
  boardModel,
  sparkline,
  toastTracker,
  type Card,
  type GoalBar,
  type PanelModel,
  type ScoreRow,
  type ScreenModel,
  type Viewer,
} from "./presenter.js";
import { tourArea, tourFocus, type TourHud, type TourStep } from "./tour.js";

/**
 * The game screen, shared by a match on this device and an online room. The city's map fills the screen; a slim HUD
 * floats over its edges (hours, money, goals, CALL IT A WEEK, pause and menu); everything else opens in the middle
 * of the board: the place panels, the "you" panel, the Monday briefing, the hot-seat handoff and the result. On a
 * wide screen the rivals sit in the corners; on a phone they show at the top of every place panel. The camera follows
 * this device's player and can be dragged (on a phone held upright the map is as tall as the screen and pans
 * sideways); a tap on a building walks there. It renders a `ScreenModel` and hands every tap back as a play entry
 * body; the board is drawn each animation frame from the driver's two newest frames.
 */
export interface Driver {
  play(body: readonly unknown[]): boolean;
  frameTiming():
    { older?: FuseLaneView; newer: FuseLaneView; tick: number } | undefined;
}

export interface ScreenHooks {
  /** The result's buttons: what they say and do (online: REMATCH / LOBBY; on this device: PLAY AGAIN / MENU). */
  again: { label: string; run(): void };
  back: { label: string; run(): void };
  /** Small buttons for the HUD's corner (pause, menu, leave). */
  controls?: HTMLElement[];
  /** The "Getting started" checklist was folded or unfolded, or hidden or brought back. */
  checklist?: {
    fold(open: boolean): void;
    hide(owner: string, hidden: boolean): void;
  };
}

export const money = (value: number) =>
  `${value < 0 ? "-" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

/**
 * A little "+$40" or "+2" that rises out of a HUD piece and fades, and a bump of the piece itself: the feedback
 * for a change the player caused. Restarts the bump when changes come quickly.
 */
export function pop(host: HTMLElement, label: string, className: string): void {
  const chip = el("span", label, className);
  chip.setAttribute("aria-hidden", "true");
  host.append(chip);
  setTimeout(() => chip.remove(), 1300);
  host.classList.remove("bump");
  void host.offsetWidth;
  host.classList.add("bump");
}

/** Sets text only when it changed, so a per-frame render leaves the DOM (and a screen reader) alone. */
export function text(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

const GOAL_ICONS = ["ui-wealth", "ui-happiness", "ui-education", "ui-career"];
const share = (goal: GoalBar) =>
  Math.min(1, goal.value / Math.max(1, goal.goal));

/** Four goal bars: icon, name, a meter and "value / goal". */
function createGoalBars(art: Art, className: string) {
  const element = el("div", "", `fl-goals ${className}`);
  const rows = GOAL_NAMES.map((name, index) => {
    const row = el("div", "", "fl-goal"),
      icon = art.element(GOAL_ICONS[index]!, 20),
      label = el("span", name, "fl-goal-name"),
      meter = el("span", "", "fl-goal-meter"),
      fill = el("i"),
      value = el("b", "", "fl-goal-value");
    meter.append(fill);
    row.append(icon, label, meter, value);
    element.append(row);
    return { row, fill, value };
  });
  return {
    element,
    render(goals: readonly GoalBar[]) {
      goals.forEach((goal, index) => {
        const row = rows[index]!;
        row.fill.style.width = `${(share(goal) * 100).toFixed(1)}%`;
        row.row.classList.toggle("met", goal.met);
        text(row.value, `${goal.value}/${goal.goal}`);
      });
    },
  };
}

/** The HUD's goals: four little progress rings with their icon inside and the value under or beside. */
function createGoalRings(art: Art) {
  const element = el("div", "", "fl-hud-goals");
  const rings = GOAL_NAMES.map((name, index) => {
    const item = el("div", "", "fl-goal-ring"),
      dial = el("span", "", "fl-dial"),
      value = el("b", "");
    dial.append(art.element(GOAL_ICONS[index]!, 18));
    item.append(dial, value);
    item.title = name;
    element.append(item);
    return { item, dial, value, name };
  });
  let owner = "";
  const seen: number[] = [];
  return {
    element,
    /** `who` is whose goals they are: a gain bumps the ring, but a new player's goals simply show. */
    render(goals: readonly GoalBar[], who = "") {
      const same = who === owner;
      owner = who;
      goals.forEach((goal, index) => {
        const ring = rings[index]!;
        const gain = goal.value - (seen[index] ?? goal.value);
        seen[index] = goal.value;
        if (same && gain > 0) pop(ring.item, `+${gain}`, "fl-pop good");
        ring.dial.style.setProperty("--share", share(goal).toFixed(3));
        ring.item.classList.toggle("met", goal.met);
        text(ring.value, `${goal.value}/${goal.goal}`);
        ring.item.setAttribute(
          "aria-label",
          `${ring.name} ${goal.value} of ${goal.goal}`,
        );
      });
    },
  };
}

/** The rivals: a portrait, four tiny goal bars and what they are doing, one chip each. */
function createStandings(art: Art, className: string) {
  const element = el("div", "", `fl-standings ${className}`);
  element.setAttribute("aria-label", "Rivals");
  const chips = new Map<string, ReturnType<typeof chip>>();
  function chip() {
    const root = el("article", "", "fl-rival"),
      face = el("span", "", "fl-rival-face"),
      name = el("strong", "", "fl-rival-name"),
      state = el("small", "", "fl-rival-state"),
      bars = el("span", "", "fl-rival-bars"),
      fills = GOAL_NAMES.map(() => {
        const bar = el("i"),
          fill = el("b");
        bar.append(fill);
        bars.append(bar);
        return fill;
      });
    const words = el("span", "", "fl-rival-words");
    words.append(name, state);
    root.append(face, words, bars);
    element.append(root);
    return { root, face, name, state, fills };
  }
  return {
    element,
    render(scores: readonly ScoreRow[]) {
      const rivals = scores.filter((score) => !score.you);
      for (const [id, row] of chips)
        if (!rivals.some((score) => score.id === id)) {
          row.root.remove();
          chips.delete(id);
        }
      rivals.forEach((score, index) => {
        let row = chips.get(score.id);
        if (!row) {
          row = chip();
          chips.set(score.id, row);
        }
        row.root.style.setProperty("--player", score.color);
        row.root.style.order = String(index);
        row.root.dataset.corner = String(index);
        row.root.classList.toggle("done", score.done);
        row.root.classList.toggle("away", !score.present);
        if (row.face.dataset.avatar !== score.avatar) {
          row.face.dataset.avatar = score.avatar;
          row.face.replaceChildren(
            art.element(`avatar-${score.avatar}-portrait`, 34),
          );
        }
        text(row.name, score.bot ? `${score.name} · AI` : score.name);
        const state = score.turn || (score.done ? "Done" : "");
        text(
          row.state,
          `${state}${state ? " · " : ""}${Math.round(score.progress * 100)}%`,
        );
        score.goals.forEach((goal, k) => {
          row.fills[k]!.style.width = `${(share(goal) * 100).toFixed(1)}%`;
        });
        row.root.setAttribute(
          "aria-label",
          `${score.name}: ${score.goals.map((goal) => `${goal.name} ${goal.value} of ${goal.goal}`).join(", ")}`,
        );
      });
    },
  };
}

export interface ScreenOptions {
  /** Draw the street graph and the tap outlines over the map (`?debug-roads`). */
  debugRoads?: boolean;
}

/** A pointer that moved less than this (px) between down and up is a tap, not a drag. */
const TAP_SLOP = 8;

export function createGameScreen(
  art: Art,
  viewer: Viewer,
  driver: () => Driver,
  hooks: ScreenHooks,
  options: ScreenOptions = {},
) {
  const play = (body: readonly unknown[] | undefined) => {
    if (body) driver().play(body);
  };
  const game = el("section", "", "fl-game");

  // ---- the board ----
  const stage = el("div", "", "fl-stage"),
    canvas = el("canvas"),
    context = canvas.getContext("2d")!;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "The city: tap a building to walk there");
  stage.append(canvas);
  // For keyboards and screen readers (the board is a picture): one button per place, out of sight.
  const strip = el("nav", "", "fl-strip");
  strip.setAttribute("aria-label", "Places");
  const stripButtons = PLACES.map((place, index) => {
    const go = button(place.name, "fl-place");
    go.onclick = () => walk(index);
    strip.append(go);
    return go;
  });

  // ---- HUD ----
  const hud = el("header", "", "fl-hud"),
    youButton = button("", "fl-clock"),
    dial = el("span", "", "fl-clock-dial"),
    hoursText = el("b", ""),
    clockWords = el("span", "", "fl-clock-words"),
    weekLabel = el("strong", "", "fl-week"),
    timerText = el("small", "", "fl-timer-text"),
    badge = el("i", "", "fl-badge"),
    cash = el("div", "", "fl-money"),
    cashValue = el("b", "", "fl-cash"),
    bankValue = el("small", "", "fl-bank"),
    endWeek = button("CALL IT A WEEK", "fl-end-week"),
    controls = el("div", "", "fl-controls");
  youButton.setAttribute("aria-label", "You: hours left and your week");
  dial.append(hoursText, el("small", "h"));
  clockWords.append(weekLabel, timerText);
  youButton.append(dial, clockWords, badge);
  cash.append(cashValue, bankValue);
  const hudGoals = createGoalRings(art);
  controls.append(...(hooks.controls ?? []));
  hud.append(youButton, cash, hudGoals.element, endWeek, controls);
  endWeek.onclick = () => play(model?.endWeekEntry);
  // The cash counts to its new value and says by how much; a new player's (or a new turn's) cash simply shows.
  let cashOwner = "",
    cashShown = 0,
    cashTarget = 0,
    cashTween = 0;
  const showCash = (owner: string, value: number) => {
    if (owner === cashOwner && value === cashTarget) return;
    const same = owner === cashOwner;
    cashOwner = owner;
    cancelAnimationFrame(cashTween);
    cashTween = 0;
    if (!same) {
      cashShown = cashTarget = value;
      text(cashValue, money(value));
      return;
    }
    const delta = value - cashTarget;
    pop(
      cash,
      `${delta > 0 ? "+" : "−"}${money(Math.abs(delta))}`,
      `fl-pop ${delta > 0 ? "good" : "bad"}`,
    );
    const from = cashShown,
      start = performance.now();
    cashTarget = value;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / 500);
      cashShown = from + (value - from) * (1 - (1 - t) ** 3);
      text(cashValue, money(t < 1 ? cashShown : value));
      cashTween = t < 1 ? requestAnimationFrame(step) : 0;
    };
    cashTween = requestAnimationFrame(step);
  };

  // ---- rivals in the corners (wide screens) ----
  const rivals = createStandings(art, "fl-corners");

  // ---- the middle of the board: every panel and card opens here ----
  const centre = el("div", "", "fl-centre");

  const panel = el("section", "", "fl-panel"),
    panelHead = el("header", "", "fl-panel-head"),
    panelKeeper = el("div", "", "fl-keeper"),
    panelName = el("h2", "", "fl-banner"),
    panelGreeting = el("p", "", "fl-greeting"),
    panelBuilding = el("div", "", "fl-panel-building"),
    panelClose = button("×", "fl-close"),
    panelBody = el("div", "", "fl-panel-body");
  panelClose.setAttribute("aria-label", "Back to the street");
  const panelTitles = el("div", "", "fl-panel-titles");
  panelTitles.append(panelName, panelGreeting);
  panelBuilding.setAttribute("aria-hidden", "true");
  panelHead.append(panelKeeper, panelTitles, panelBuilding, panelClose);
  const panelStandings = createStandings(art, "fl-panel-standings");
  panel.append(panelHead, panelStandings.element, panelBody);
  panel.hidden = true;
  let hiddenPanel = "",
    panelKey = "";
  const panelId = (view: PanelModel) => `${viewer.me}:${view.place}`;
  panelClose.onclick = () => hidePanel();
  function hidePanel(): void {
    if (model?.panel) hiddenPanel = panelId(model.panel);
    panel.hidden = true;
  }

  // The "you" panel: what the HUD leaves out.
  const you = el("section", "", "fl-panel fl-you"),
    youHead = el("header", "", "fl-panel-head"),
    youFace = el("div", "", "fl-keeper fl-you-face"),
    youName = el("h2", "", "fl-banner"),
    youWhere = el("p", "", "fl-greeting"),
    youClose = button("×", "fl-close"),
    youBody = el("div", "", "fl-panel-body"),
    youMoney = el("div", "", "fl-you-money"),
    youJob = el("p", "", "fl-job"),
    youChips = el("div", "", "fl-chips"),
    youNews = el("ul", "", "fl-news"),
    youTips = el("section", "", "fl-tips"),
    youTipList = el("ul"),
    youShowList = button("Show the checklist", "fl-show-checklist"),
    youGoals = createGoalBars(art, "fl-you-goals");
  youTips.append(el("h3", "Tips", "fl-tips-title"), youTipList);
  youClose.setAttribute("aria-label", "Close");
  const youTitles = el("div", "", "fl-panel-titles");
  youTitles.append(youName, youWhere);
  youHead.append(youFace, youTitles, youClose);
  youBody.append(
    youMoney,
    youJob,
    youChips,
    youTips,
    youShowList,
    youGoals.element,
    youNews,
  );
  you.append(youHead, youBody);
  you.hidden = true;
  let youOpen = false,
    newsSeen = "";
  youButton.onclick = () => {
    youOpen = !youOpen;
    if (model) render(model);
  };
  youClose.onclick = () => {
    youOpen = false;
    if (model) render(model);
  };

  // Monday briefing.
  const briefing = el("section", "", "fl-sheet fl-briefing"),
    briefingTitle = el("h2", "", "fl-banner"),
    briefingTicker = el("div", "", "fl-ticker"),
    briefingChart = el("div", "", "fl-chart"),
    briefingHeadlines = el("ul", "", "fl-headlines"),
    briefingNotices = el("ul", "", "fl-notices"),
    readyButton = button("READY", "fl-primary fl-ready"),
    readyNote = el("p", "", "fl-ready-note");
  const briefingBody = el("div", "", "fl-sheet-body");
  briefingBody.append(
    briefingTicker,
    briefingChart,
    briefingHeadlines,
    briefingNotices,
  );
  const briefingFoot = el("footer", "", "fl-sheet-foot");
  briefingFoot.append(readyNote, readyButton);
  briefing.append(briefingTitle, briefingBody, briefingFoot);
  briefing.hidden = true;
  readyButton.onclick = () => play(model?.readyEntry);

  // Hot-seat handoff: the next player's card; the last player's HUD and panels are gone.
  const handoff = el("section", "", "fl-sheet fl-handoff"),
    handoffAvatar = el("div", "", "fl-handoff-avatar"),
    handoffPass = el("p", "PASS THE DEVICE TO", "fl-handoff-pass"),
    handoffName = el("h2", "", "fl-handoff-name"),
    handoffStep = el("p", "", "fl-handoff-step"),
    handoffGo = button("", "fl-primary fl-handoff-go"),
    handoffNote = el("p", "", "fl-handoff-note");
  handoff.append(
    handoffAvatar,
    handoffPass,
    handoffName,
    handoffStep,
    handoffGo,
    handoffNote,
  );
  handoff.hidden = true;
  handoffGo.onclick = () => play(model?.readyEntry);

  // Result.
  const result = el("section", "", "fl-sheet fl-result"),
    resultTitle = el("h2", "", "fl-banner fl-result-title"),
    resultLines = el("ol", "", "fl-result-lines"),
    again = button(hooks.again.label, "fl-primary"),
    back = button(hooks.back.label),
    resultWaiting = el("p", "", "fl-ready-note"),
    resultActions = el("div", "", "fl-actions");
  resultActions.append(back, again);
  result.append(resultTitle, resultLines, resultWaiting, resultActions);
  result.hidden = true;
  again.onclick = () => hooks.again.run();
  back.onclick = () => hooks.back.run();

  centre.append(panel, you, briefing, handoff, result);
  const toast = el("div", "", "fl-toast");
  toast.hidden = true;
  // The "Getting started" checklist: a corner card that ticks itself off; a tap on a step walks you there.
  const checklist = el("section", "", "fl-checklist"),
    checkHead = button("", "fl-checklist-head"),
    checkTitle = el("strong", "", "fl-checklist-title"),
    checkCount = el("span", "", "fl-checklist-count"),
    checkClose = button("×", "fl-checklist-close"),
    checkItems = el("ul", "", "fl-checklist-items");
  checkHead.append(checkTitle, checkCount);
  checkClose.setAttribute("aria-label", "Hide the checklist");
  checklist.append(checkHead, checkClose, checkItems);
  checklist.hidden = true;
  let checkOpen: boolean | undefined,
    checkKey = "";
  // Hidden or shown here, ahead of the model catching up.
  const checkHidden = new Map<string, boolean>();
  const hideList = (hidden: boolean): void => {
    const owner = model?.checklist?.owner;
    if (owner === undefined) return;
    checkHidden.set(owner, hidden);
    hooks.checklist?.hide(owner, hidden);
    if (model) render(model);
  };
  checkHead.onclick = () => {
    checkOpen = !checklist.classList.contains("open");
    hooks.checklist?.fold(checkOpen);
    if (model) render(model);
  };
  checkClose.onclick = () => hideList(true);
  youShowList.onclick = () => hideList(false);
  function renderChecklist(next: ScreenModel, covered: boolean): void {
    const list = next.checklist;
    const hidden = list ? (checkHidden.get(list.owner) ?? list.hidden) : false;
    youShowList.hidden = !hidden;
    checklist.hidden = !list || covered || hidden;
    if (!list || checklist.hidden) return;
    // Until the player chooses, it starts open on a wide screen and folded on a phone held upright (the layout's
    // `compact`), where the map is narrow.
    const box = game.getBoundingClientRect();
    const open =
      checkOpen ?? list.open ?? !(box.width < 700 && box.height > box.width);
    text(checkTitle, list.complete ? "All set!" : "Getting started");
    text(checkCount, `${list.done}/${list.total}`);
    checkHead.setAttribute("aria-expanded", String(open));
    checklist.classList.toggle("open", open);
    checklist.classList.toggle("complete", list.complete);
    checkItems.hidden = !open;
    const key = JSON.stringify([list.items, Boolean(next.walk)]);
    if (key === checkKey) return;
    checkKey = key;
    checkItems.replaceChildren(
      ...list.items.map((item) => {
        const row = el("li", "", item.done ? "done" : "");
        const go = button("", "fl-checklist-step");
        go.append(
          el("i", item.done ? "✓" : "", "fl-checklist-mark"),
          item.label,
        );
        go.disabled = item.done || !next.walk;
        go.setAttribute(
          "aria-label",
          item.done
            ? `${item.label}: done`
            : `${item.label}: walk to ${PLACES[item.place]!.name}`,
        );
        go.onclick = () => walk(item.place);
        row.append(go);
        return row;
      }),
    );
  }

  // The most pressing tip, on the board while you stand in the street; a tap walks you there.
  const tip = button("", "fl-tip"),
    tipText = el("span", "", "fl-tip-text");
  tip.append(el("b", "TIP", "fl-tip-badge"), tipText);
  tip.hidden = true;
  tip.onclick = () => {
    const place = model?.tip?.place ?? -1;
    if (place >= 0) walk(place);
  };

  // ---- the tour: a card that points at a HUD piece or frames places on the map, over everything else ----
  const tourLayer = el("div", "", "fl-tour"),
    tourSpot = el("div", "", "fl-tour-spot"),
    tourCard = el("section", "", "fl-sheet fl-tour-card"),
    tourCount = el("small", "", "fl-tour-count"),
    tourTitle = el("h2", "", "fl-tour-title"),
    tourBody = el("p", "", "fl-tour-body"),
    tourSkip = button("SKIP", "fl-tour-skip"),
    tourBack = button("BACK", "fl-tour-back"),
    tourNext = button("NEXT", "fl-primary fl-tour-next"),
    tourActions = el("div", "", "fl-tour-actions");
  tourCard.setAttribute("role", "dialog");
  tourCard.setAttribute("aria-live", "polite");
  tourActions.append(tourSkip, tourBack, tourNext);
  tourCard.append(tourCount, tourTitle, tourBody, tourActions);
  tourLayer.append(tourSpot, tourCard);
  tourLayer.hidden = true;
  const tourTargets: Record<TourHud, HTMLElement> = {
    clock: youButton,
    goals: hudGoals.element,
    tip,
    list: checklist,
  };
  let tour: { steps: TourStep[]; index: number; done: () => void } | undefined;
  /** Where the camera heads while a tour card frames places, in map px. */
  let tourAt: MapPoint | undefined;
  function showTourStep(): void {
    if (!tour) return;
    const step = tour.steps[tour.index]!,
      last = tour.index === tour.steps.length - 1;
    text(tourCount, `${tour.index + 1} of ${tour.steps.length}`);
    text(tourTitle, step.title);
    text(tourBody, step.body);
    text(tourNext, last ? "LET'S GO" : "NEXT");
    tourBack.hidden = tour.index === 0;
    tourSkip.hidden = last;
    tourAt = tourFocus(step.places ?? []);
    tourLayer.classList.toggle("plain", !step.hud && !step.places?.length);
    placeTourSpot();
    tourNext.focus({ preventScroll: true });
  }
  function endTour(): void {
    const finished = tour;
    tour = undefined;
    tourAt = undefined;
    tourLayer.hidden = true;
    follow = true;
    finished?.done();
  }
  function stepTour(by: number): void {
    if (!tour) return;
    const next = tour.index + by;
    if (next >= tour.steps.length) return endTour();
    tour.index = Math.max(0, next);
    showTourStep();
  }
  tourNext.onclick = () => stepTour(1);
  tourBack.onclick = () => stepTour(-1);
  tourSkip.onclick = () => endTour();
  /** Moves the spotlight onto this card's target (each frame, as the camera glides) and puts the card out of its way. */
  function placeTourSpot(): void {
    if (!tour) return;
    const step = tour.steps[tour.index]!;
    const box = game.getBoundingClientRect(),
      area = tourArea(step.places ?? []);
    let spot: Rect | undefined;
    if (step.hud) {
      const rect = tourTargets[step.hud].getBoundingClientRect();
      if (rect.width > 0)
        spot = {
          x: rect.left - box.left - 6,
          y: rect.top - box.top - 6,
          w: rect.width + 12,
          h: rect.height + 12,
        };
    } else if (area && view && camera) {
      const from = toScreen(view, camera, [area.x, area.y]),
        to = toScreen(view, camera, [area.x + area.w, area.y + area.h]);
      spot = {
        x: from.x - 8,
        y: from.y - 8,
        w: to.x - from.x + 16,
        h: to.y - from.y + 16,
      };
    }
    tourSpot.hidden = !spot;
    if (!spot) {
      tourCard.dataset.at = "middle";
      tourCard.style.left = tourCard.style.top = "";
      return;
    }
    // Kept on screen: two places far apart, or one by the edge the camera cannot pass, are framed up to the edge of
    // the board the HUD leaves free.
    const edge: Rect =
      area && view ? view.free : { x: 0, y: 0, w: box.width, h: box.height };
    const left = Math.max(edge.x + 4, spot.x),
      top = Math.max(edge.y + 4, spot.y),
      right = Math.min(edge.x + edge.w - 4, spot.x + spot.w),
      bottom = Math.min(edge.y + edge.h - 4, spot.y + spot.h);
    tourSpot.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    tourSpot.style.width = `${Math.round(Math.max(0, right - left))}px`;
    tourSpot.style.height = `${Math.round(Math.max(0, bottom - top))}px`;
    // The card sits just below or above the spotlight when it fits there, else along the far edge of the screen.
    const width = tourCard.offsetWidth,
      height = tourCard.offsetHeight,
      gap = 12;
    let at = bottom + gap + height <= box.height - gap ? bottom + gap : -1;
    if (at < 0 && top - gap - height >= gap) at = top - gap - height;
    tourCard.dataset.at =
      at >= 0 ? "near" : (top + bottom) / 2 < box.height / 2 ? "bottom" : "top";
    tourCard.style.top = at >= 0 ? `${Math.round(at)}px` : "";
    const middle = Math.min(
      Math.max((left + right) / 2, width / 2 + gap),
      box.width - width / 2 - gap,
    );
    tourCard.style.left = `${Math.round(middle)}px`;
  }

  game.append(
    stage,
    strip,
    rivals.element,
    centre,
    hud,
    checklist,
    tip,
    toast,
    tourLayer,
  );

  let model: ScreenModel | undefined;
  function walk(place: number): void {
    if (!model?.walk) return;
    youOpen = false;
    hiddenPanel = "";
    if (model.panel?.place === place) {
      render(model);
      return;
    }
    play(model.walk(place));
  }

  function renderCard(card: Card): HTMLElement {
    const root = button("", "fl-card");
    root.disabled = !card.enabled || !card.entry;
    root.dataset.key = card.key;
    const body = el("span", "", "fl-card-body");
    body.append(el("strong", card.title, "fl-card-title"));
    if (card.detail) body.append(el("small", card.detail, "fl-card-detail"));
    if (card.note) body.append(el("em", card.note, "fl-card-note"));
    const meta = el("span", "", "fl-card-meta");
    if (card.price) meta.append(el("b", card.price, "fl-card-price"));
    if (card.hours) meta.append(el("i", card.hours, "fl-card-hours"));
    root.append(
      art.element(card.icon || "ui-week", 40, "fl-card-icon"),
      body,
      meta,
    );
    root.onclick = () => play(card.entry);
    return root;
  }
  function renderPanel(view: PanelModel | undefined, blocked: boolean): void {
    if (!view || hiddenPanel === panelId(view) || blocked) {
      panel.hidden = true;
      if (!view) hiddenPanel = "";
      return;
    }
    panel.hidden = false;
    const key = JSON.stringify(view);
    if (key === panelKey) return;
    const scroll = panelBody.scrollTop,
      same = panel.dataset.place === String(view.place);
    panelKey = key;
    panel.dataset.place = String(view.place);
    panelKeeper.replaceChildren(art.element(view.keeper, 72, "fl-keeper-art"));
    const building = `building-${PLACES[view.place]?.id ?? ""}`;
    if (panelBuilding.dataset.art !== building) {
      panelBuilding.dataset.art = building;
      panelBuilding.replaceChildren(art.element(building, 88));
    }
    text(panelName, view.name);
    text(panelGreeting, view.greeting);
    panelBody.replaceChildren(
      ...view.sections.map((section) => {
        const block = el("section", "", "fl-section");
        block.append(el("h3", section.title));
        if (section.info)
          block.append(el("p", section.info, "fl-section-info"));
        const grid = el("div", "", "fl-cards");
        grid.append(...section.cards.map(renderCard));
        block.append(grid);
        return block;
      }),
    );
    if (same) panelBody.scrollTop = scroll;
  }

  const freshToast = toastTracker();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(next: ScreenModel["toast"]): void {
    if (!next || !freshToast(next)) return;
    text(toast, next.text);
    toast.dataset.tone = next.bad ? "warn" : "good";
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2600);
  }

  function renderYou(next: ScreenModel, modal: boolean): void {
    const h = next.hud;
    if (!h) {
      youOpen = false;
      you.hidden = true;
      return;
    }
    // This week's private news opens the panel once.
    const newsKey = `${h.week}:${h.name}:${h.notices.join("|")}`;
    badge.hidden = h.notices.length === 0;
    if (h.notices.length && newsKey !== newsSeen && !modal) {
      newsSeen = newsKey;
      youOpen = true;
    }
    you.hidden = !youOpen || modal;
    if (you.hidden) return;
    text(youName, h.name);
    text(youWhere, h.where);
    const mine = next.scores.find((score) => score.you);
    const avatar = mine?.avatar ?? "fox";
    if (youFace.dataset.avatar !== avatar) {
      youFace.dataset.avatar = avatar;
      youFace.replaceChildren(art.element(`avatar-${avatar}-portrait`, 72));
    }
    const moneyKey = `${h.cash}:${h.bank}:${Math.floor(h.hoursLeft)}`;
    if (youMoney.dataset.key !== moneyKey) {
      youMoney.dataset.key = moneyKey;
      youMoney.replaceChildren(
        el("span", `Cash ${money(h.cash)}`),
        el("span", `Bank ${money(h.bank)}`),
        el("span", `${Math.floor(h.hoursLeft)} hours left`),
      );
    }
    text(youJob, h.job);
    const chipKey = JSON.stringify([h.chips, h.notices, h.tips]);
    if (youChips.dataset.key !== chipKey) {
      youChips.dataset.key = chipKey;
      youChips.replaceChildren(
        ...h.chips.map((chip) =>
          el("span", chip.label, chip.warn ? "fl-chip warn" : "fl-chip"),
        ),
      );
      youNews.replaceChildren(...h.notices.map((line) => el("li", line)));
      youNews.hidden = h.notices.length === 0;
      youTipList.replaceChildren(...h.tips.map((line) => el("li", line)));
      youTips.hidden = h.tips.length === 0;
    }
    youGoals.render(h.goals);
  }

  function render(next: ScreenModel): void {
    model = next;
    game.dataset.layout = next.layout;
    const modal = Boolean(next.briefing || next.handoff || next.result);
    game.classList.toggle("modal", modal);
    // HUD.
    const h = next.hud;
    hud.classList.toggle("bare", !h || modal);
    for (const part of [youButton, cash, hudGoals.element, endWeek])
      part.hidden = !h || modal;
    if (h) {
      hud.style.setProperty("--player", h.color);
      dial.style.setProperty("--left", (1 - h.ring).toFixed(3));
      text(hoursText, String(Math.floor(h.hoursLeft)));
      text(
        weekLabel,
        viewer.local && next.scores.filter((s) => !s.bot).length > 1
          ? `${next.headline} · ${h.name}`
          : next.headline,
      );
      timerText.classList.toggle("low", h.timer > 0 && h.timer < 0.2);
      text(timerText, h.seconds ? `${h.seconds}s left` : "Week over");
      showCash(h.name, h.cash);
      text(bankValue, `bank ${money(h.bank)}`);
      hudGoals.render(h.goals, h.name);
      endWeek.disabled = !next.canEndWeek;
      text(endWeek, h.done ? "WEEK OVER" : "CALL IT A WEEK");
    }
    renderYou(next, modal);
    // Places (for keyboards).
    next.board.places.forEach((place, index) => {
      const go = stripButtons[index]!;
      go.classList.toggle("here", place.here);
      go.disabled = !next.walk;
    });
    renderPanel(next.panel, modal || youOpen);
    showToast(next.toast);
    renderChecklist(next, modal || youOpen || !panel.hidden);
    tip.hidden = !next.tip || modal || youOpen || !panel.hidden;
    if (next.tip) {
      text(tipText, next.tip.text);
      tip.disabled = next.tip.place < 0 || !next.walk;
      tip.setAttribute(
        "aria-label",
        next.tip.place >= 0
          ? `Tip: ${next.tip.text} Tap to walk to ${PLACES[next.tip.place]!.name}.`
          : `Tip: ${next.tip.text}`,
      );
    }
    rivals.render(next.scores);
    panelStandings.render(next.scores);
    // An open panel covers the middle, so the rivals in the corners step aside (the panel shows them on phones).
    rivals.element.hidden = !h || modal || !panel.hidden || !you.hidden;
    // Briefing.
    briefing.hidden = !next.briefing;
    if (next.briefing) {
      const b = next.briefing;
      text(briefingTitle, `MONDAY · WEEK ${b.week}`);
      const key = JSON.stringify([b.ticker, b.headlines, b.notices, b.history]);
      if (briefing.dataset.key !== key) {
        briefing.dataset.key = key;
        briefingTicker.replaceChildren(
          ...b.ticker.map((item) => {
            const chip = el("span", "", "fl-tick");
            chip.append(el("small", item.label), el("b", item.value));
            if (item.up !== undefined)
              chip.classList.add(item.up ? "up" : "down");
            return chip;
          }),
        );
        const points = sparkline(b.history, 300, 60);
        // The index over the last weeks: a line over a soft fill, green when it rose and coral when it fell.
        const trend =
          (b.history[b.history.length - 1] ?? 0) >= (b.history[0] ?? 0)
            ? "up"
            : "down";
        briefingChart.dataset.trend = trend;
        briefingChart.innerHTML = points
          ? `<small>CITY500 · last ${b.history.length} weeks</small><svg viewBox="0 -6 300 72" preserveAspectRatio="none" aria-label="City500 index, last weeks"><polygon points="0,66 ${points} 300,66" /><polyline points="${points}" /></svg>`
          : "";
        briefingHeadlines.replaceChildren(
          ...b.headlines.map((line) => el("li", line)),
        );
        briefingNotices.replaceChildren(
          ...b.notices.map((line) => el("li", line)),
        );
        briefingNotices.hidden = b.notices.length === 0;
      }
      readyButton.hidden = !next.seated && !viewer.local;
      readyButton.disabled = !next.readyEntry;
      text(
        readyButton,
        b.ready ? "READY ✓" : viewer.local ? "START THE WEEK" : "READY",
      );
      text(
        readyNote,
        viewer.local
          ? `Starts by itself in ${b.seconds}s`
          : `${b.readyCount}/${b.total} ready · the week starts in ${b.seconds}s`,
      );
    }
    // Handoff.
    handoff.hidden = !next.handoff;
    if (next.handoff) {
      const ho = next.handoff;
      handoff.style.setProperty("--player", ho.color);
      if (handoffAvatar.dataset.avatar !== ho.avatar) {
        handoffAvatar.dataset.avatar = ho.avatar;
        handoffAvatar.replaceChildren(
          art.element(`avatar-${ho.avatar}-portrait`, 120, "fl-handoff-art"),
        );
      }
      text(handoffName, ho.name);
      text(handoffStep, `Week ${ho.week} · ${ho.step}`);
      text(handoffGo, `I'M ${ho.name.toUpperCase()}: START MY WEEK`);
      text(
        handoffNote,
        "Your clock starts when you tap. Hours you don't use are sleep.",
      );
    }
    // Result.
    result.hidden = !next.result;
    if (next.result) {
      text(resultTitle, next.result.title);
      const lines = next.result.lines.join("\n");
      if (resultLines.dataset.lines !== lines) {
        resultLines.dataset.lines = lines;
        resultLines.replaceChildren(
          ...next.result.lines.map((line) => el("li", line)),
        );
      }
      resultActions.hidden = !next.result.host;
      text(resultWaiting, next.result.waiting);
      resultWaiting.hidden = !next.result.waiting;
    }
  }

  // ---- the board, drawn every animation frame from the two newest frames ----
  let view: BoardView | undefined,
    viewKey = "",
    camera: Camera | undefined,
    labels: LabelSize[] = [],
    ratio = 1,
    hover = -1,
    running = true,
    insets: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  /** The camera follows this device's player until a drag; a new walk or a new turn picks them up again. */
  let follow = true,
    followKey = "",
    lastFrame = 0;
  /** The pointer that is down on the board: where it went down and where the camera was, and whether it dragged. */
  let press:
    | { id: number; x: number; y: number; camera: Camera; dragged: boolean }
    | undefined;
  /** The screen edges the HUD covers: its pieces in the top half push the board down, those in the bottom half up. */
  const measureInsets = (box: DOMRect): Insets => {
    if (hud.classList.contains("bare") && view) return insets;
    let top = 0,
      bottom = 0;
    for (const child of hud.children) {
      const rect = child.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const middle = (rect.top + rect.bottom) / 2 - box.top;
      if (middle < box.height / 2) top = Math.max(top, rect.bottom - box.top);
      else bottom = Math.max(bottom, box.bottom - rect.top);
    }
    return {
      top: Math.round(top + 6),
      bottom: Math.round(bottom + 6),
      left: 0,
      right: 0,
    };
  };
  const setRect = (rect: Rect, prefix: string) => {
    game.style.setProperty(`--${prefix}-x`, `${Math.round(rect.x)}px`);
    game.style.setProperty(`--${prefix}-y`, `${Math.round(rect.y)}px`);
    game.style.setProperty(`--${prefix}-w`, `${Math.round(rect.w)}px`);
    game.style.setProperty(`--${prefix}-h`, `${Math.round(rect.h)}px`);
  };
  /** The labels' half sizes in map px, so a tap on a name label opens its place. */
  const measureLabels = (next: BoardView): LabelSize[] => {
    const font = labelFont(next);
    context.font = `800 ${font}px ${FONT}`;
    return PLACES.map((place) => ({
      w: (context.measureText(place.name).width + font * 1.2) / 2 / next.scale,
      h: (font * 1.7) / 2 / next.scale,
    }));
  };
  const resize = () => {
    const box = game.getBoundingClientRect();
    ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(box.width)),
      height = Math.max(1, Math.round(box.height));
    insets = measureInsets(box);
    const key = [width, height, ratio, insets.top, insets.bottom].join(",");
    if (key === viewKey && view) return;
    viewKey = key;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const before = view;
    view = boardView(width, height, CITY.map, insets);
    // Keep the middle of the screen on the same spot of the map.
    if (before && camera)
      camera = centreOn(
        view,
        toMap(
          before,
          camera,
          before.free.x + before.free.w / 2,
          before.free.y + before.free.h / 2,
        ),
      );
    labels = measureLabels(view);
    game.classList.toggle("compact", view.compact);
    // A short screen has no room for rival chips in its corners.
    game.classList.toggle("short", !view.compact && view.height < SHORT);
    setRect(view.panel, "panel");
    setRect(view.free, "free");
  };
  /** The place under a pointer, or -1. */
  const pointer = (event: MouseEvent) => {
    if (!view || !camera) return -1;
    const box = canvas.getBoundingClientRect();
    return placeAt(
      toMap(view, camera, event.clientX - box.left, event.clientY - box.top),
      labels,
    );
  };
  const pan = (dx: number, dy: number, from: Camera) => {
    if (!view) return;
    follow = false;
    camera = clampCamera(view, { x: from.x + dx, y: from.y + dy });
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (press || !camera || (event.pointerType === "mouse" && event.button))
      return;
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camera,
      dragged: false,
    };
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (press && press.id === event.pointerId) {
      const dx = event.clientX - press.x,
        dy = event.clientY - press.y;
      if (!press.dragged && dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) {
        press.dragged = true;
        canvas.classList.add("dragging");
        hover = -1;
      }
      if (press.dragged) pan(dx, dy, press.camera);
      return;
    }
    if (event.pointerType !== "mouse") return;
    hover = model?.walk ? pointer(event) : -1;
    canvas.style.cursor = hover >= 0 ? "pointer" : "";
  });
  const release = (event: PointerEvent, cancelled: boolean) => {
    if (!press || press.id !== event.pointerId) return;
    const tapped = !press.dragged && !cancelled;
    press = undefined;
    canvas.classList.remove("dragging");
    if (!tapped) return;
    const at = pointer(event);
    if (at >= 0) walk(at);
  };
  canvas.addEventListener("pointerup", (event) => release(event, false));
  canvas.addEventListener("pointercancel", (event) => release(event, true));
  canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && !press) hover = -1;
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!camera || event.ctrlKey) return;
      event.preventDefault();
      pan(-event.deltaX, -event.deltaY, camera);
    },
    { passive: false },
  );

  /** Where this device's player is on the map this frame (or undefined: nobody plays here). */
  const myPoint = (frame: BoardFrame): MapPoint | undefined => {
    const me = frame.players.find((player) => player.you);
    if (!me) return undefined;
    const key = `${me.id}:${me.dest}`;
    if (key !== followKey) {
      // A new walk, or a new turn: the camera picks this player up again.
      if (me.dest >= 0 || !followKey.startsWith(`${me.id}:`)) follow = true;
      followKey = key;
    }
    return walkerAt(
      frame.before.get(me.id) ?? me.pos,
      me.pos,
      me.dest >= 0 ? me.dest : me.inside,
      frame.fraction,
    ).at;
  };
  const started = performance.now();
  // Reduced motion: the board keeps still (no drifting clouds, twinkling water or marching route).
  const calm =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Who is in which place, to burst a ring when someone walks in (not on the first frame, or a new turn's).
  const insideSeen = new Map<string, number>();
  let arrivals: { id: string; at: number }[] = [];
  const noticeArrivals = (frame: BoardFrame, now: number) => {
    for (const player of frame.players) {
      const was = insideSeen.get(player.id);
      if (was !== undefined && was < 0 && player.inside >= 0 && !calm)
        arrivals.push({ id: player.id, at: now });
      insideSeen.set(player.id, player.inside);
    }
    arrivals = arrivals.filter((one) => now - one.at < BURST * 1000);
  };
  const frameLoop = () => {
    if (!running) return;
    requestAnimationFrame(frameLoop);
    if (game.hidden || !game.isConnected || game.getClientRects().length === 0)
      return;
    resize();
    const timing = driver().frameTiming();
    if (!timing || !view) return;
    const { newer, older } = timing;
    const span = older ? newer.tick - older.tick : 0;
    const before = new Map<string, number>();
    for (const player of (older ?? newer).players)
      before.set(player.id, player.state.pos);
    const now = performance.now();
    const frame: BoardFrame = {
      ...boardModel(newer, viewer),
      before,
      fraction: span > 0 ? (timing.tick - older!.tick) / span : 1,
      time: (now - started) / 1000,
      hover,
      daylight: model?.hud ? 1 - model.hud.ring : undefined,
    };
    noticeArrivals(frame, now);
    frame.arrivals = arrivals.map((one) => ({
      id: one.id,
      age: (now - one.at) / 1000,
    }));
    const mine = myPoint(frame);
    const middle: MapPoint = [CITY.map.width / 2, CITY.map.height / 2];
    if (!camera) camera = centreOn(view, mine ?? middle);
    else if (tourAt)
      camera = easeCamera(
        camera,
        centreOn(view, tourAt),
        Math.min(0.1, (now - (lastFrame || now)) / 1000),
      );
    else if (follow && mine && !press?.dragged)
      camera = easeCamera(
        camera,
        centreOn(view, mine),
        Math.min(0.1, (now - (lastFrame || now)) / 1000),
      );
    camera = clampCamera(view, camera);
    lastFrame = now;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawBoard(context, view, camera, frame, art, ratio, {
      debug: Boolean(options.debugRoads),
      calm,
    });
    if (tour) placeTourSpot();
    // With `?debug-roads`, the camera is readable from the page too, so a browser test can tap a building.
    if (options.debugRoads)
      game.dataset.camera = `${camera.x},${camera.y},${view.scale}`;
  };
  requestAnimationFrame(frameLoop);

  return {
    /** Everything the game adds to the page. */
    elements: [game] as HTMLElement[],
    game,
    /** The middle of the board, where cards open (the page's own cards, like PAUSED, go here too). */
    centre,
    render,
    hidePanel,
    /** Shows the tour over the board; `done` runs once it is finished or skipped. */
    tour(steps: TourStep[], done: () => void) {
      if (steps.length === 0) return done();
      tour = { steps, index: 0, done };
      hidePanel();
      youOpen = false;
      if (model) render(model);
      tourLayer.hidden = false;
      showTourStep();
    },
    /** Whether the tour is up: the page's own keys and cards stand aside. */
    touring: () => tour !== undefined,
    destroy() {
      running = false;
    },
    keydown(event: KeyboardEvent) {
      if (tour) {
        if (event.key === "Escape") endTour();
        else if (event.key === "ArrowRight" || event.key === "Enter")
          stepTour(1);
        else if (event.key === "ArrowLeft") stepTour(-1);
        return;
      }
      if (event.key === "Escape") {
        if (youOpen) {
          youOpen = false;
          if (model) render(model);
        } else if (model?.panel) hidePanel();
      } else if (event.key === "Enter" && model?.readyEntry)
        play(model.readyEntry);
    },
  };
}
