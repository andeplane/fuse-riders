import { button, elementsFor } from "fuse-ui";
import {
  BATTLE_MODE,
  SCORE_MODE,
  type ChartInfo,
  type SongInfo,
} from "../engine/index.js";

/**
 * The song select: a list of songs beside the selected song's details, its charts as chips and the mode switch.
 * The same component is the landing page's solo select, a room lobby's (the host chooses the song and the mode,
 * every player their own chart) and the choice of the next song after one.
 *
 * It holds no state of its own. A click or a key reports what the player asked for through `onSong`, `onChart`
 * and `onMode`, and the picker goes on showing the last state it was given until the page answers with `update`:
 * in a room the choice travels through the log first.
 */
export interface PickerState {
  /** The selected song's id. */
  song: string;
  /** The chart this player will play: an index into the song's `charts` (its last when the song has fewer). */
  chart: number;
  /** `SCORE_MODE` or `BATTLE_MODE`. */
  mode: number;
  /** May this player change the song and the mode (the host, or a solo player)? Everyone may change their own chart. */
  host: boolean;
}
export interface SongPickerOptions {
  document: Document;
  songs: readonly SongInfo[];
  /** The player asked for another song. Not called for the song already shown. */
  onSong(id: string): void;
  /** The player asked for another chart of the shown song. Not called for the chart already shown. */
  onChart(chart: number): void;
  /** The player asked for the other mode. Not called for the mode already shown. */
  onMode(mode: number): void;
  /**
   * The best result this player has on a chart, as short text ("AA 94.2%"), or undefined; shown on the chart chips
   * and, for the chart the player would play, on the song rows. Read again on every `update` (once per song and
   * once per chip) so a new best shows without a state change: keep it a lookup.
   */
  best?(song: string, chart: number): string | undefined;
  /** Leave the mode switch out (a caller that has no modes). Default false. */
  hideMode?: boolean;
}
export interface SongPicker {
  element: HTMLElement;
  /** Shows `state`. Cheap to call on every room frame: nothing in the DOM is written unless what it shows changed. */
  update(state: PickerState): void;
  /**
   * Moves the selection by keyboard (`KeyboardEvent.code`): the page forwards keys here while the picker is on
   * screen. Returns true when the key was used. Up/Down (W/S, I/K) change the song, Left/Right (A/D, J/L) the
   * chart, Tab or M toggles the mode; all three wrap at the ends. The song and the mode are the host's, so their
   * keys are left unused (false) for anyone else.
   */
  key(code: string): boolean;
}

export const MODE_CHOICES = [
  {
    mode: SCORE_MODE,
    key: "score",
    name: "SCORE ATTACK",
    line: "Best accuracy wins",
  },
  {
    mode: BATTLE_MODE,
    key: "battle",
    name: "BATTLE",
    line: "Hit the glowing arrows for power-ups, throw them at your friends",
  },
] as const;

const LEVELS = ["beginner", "easy", "medium", "hard", "challenge", "edit"];
/** The difficulty a chart's name stands for, which picks its colour: `other` for a name that is none of them. */
export function chartLevel(name: string): string {
  const level = name.toLowerCase();
  return LEVELS.includes(level) ? level : "other";
}

/** "128 BPM", or "120–140 BPM" for a song that changes tempo. */
export function tempoText(bpm: readonly [number, number]): string {
  const low = Math.round(bpm[0]),
    high = Math.round(bpm[1]);
  return low === high ? `${low} BPM` : `${low}–${high} BPM`;
}

