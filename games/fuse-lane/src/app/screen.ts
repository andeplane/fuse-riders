import { button, el } from "fuse-ui";
import { GOAL_NAMES, PLACES, type FuseLaneView } from "../game/index.js";
import type { Art } from "./art.js";
import { drawBoard } from "./board.js";
import {
  geometry,
  placeAt,
  type Geometry,
  type Insets,
  type Rect,
} from "./layout.js";
import {
  boardModel,
  sparkline,
  type Card,
  type GoalBar,
  type PanelModel,
  type ScoreRow,
  type ScreenModel,
  type Viewer,
} from "./presenter.js";

/**
 * The game screen, shared by a match on this device and an online room. The board fills the screen; a slim HUD
 * floats over its edges (hours, money, goals, CALL IT A WEEK, pause and menu); everything else opens in the middle
 * of the board: the place panels, the "you" panel, the Monday briefing, the hot-seat handoff and the result. On a
 * wide screen the rivals sit in the corners of the park; on a phone they show at the top of every place panel. It
 * renders a `ScreenModel` and hands every tap back as a play entry body; the board is drawn each animation frame
 * from the driver's two newest frames.
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
}

export const money = (value: number) =>
  `${value < 0 ? "-" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

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
  return {
    element,
    render(goals: readonly GoalBar[]) {
      goals.forEach((goal, index) => {
        const ring = rings[index]!;
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

export function createGameScreen(
  art: Art,
  viewer: Viewer,
  driver: () => Driver,
  hooks: ScreenHooks,
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

  // ---- rivals in the park's corners (wide screens) ----
  const rivals = createStandings(art, "fl-corners");

  // ---- the middle of the board: every panel and card opens here ----
  const centre = el("div", "", "fl-centre");

  const panel = el("section", "", "fl-panel"),
    panelHead = el("header", "", "fl-panel-head"),
    panelKeeper = el("div", "", "fl-keeper"),
    panelName = el("h2", "", "fl-banner"),
    panelGreeting = el("p", "", "fl-greeting"),
    panelClose = button("×", "fl-close"),
    panelBody = el("div", "", "fl-panel-body");
  panelClose.setAttribute("aria-label", "Back to the street");
  const panelTitles = el("div", "", "fl-panel-titles");
  panelTitles.append(panelName, panelGreeting);
  panelHead.append(panelKeeper, panelTitles, panelClose);
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
    youGoals = createGoalBars(art, "fl-you-goals");
  youClose.setAttribute("aria-label", "Close");
  const youTitles = el("div", "", "fl-panel-titles");
  youTitles.append(youName, youWhere);
  youHead.append(youFace, youTitles, youClose);
  youBody.append(youMoney, youJob, youChips, youGoals.element, youNews);
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
  game.append(stage, strip, rivals.element, centre, hud, toast);

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

  let toastKey = "",
    toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(next: ScreenModel["toast"]): void {
    if (!next || next.key === toastKey) return;
    const first = toastKey === "";
    toastKey = next.key;
    if (first) return; // the message that was up when the page loaded is old news
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
    const chipKey = JSON.stringify([h.chips, h.notices]);
    if (youChips.dataset.key !== chipKey) {
      youChips.dataset.key = chipKey;
      youChips.replaceChildren(
        ...h.chips.map((chip) =>
          el("span", chip.label, chip.warn ? "fl-chip warn" : "fl-chip"),
        ),
      );
      youNews.replaceChildren(...h.notices.map((line) => el("li", line)));
      youNews.hidden = h.notices.length === 0;
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
      text(cashValue, money(h.cash));
      text(bankValue, `bank ${money(h.bank)}`);
      hudGoals.render(h.goals);
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
    rivals.render(next.scores);
    panelStandings.render(next.scores);
    // An open panel covers the park, so the rivals in its corners step aside (the panel shows them on phones).
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
        briefingChart.innerHTML = points
          ? `<svg viewBox="-4 -4 308 68" preserveAspectRatio="none" aria-label="City500 index, last weeks"><polyline points="${points}" /></svg><small>CITY500</small>`
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
  const rings = PLACES.map((place) => place.ring);
  let shape: Geometry | undefined,
    shapeKey = "",
    ratio = 1,
    hover = -1,
    running = true,
    insets: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  /** The screen edges the HUD covers: its pieces in the top half push the board down, those in the bottom half up. */
  const measureInsets = (box: DOMRect): Insets => {
    if (hud.classList.contains("bare") && shape) return insets;
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
  const resize = () => {
    const box = game.getBoundingClientRect();
    ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(box.width)),
      height = Math.max(1, Math.round(box.height));
    insets = measureInsets(box);
    const key = [width, height, ratio, insets.top, insets.bottom].join(",");
    if (key === shapeKey && shape) return;
    shapeKey = key;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    shape = geometry(width, height, rings, insets);
    game.classList.toggle("compact", shape.compact);
    setRect(shape.panel, "panel");
    setRect(shape.park, "park");
  };
  const pointer = (event: MouseEvent) => {
    if (!shape) return -1;
    const box = canvas.getBoundingClientRect();
    return placeAt(shape, event.clientX - box.left, event.clientY - box.top);
  };
  canvas.addEventListener("pointermove", (event) => {
    hover = model?.walk ? pointer(event) : -1;
    canvas.style.cursor = hover >= 0 ? "pointer" : "";
  });
  canvas.addEventListener("pointerleave", () => {
    hover = -1;
  });
  canvas.addEventListener("click", (event) => {
    const at = pointer(event);
    if (at >= 0) walk(at);
  });
  const started = performance.now();
  const frameLoop = () => {
    if (!running) return;
    requestAnimationFrame(frameLoop);
    if (game.hidden || !game.isConnected || game.getClientRects().length === 0)
      return;
    resize();
    const timing = driver().frameTiming();
    if (!timing || !shape) return;
    const { newer, older } = timing;
    const span = older ? newer.tick - older.tick : 0;
    const before = new Map<string, number>();
    for (const player of (older ?? newer).players)
      before.set(player.id, player.state.pos);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawBoard(
      context,
      shape,
      {
        ...boardModel(newer, viewer),
        before,
        fraction: span > 0 ? (timing.tick - older!.tick) / span : 1,
        time: (performance.now() - started) / 1000,
        hover,
      },
      art,
      ratio,
    );
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
    destroy() {
      running = false;
    },
    keydown(event: KeyboardEvent) {
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
