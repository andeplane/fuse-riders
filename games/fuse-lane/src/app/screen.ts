import { button, el } from "fuse-ui";
import { GOAL_NAMES, PLACES, type FuseLaneView } from "../game/index.js";
import type { Art } from "./art.js";
import { drawBoard, geometry, placeAt, type Geometry } from "./board.js";
import {
  boardModel,
  sparkline,
  type Card,
  type GoalBar,
  type PanelModel,
  type ScreenModel,
  type Viewer,
} from "./presenter.js";

/**
 * The game screen, shared by a match on this device and an online room: the HUD, the board, the place strip, the
 * place panel, the scores, the Monday briefing, the hot-seat handoff and the result. It renders a `ScreenModel` and
 * hands every tap back as a play entry body; the board is drawn each animation frame from the driver's two newest
 * frames.
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
}

export const money = (value: number) =>
  `${value < 0 ? "-" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

/** Sets text only when it changed, so a per-frame render leaves the DOM (and a screen reader) alone. */
export function text(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

/** Four goal bars: icon, name, a meter and "value / goal". */
function createGoalBars(art: Art, className: string) {
  const element = el("div", "", `fl-goals ${className}`);
  const rows = GOAL_NAMES.map((name, index) => {
    const row = el("div", "", "fl-goal"),
      icon = art.element(
        ["ui-wealth", "ui-happiness", "ui-education", "ui-career"][index]!,
        18,
      ),
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
        row.fill.style.width = `${Math.min(100, (goal.value / Math.max(1, goal.goal)) * 100).toFixed(1)}%`;
        row.row.classList.toggle("met", goal.met);
        text(row.value, `${goal.value}/${goal.goal}`);
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

  // ---- HUD ----
  const hud = el("div", "", "fl-hud"),
    ring = el("div", "", "fl-ring"),
    ringText = el("b", ""),
    ringSmall = el("small", "HOURS LEFT"),
    weekLabel = el("strong", "", "fl-week"),
    timer = el("div", "", "fl-timer"),
    timerFill = el("span"),
    timerText = el("small", "", "fl-timer-text"),
    cash = el("div", "", "fl-money"),
    cashValue = el("b", ""),
    bankValue = el("b", ""),
    where = el("p", "", "fl-where"),
    job = el("p", "", "fl-job"),
    chips = el("div", "", "fl-chips"),
    news = el("ul", "", "fl-news"),
    endWeek = button("CALL IT A WEEK", "fl-end-week");
  ring.append(ringText, ringSmall);
  timer.append(timerFill);
  const cashLine = el("span", "", "fl-cash"),
    bankLine = el("span", "", "fl-bank");
  cashLine.append(art.element("ui-cash", 18), cashValue);
  bankLine.append(art.element("ui-bank", 18), bankValue);
  cash.append(cashLine, bankLine);
  const hudGoals = createGoalBars(art, "fl-hud-goals");
  const hudTop = el("div", "", "fl-hud-top"),
    hudClock = el("div", "", "fl-hud-clock");
  hudClock.append(weekLabel, timer, timerText);
  hudTop.append(ring, hudClock, cash);
  const hudFoot = el("div", "", "fl-hud-foot");
  const hudLines = el("div", "", "fl-hud-lines");
  hudLines.append(where, job, chips);
  hudFoot.append(hudLines, endWeek);
  hud.append(hudTop, hudGoals.element, news, hudFoot);
  endWeek.onclick = () => play(model?.endWeekEntry);

  // ---- board ----
  const boardWrap = el("div", "", "fl-board"),
    canvas = el("canvas"),
    context = canvas.getContext("2d")!;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "The city: tap a building to walk there");
  boardWrap.append(canvas);

  const strip = el("nav", "", "fl-strip");
  strip.setAttribute("aria-label", "Places");
  const stripButtons = PLACES.map((place, index) => {
    const go = button("", "fl-place");
    go.append(art.element(`building-${place.id}`, 30), el("span", place.name));
    go.onclick = () => walk(index);
    strip.append(go);
    return go;
  });

  // ---- place panel ----
  const panel = el("section", "", "fl-panel"),
    panelHead = el("header", "", "fl-panel-head"),
    panelKeeper = el("div", "", "fl-keeper"),
    panelName = el("h2", ""),
    panelGreeting = el("p", "", "fl-greeting"),
    panelClose = button("×", "fl-panel-close"),
    panelBody = el("div", "", "fl-panel-body");
  panelClose.setAttribute("aria-label", "Hide this panel");
  const panelTitles = el("div", "");
  panelTitles.append(panelName, panelGreeting);
  panelHead.append(panelKeeper, panelTitles, panelClose);
  panel.append(panelHead, panelBody);
  panel.hidden = true;
  let hiddenPanel = "",
    panelKey = "";
  const panelId = (view: PanelModel) => `${viewer.me}:${view.place}`;
  panelClose.onclick = () => hidePanel();
  function hidePanel(): void {
    if (model?.panel) hiddenPanel = panelId(model.panel);
    panel.hidden = true;
  }

  // ---- scores ----
  const scores = el("section", "", "fl-scores"),
    scoreRows = new Map<string, ReturnType<typeof scoreRow>>();
  function scoreRow() {
    const root = el("article", "", "fl-score"),
      name = el("strong", "", "fl-score-name"),
      turn = el("span", "", "fl-score-turn"),
      detail = el("small", "", "fl-score-detail"),
      percent = el("b", "", "fl-score-percent"),
      bars = createGoalBars(art, "fl-score-goals");
    const head = el("div", "", "fl-score-head");
    head.append(name, turn, percent);
    root.append(head, bars.element, detail);
    scores.append(root);
    return { root, name, turn, detail, percent, bars };
  }

  const side = el("div", "", "fl-side");
  side.append(hud, scores);
  const toast = el("div", "", "fl-toast");
  toast.hidden = true;
  const stage = el("div", "", "fl-stage");
  stage.append(boardWrap, panel, toast);
  game.append(stage, strip, side);

  // ---- Monday briefing ----
  const briefing = el("section", "", "fl-briefing fl-overlay"),
    briefingCard = el("div", "", "fl-sheet fl-briefing-card"),
    briefingTitle = el("h2", ""),
    briefingTicker = el("div", "", "fl-ticker"),
    briefingChart = el("div", "", "fl-chart"),
    briefingHeadlines = el("ul", "", "fl-headlines"),
    briefingNotices = el("ul", "", "fl-notices"),
    readyButton = button("READY", "fui-button-primary fl-ready"),
    readyNote = el("p", "", "fl-ready-note");
  briefingCard.append(
    briefingTitle,
    briefingTicker,
    briefingChart,
    briefingHeadlines,
    briefingNotices,
    readyButton,
    readyNote,
  );
  briefing.append(briefingCard);
  briefing.hidden = true;
  readyButton.onclick = () => play(model?.readyEntry);

  // ---- hot-seat handoff: an opaque screen, so the last player's week stays theirs ----
  const handoff = el("section", "", "fl-handoff fl-overlay"),
    handoffCard = el("div", "", "fl-handoff-card"),
    handoffAvatar = el("div", "", "fl-handoff-avatar"),
    handoffPass = el("p", "PASS THE DEVICE TO", "fl-handoff-pass"),
    handoffName = el("h2", "", "fl-handoff-name"),
    handoffStep = el("p", "", "fl-handoff-step"),
    handoffGo = button("", "fui-button-primary fl-handoff-go"),
    handoffNote = el("p", "", "fl-handoff-note");
  handoffCard.append(
    handoffAvatar,
    handoffPass,
    handoffName,
    handoffStep,
    handoffGo,
    handoffNote,
  );
  handoff.append(handoffCard);
  handoff.hidden = true;
  handoffGo.onclick = () => play(model?.readyEntry);

  // ---- result ----
  const result = el("section", "", "fl-result fl-overlay"),
    resultCard = el("div", "", "fl-sheet fl-result-card"),
    resultTitle = el("h2", "", "fl-result-title"),
    resultLines = el("ol", "", "fl-result-lines"),
    again = button(hooks.again.label, "fui-button-primary"),
    back = button(hooks.back.label),
    resultWaiting = el("p", "", "fui-lobby-note"),
    resultActions = el("div", "", "fl-actions");
  resultActions.append(back, again);
  resultCard.append(resultTitle, resultLines, resultWaiting, resultActions);
  result.append(resultCard);
  result.hidden = true;
  again.onclick = () => hooks.again.run();
  back.onclick = () => hooks.back.run();

  let model: ScreenModel | undefined;
  function walk(place: number): void {
    if (!model?.walk) return;
    if (model.panel?.place === place) {
      hiddenPanel = "";
      panel.hidden = false;
      return;
    }
    hiddenPanel = "";
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
  function renderPanel(view: PanelModel | undefined): void {
    if (!view || hiddenPanel === panelId(view)) {
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
    panelKeeper.replaceChildren(art.element(view.keeper, 56, "fl-keeper-art"));
    text(panelName, view.name);
    text(panelGreeting, `“${view.greeting}”`);
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

  function render(next: ScreenModel): void {
    model = next;
    game.dataset.layout = next.layout;
    // HUD.
    hud.hidden = !next.hud;
    if (next.hud) {
      const h = next.hud;
      hud.style.setProperty("--player", h.color);
      ring.style.setProperty("--ring", h.ring.toFixed(3));
      text(ringText, String(Math.floor(h.hoursLeft)));
      text(
        weekLabel,
        viewer.local && next.scores.filter((s) => !s.bot).length > 1
          ? `${next.headline} · ${h.name.toUpperCase()}`
          : next.headline,
      );
      timerFill.style.width = `${(h.timer * 100).toFixed(1)}%`;
      timer.classList.toggle("low", h.timer > 0 && h.timer < 0.2);
      text(timerText, h.seconds ? `${h.seconds}s left` : "");
      text(cashValue, money(h.cash));
      text(bankValue, money(h.bank));
      hudGoals.render(h.goals);
      text(where, h.where);
      text(job, h.job);
      const chipKey = JSON.stringify([h.chips, h.notices]);
      if (chips.dataset.key !== chipKey) {
        chips.dataset.key = chipKey;
        chips.replaceChildren(
          ...h.chips.map((chip) =>
            el("span", chip.label, chip.warn ? "fl-chip warn" : "fl-chip"),
          ),
        );
        news.replaceChildren(...h.notices.map((line) => el("li", line)));
        news.hidden = h.notices.length === 0;
      }
      endWeek.disabled = !next.canEndWeek;
      text(endWeek, h.done ? "WEEK OVER" : "CALL IT A WEEK");
    }
    // Place strip.
    next.board.places.forEach((place, index) => {
      const go = stripButtons[index]!;
      go.classList.toggle("here", place.here);
      go.classList.toggle("dest", place.dest);
      go.classList.toggle("work", place.work);
      go.disabled = !next.walk;
    });
    renderPanel(next.panel);
    showToast(next.toast);
    // Scores.
    for (const [id, row] of scoreRows)
      if (!next.scores.some((score) => score.id === id)) {
        row.root.remove();
        scoreRows.delete(id);
      }
    next.scores.forEach((score, index) => {
      let row = scoreRows.get(score.id);
      if (!row) {
        row = scoreRow();
        scoreRows.set(score.id, row);
      }
      row.root.style.setProperty("--player", score.color);
      row.root.style.order = String(index);
      row.root.classList.toggle("you", score.you);
      row.root.classList.toggle("done", score.done);
      row.root.classList.toggle("away", !score.present);
      text(
        row.name,
        score.you && score.name !== "You" && !viewer.local
          ? `${score.name} (you)`
          : score.bot
            ? `${score.name} · AI`
            : score.name,
      );
      text(row.turn, score.turn);
      row.turn.dataset.turn = score.turn;
      text(row.percent, `${Math.round(score.progress * 100)}%`);
      text(row.detail, `${money(score.cash)} cash and savings`);
      row.bars.render(score.goals);
    });
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
      const h = next.handoff;
      handoff.style.setProperty("--player", h.color);
      if (handoffAvatar.dataset.avatar !== h.avatar) {
        handoffAvatar.dataset.avatar = h.avatar;
        handoffAvatar.replaceChildren(
          art.element(`avatar-${h.avatar}-portrait`, 120, "fl-handoff-art"),
        );
      }
      text(handoffName, h.name);
      text(handoffStep, `Week ${h.week} · ${h.step}`);
      text(handoffGo, `I'M ${h.name.toUpperCase()}: START MY WEEK`);
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
  let shape: Geometry = geometry(1, 1),
    hover = -1,
    running = true;
  const resize = () => {
    const box = boardWrap.getBoundingClientRect(),
      ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(box.width)),
      height = Math.max(1, Math.round(box.height));
    if (width === shape.width && height === shape.height) return;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    shape = geometry(width, height);
  };
  const pointer = (event: MouseEvent) => {
    const box = canvas.getBoundingClientRect();
    return placeAt(
      shape,
      PLACES,
      event.clientX - box.left,
      event.clientY - box.top,
    );
  };
  canvas.addEventListener("pointermove", (event) => {
    hover = model?.walk ? pointer(event) : -1;
    canvas.style.cursor = hover >= 0 ? "pointer" : "";
  });
  canvas.addEventListener("pointerleave", () => {
    hover = -1;
  });
  canvas.addEventListener("click", (event) => {
    const place = pointer(event);
    if (place >= 0) walk(place);
  });
  const started = performance.now();
  const frameLoop = () => {
    if (!running) return;
    requestAnimationFrame(frameLoop);
    if (game.hidden || boardWrap.offsetParent === null) return;
    resize();
    const timing = driver().frameTiming();
    if (!timing) return;
    const { newer, older } = timing;
    const span = older ? newer.tick - older.tick : 0;
    const before = new Map<string, number>();
    for (const player of (older ?? newer).players)
      before.set(player.id, player.state.pos);
    drawBoard(
      context,
      shape,
      {
        ...boardModel(newer, viewer),
        before,
        fraction: span > 0 ? (timing.tick - older!.tick) / span : 1,
        time: (performance.now() - started) / 1000,
        hover,
        centre:
          newer.phase === "running"
            ? newer.part === "briefing"
              ? "MONDAY"
              : `WEEK ${newer.week}`
            : "",
      },
      art,
    );
  };
  requestAnimationFrame(frameLoop);

  return {
    /** Everything the game adds to the page; the overlays sit on top of it. */
    elements: [game, briefing, handoff, result] as HTMLElement[],
    game,
    render,
    hidePanel,
    destroy() {
      running = false;
    },
    keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && model?.panel) hidePanel();
      else if (event.key === "Enter" && model?.readyEntry)
        play(model.readyEntry);
    },
  };
}