/** A length in ms as m:ss. */
export function lengthText(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The chart of `song` that index `chart` plays: its last when the song has fewer. */
function chartAt(song: SongInfo, chart: number): number {
  const index = Number.isFinite(chart) ? Math.trunc(chart) : 0;
  return Math.max(0, Math.min(index, song.charts.length - 1));
}

/** Lit segments of a chip's meter bar: a meter above this shows them all, and the number says the rest. */
const BARS = 10;
const NO_SONG = "SELECT A SONG";

interface Row {
  song: SongInfo;
  element: HTMLButtonElement;
  best: HTMLElement;
  bestText: string;
}
interface Chip {
  element: HTMLButtonElement;
  name: HTMLElement;
  meter: HTMLElement;
  bars: HTMLElement[];
  steps: HTMLElement;
  holds: HTMLElement;
  mines: HTMLElement;
  peak: HTMLElement;
  best: HTMLElement;
  bestText: string;
}

export function createSongPicker(options: SongPickerOptions): SongPicker {
  const { songs } = options;
  const el = elementsFor(options.document);
  const root = el("div", "", "fm-picker");
  if (songs.length === 0) {
    root.append(el("p", "No songs loaded", "fm-picker-empty"));
    return { element: root, update() {}, key: () => false };
  }
  const push = (className: string) => button("", className, options.document);
  const write = (node: HTMLElement, text: string) => {
    if (node.textContent !== text) node.textContent = text;
  };

  /** What the picker shows: a copy, so a caller reusing one state object still gets its changes drawn. */
  let shown: PickerState | undefined;
  let song: SongInfo | undefined;
  /** The song whose row the list last scrolled to. */
  let revealed: string | undefined;

  // The songs.
  const list = el("div", "", "fm-picker-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Songs");
  const rows = new Map<string, Row>();
  for (const info of songs) {
    if (rows.has(info.id)) continue;
    const element = push("fm-picker-row");
    element.setAttribute("role", "option");
    element.setAttribute("aria-selected", "false");
    const meters = el("span", "", "fm-picker-row-meters");
    for (const chart of info.charts) {
      const meter = el("span", String(chart.meter), "fm-picker-row-meter");
      meter.dataset.level = chartLevel(chart.name);
      meter.title = chart.name;
      meters.append(meter);
    }
    const sub = el("span", "", "fm-picker-row-sub");
    sub.append(
      el("span", info.artist, "fm-picker-row-artist"),
      el(
        "span",
        `${tempoText(info.bpm)} · ${lengthText(info.endMs)}`,
        "fm-picker-row-facts",
      ),
    );
    const best = el("span", "", "fm-picker-row-best");
    element.append(
      el("span", info.title, "fm-picker-row-title"),
      meters,
      sub,
      best,
    );
    element.addEventListener("click", () => {
      if (shown?.host && shown.song !== info.id) options.onSong(info.id);
    });
    rows.set(info.id, { song: info, element, best, bestText: "" });
    list.append(element);
  }
  const order = [...rows.values()];

  // The selected song.
  const detail = el("section", "", "fm-picker-detail");
  const title = el("h2", NO_SONG, "fm-picker-title");
  const artist = el("p", "", "fm-picker-artist");
  const tempo = el("span", "", "fm-picker-tempo");
  const length = el("span", "", "fm-picker-length");
  const facts = el("p", "", "fm-picker-facts");
  facts.append(tempo, length);
  facts.hidden = true;
  const charts = el("div", "", "fm-picker-charts");
  charts.setAttribute("role", "group");
  charts.setAttribute("aria-label", "Difficulty");

  const chips: Chip[] = [];
  const stat = (label: string) => {
    const cell = el("span", `${label} `, "fm-picker-stat");
    const value = el("b");
    cell.append(value);
    return { cell, value };
  };
  /** Chips are made once per place and refilled for each song, so one that has the focus keeps it. */
  function chipAt(index: number): Chip {
    const made = chips[index];
    if (made) return made;
    const element = push("fm-picker-chip");
    element.setAttribute("aria-pressed", "false");
    const head = el("span", "", "fm-picker-chip-head");
    const name = el("span", "", "fm-picker-chip-name");
    const meter = el("span", "", "fm-picker-chip-meter");
    head.append(name, meter);
    const bar = el("span", "", "fm-picker-chip-bars");
    bar.setAttribute("aria-hidden", "true");
    const bars = Array.from({ length: BARS }, () => el("i"));
    bar.append(...bars);
    const steps = stat("STEPS"),
      holds = stat("HOLDS"),
      mines = stat("MINES"),
      peak = stat("PEAK");
    const stats = el("span", "", "fm-picker-chip-stats");
    stats.append(steps.cell, holds.cell, mines.cell, peak.cell);
    const best = el("span", "", "fm-picker-chip-best");
    element.append(head, bar, stats, best);
    element.addEventListener("click", () => {
      if (shown && song && chartAt(song, shown.chart) !== index)
        options.onChart(index);
    });
    const chip: Chip = {
      element,
      name,
      meter,
      bars,
      steps: steps.value,
      holds: holds.value,
      mines: mines.value,
      peak: peak.value,
      best,
      bestText: "",
    };
    chips[index] = chip;
    charts.append(element);
    return chip;
  }
  function fill(chip: Chip, chart: ChartInfo) {
    chip.element.dataset.level = chartLevel(chart.name);
    write(chip.name, chart.name);
    write(chip.meter, String(chart.meter));
    chip.bars.forEach((bar, index) =>
      bar.classList.toggle("fm-picker-on", index < chart.meter),
    );
    write(chip.steps, String(chart.steps));
    write(chip.holds, String(chart.holds));
    write(chip.mines, String(chart.mines));
    write(chip.peak, `${chart.peak}/s`);
  }

  // The mode.
  const modes = el("div", "", "fm-picker-modes");
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "Mode");
  const modeButtons = MODE_CHOICES.map((choice) => {
    const element = push("fm-picker-mode");
    element.dataset.mode = choice.key;
    element.setAttribute("aria-pressed", "false");
    element.disabled = true;
    element.append(
      el("span", choice.name, "fm-picker-mode-name"),
      el("span", choice.line, "fm-picker-mode-line"),
    );
    element.addEventListener("click", () => {
      if (shown?.host && shown.mode !== choice.mode)
        options.onMode(choice.mode);
    });
    modes.append(element);
    return { mode: choice.mode, element };
  });
  const hideMode = options.hideMode === true;
  const note = el(
    "p",
    hideMode
      ? "The host picks the song. You pick your difficulty."
      : "The host picks the song and the mode. You pick your difficulty.",
    "fm-picker-note",
  );
  note.hidden = true;

  const head = el("div", "", "fm-picker-head");
  head.append(title, artist, facts);
  detail.append(head, charts);
  if (!hideMode) detail.append(modes);
  detail.append(note);
  root.append(list, detail);
  root.dataset.host = "false";
  list.setAttribute("aria-disabled", "true");

  /**
   * Scrolls the list, and only the list, until `row` is inside it: `scrollIntoView` would move the page as well,
   * which on a phone is every guest's page each time the host moves. False while the list has no layout yet (not
   * in the document, or hidden), so the caller tries again.
   */
  function reveal(row: HTMLElement): boolean {
    const height = list.clientHeight;
    if (!(height > 0)) return false;
    const top = row.offsetTop,
      bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + height) list.scrollTop = bottom - height;
    return true;
  }

  function showSong(next: SongInfo | undefined) {
    song = next;
    write(title, next ? next.title : NO_SONG);
    write(artist, next ? next.artist : "");
    write(tempo, next ? tempoText(next.bpm) : "");
    write(length, next ? lengthText(next.endMs) : "");
    facts.hidden = !next;
    const count = next ? next.charts.length : 0;
    for (let index = 0; index < count; index++) {
      const chip = chipAt(index);
      fill(chip, next!.charts[index]!);
      chip.element.hidden = false;
    }
    for (let index = count; index < chips.length; index++)
      chips[index]!.element.hidden = true;
  }

  /** The best results, which can change under an unchanged state: read each time, written only when different. */
  function showBests(state: PickerState) {
    const best = options.best;
    if (!best) return;
    for (const row of order) {
      const text = best(row.song.id, chartAt(row.song, state.chart)) ?? "";
      if (text === row.bestText) continue;
      row.bestText = text;
      row.best.textContent = text;
    }
    if (!song) return;
    for (let index = 0; index < song.charts.length; index++) {
      const chip = chips[index]!;
      const text = best(song.id, index) ?? "";
      if (text === chip.bestText) continue;
      chip.bestText = text;
      chip.best.textContent = text;
    }
  }

  function update(state: PickerState) {
    const last = shown;
    const next: PickerState = {
      song: state.song,
      chart: state.chart,
      mode: state.mode,
      host: state.host,
    };
    shown = next;
    const songChanged = !last || last.song !== next.song;
    if (songChanged) {
      if (last)
        rows.get(last.song)?.element.setAttribute("aria-selected", "false");
      const row = rows.get(next.song);
      row?.element.setAttribute("aria-selected", "true");
      showSong(row?.song);
    }
    if (song && (songChanged || last?.chart !== next.chart)) {
      const chosen = chartAt(song, next.chart);
      for (let index = 0; index < song.charts.length; index++) {
        const element = chips[index]!.element;
        const pressed = String(index === chosen);
        if (element.getAttribute("aria-pressed") !== pressed)
          element.setAttribute("aria-pressed", pressed);
      }
    }
    if (!last || last.mode !== next.mode)
      for (const button of modeButtons)
        button.element.setAttribute(
          "aria-pressed",
          String(button.mode === next.mode),
        );
    if (!last || last.host !== next.host) {
      root.dataset.host = String(next.host);
      if (next.host) list.removeAttribute("aria-disabled");
      else list.setAttribute("aria-disabled", "true");
      for (const button of modeButtons) button.element.disabled = !next.host;
      note.hidden = next.host;
    }
    showBests(next);
    if (revealed !== next.song) {
      const row = rows.get(next.song);
      if (!row || reveal(row.element)) revealed = next.song;
    }
  }

  function stepSong(by: number): boolean {
    if (!shown?.host) return false;
    const at = order.findIndex((row) => row.song.id === shown!.song);
    const to =
      at < 0
        ? by > 0
          ? 0
          : order.length - 1
        : (at + by + order.length) % order.length;
    const id = order[to]!.song.id;
    if (id !== shown.song) options.onSong(id);
    return true;
  }
  function stepChart(by: number): boolean {
    if (!shown || !song || song.charts.length === 0) return false;
    const count = song.charts.length;
    const at = chartAt(song, shown.chart);
    const to = (at + by + count) % count;
    if (to !== at) options.onChart(to);
    return true;
  }
  function toggleMode(): boolean {
    if (hideMode || !shown?.host) return false;
    options.onMode(shown.mode === SCORE_MODE ? BATTLE_MODE : SCORE_MODE);
    return true;
  }

  return {
    element: root,
    update,
    key(code) {
      switch (code) {
        case "ArrowUp":
        case "KeyW":
        case "KeyI":
          return stepSong(-1);
        case "ArrowDown":
        case "KeyS":
        case "KeyK":
          return stepSong(1);
        case "ArrowLeft":
        case "KeyA":
        case "KeyJ":
          return stepChart(-1);
        case "ArrowRight":
        case "KeyD":
        case "KeyL":
          return stepChart(1);
        case "Tab":
        case "KeyM":
          return toggleMode();
        default:
          return false;
      }
    },
  };
}
