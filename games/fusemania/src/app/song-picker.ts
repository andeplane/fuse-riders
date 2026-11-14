import { button, elementsFor } from "fuse-ui";
import {
  BATTLE_MODE,
  SCORE_MODE,
  type ChartInfo,
  type SongInfo,
} from "../engine/index.js";

/**
 * The song select: a carousel of song covers over the selected song's details, its charts as chips and the mode
 * switch. The same component is the landing page's solo select and a room lobby's. In a room the carousel is the
 * host's alone: every other player sees the song the host chose as one card (cover, title, tempo, mode) and picks
 * only their own chart.
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
  /**
   * The URL of a song's cover image, or undefined for a song without one. Every cover is first drawn from the
   * song's id (`coverTint`), so a song without an image, or one whose image fails to load, still has a cover.
   */
  cover?(song: SongInfo): string | undefined;
  /**
   * The packs the songs are grouped in: the carousel shows them pack by pack, in this order, under a tab for each
   * pack. A song that no pack names follows the last pack's songs. Leave out for one unnamed group.
   */
  packs?: readonly {
    readonly id: string;
    readonly name: string;
    readonly songs: readonly string[];
  }[];
}
export interface SongPicker {
  element: HTMLElement;
  /** Shows `state`. Cheap to call on every room frame: nothing in the DOM is written unless what it shows changed. */
  update(state: PickerState): void;
  /**
   * Moves the selection by keyboard (`KeyboardEvent.code`): the page forwards keys here while the picker is on
   * screen. Returns true when the key was used. Left/Right (A/D, J/L) turn the carousel to the next song, Up/Down
   * (W/S, I/K) change the chart, PageUp/PageDown jump to the previous or next pack, Tab or M toggles the mode; all
   * wrap at the ends. The song, the pack and the mode are the host's, so their keys are left unused (false) for
   * anyone else.
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

/** Covers drawn on each side of the selected one; the next one out is placed off the edge so it can slide in. */
export const WHEEL_REACH = 3;
/**
 * Where song `index` sits on the carousel when `selected` is in the middle: 0 for the selected song, -1 for the
 * one on its left, and so on. The carousel is a ring, so the nearest way round counts. Undefined for a song
 * further out than the carousel draws.
 */
export function wheelOffset(
  index: number,
  selected: number,
  count: number,
): number | undefined {
  if (count <= 0 || selected < 0) return undefined;
  let offset = (((index - selected) % count) + count) % count;
  // A ring too short to fill both sides keeps each song on one side only.
  if (offset > count / 2) offset -= count;
  return Math.abs(offset) <= WHEEL_REACH + 1 ? offset : undefined;
}

/** A cover drawn from nothing but the song's id: two hues and an angle, the same on every device. */
export function coverTint(id: string): { a: number; b: number; angle: number } {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++)
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619) >>> 0;
  const a = hash % 360;
  return {
    a,
    b: (a + 40 + ((hash >>> 9) % 120)) % 360,
    angle: 20 + ((hash >>> 17) % 8) * 20,
  };
}

/** A horizontal drag this long turns the carousel one song. */
const DRAG_STEP_PX = 56;
/** Lit segments of a chip's meter bar: a meter above this shows them all, and the number says the rest. */
const BARS = 10;
const NO_SONG = "SELECT A SONG";

interface Row {
  song: SongInfo;
  element: HTMLButtonElement;
  best: HTMLElement;
  bestText: string;
  /** The cover image, until it has been asked for: far covers are not fetched before they come near. */
  image: { node: HTMLImageElement; url: string } | undefined;
  /** The `data-offset` last written. */
  offset: string | undefined;
  /** Index into the picker's packs, or -1 for a song outside them all. */
  pack: number;
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

  /** A song's cover: drawn from its id, with its image over that once it has loaded. */
  function coverOf(info: SongInfo) {
    const node = el("span", "", "fm-cover");
    const tint = coverTint(info.id);
    node.style.setProperty("--fm-cover-a", String(tint.a));
    node.style.setProperty("--fm-cover-b", String(tint.b));
    node.style.setProperty("--fm-cover-angle", `${tint.angle}deg`);
    const url = options.cover?.(info);
    let image: Row["image"];
    if (url) {
      const img = el("img", "", "fm-cover-image");
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      // No image is better than a broken one: the drawn cover stays.
      img.addEventListener("error", () => img.remove());
      node.append(img);
      image = { node: img, url };
    }
    return { node, image };
  }

  // The songs: a ring of covers, the selected one in the middle.
  const wheel = el("div", "", "fm-picker-wheel");
  const list = el("div", "", "fm-picker-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Songs");
  list.setAttribute("aria-orientation", "horizontal");
  const rows = new Map<string, Row>();
  /** A drag that turned the carousel swallows the click that ends it. */
  let dragged = false;
  // Pack by pack, each in the pack's own order; a song no pack names comes after them all.
  const packs = options.packs ?? [];
  const packOf = new Map<string, number>();
  packs.forEach((pack, index) => {
    for (const id of pack.songs) if (!packOf.has(id)) packOf.set(id, index);
  });
  const byId = new Map(songs.map((info) => [info.id, info]));
  const grouped = [
    ...packs.flatMap((pack) => pack.songs.flatMap((id) => byId.get(id) ?? [])),
    ...songs.filter((info) => !packOf.has(info.id)),
  ];
  for (const info of grouped) {
    if (rows.has(info.id)) continue;
    const element = push("fm-picker-row");
    element.setAttribute("role", "option");
    element.setAttribute("aria-selected", "false");
    const cover = coverOf(info);
    const meters = el("span", "", "fm-picker-row-meters");
    for (const chart of info.charts) {
      const meter = el("span", String(chart.meter), "fm-picker-row-meter");
      meter.dataset.level = chartLevel(chart.name);
      meter.title = chart.name;
      meters.append(meter);
    }
    const best = el("span", "", "fm-picker-row-best");
    const foot = el("span", "", "fm-picker-row-foot");
    foot.append(meters, best);
    // The title is the drawn cover's lettering: an image covers it, and it stays the option's name.
    cover.node.prepend(el("span", info.title, "fm-picker-row-title"));
    element.append(cover.node, foot);
    element.addEventListener("click", () => {
      if (dragged) return;
      if (shown?.host && shown.song !== info.id) options.onSong(info.id);
    });
    rows.set(info.id, {
      song: info,
      element,
      best,
      bestText: "",
      image: cover.image,
      offset: undefined,
      pack: packOf.get(info.id) ?? -1,
    });
    list.append(element);
  }
  const before = push("fm-picker-step fm-picker-prev"),
    after = push("fm-picker-step fm-picker-next");
  before.setAttribute("aria-label", "Previous song");
  after.setAttribute("aria-label", "Next song");
  before.disabled = after.disabled = true;
  before.addEventListener("click", () => stepSong(-1));
  after.addEventListener("click", () => stepSong(1));
  // The packs: a tab each, lit for the pack the selected song is in.
  const tabs = el("div", "", "fm-picker-packs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Song packs");
  const order = [...rows.values()];
  const packTabs = packs.flatMap((pack, index) => {
    const first = order.find((row) => row.pack === index);
    if (!first) return [];
    const element = push("fm-picker-pack");
    element.setAttribute("role", "tab");
    element.setAttribute("aria-selected", "false");
    const count = order.filter((row) => row.pack === index).length;
    element.append(
      el("span", pack.name, "fm-picker-pack-name"),
      el(
        "span",
        count === 1 ? "1 SONG" : `${count} SONGS`,
        "fm-picker-pack-count",
      ),
    );
    element.addEventListener("click", () => {
      if (shown?.host && rows.get(shown.song)?.pack !== index)
        options.onSong(first.song.id);
    });
    tabs.append(element);
    return [{ index, name: pack.name, first: first.song.id, element }];
  });
  tabs.hidden = packTabs.length === 0;
  wheel.append(tabs, before, list, after);

  // A swipe or a sideways scroll turns the carousel, one song for each stretch of the drag.
  let dragFrom: { id: number; x: number } | undefined;
  list.addEventListener("pointerdown", (event) => {
    dragged = false;
    dragFrom = { id: event.pointerId, x: event.clientX };
  });
  list.addEventListener("pointermove", (event) => {
    if (!dragFrom || dragFrom.id !== event.pointerId) return;
    const moved = event.clientX - dragFrom.x;
    if (Math.abs(moved) < DRAG_STEP_PX) return;
    dragged = true;
    dragFrom.x = event.clientX;
    stepSong(moved < 0 ? 1 : -1);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"])
    list.addEventListener(type, () => {
      dragFrom = undefined;
    });
  let scrolled = 0;
  list.addEventListener(
    "wheel",
    (event) => {
      // A vertical scroll is the page's.
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      scrolled += event.deltaX;
      if (Math.abs(scrolled) < DRAG_STEP_PX) return;
      stepSong(scrolled > 0 ? 1 : -1);
      scrolled = 0;
    },
    { passive: false },
  );

  // The selected song.
  const detail = el("section", "", "fm-picker-detail");
  /** The selected song's cover beside its name: what a player who cannot turn the carousel sees of it. */
  const art = el("div", "", "fm-picker-art");
  /** The selected song's pack over its name. */
  const packName = el("p", "", "fm-picker-pack-of");
  const title = el("h2", NO_SONG, "fm-picker-title");
  const artist = el("p", "", "fm-picker-artist");
  const tempo = el("span", "", "fm-picker-tempo");
  const length = el("span", "", "fm-picker-length");
  const facts = el("p", "", "fm-picker-facts");
  facts.append(tempo, length);
  facts.hidden = true;
  const chartsLabel = el("p", "YOUR DIFFICULTY", "fm-picker-label");
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

  const head = el("div", "", "fm-picker-head"),
    names = el("div", "", "fm-picker-names");
  names.append(packName, title, artist, facts);
  head.append(art, names);
  detail.append(head, chartsLabel, charts);
  if (!hideMode) detail.append(modes);
  detail.append(note);
  root.append(wheel, detail);
  root.dataset.host = "false";
  list.setAttribute("aria-disabled", "true");

  /** Turns the carousel so `selected` is in the middle. Writes only the covers whose place changed. */
  function place(selected: string) {
    const at = order.findIndex((row) => row.song.id === selected);
    order.forEach((row, index) => {
      const offset = wheelOffset(index, at, order.length);
      const text = offset === undefined ? undefined : String(offset);
      if (row.offset !== text) {
        row.offset = text;
        if (text === undefined) delete row.element.dataset.offset;
        else row.element.dataset.offset = text;
      }
      if (text !== undefined && row.image) {
        row.image.node.src = row.image.url;
        row.image = undefined;
      }
    });
  }

  function showSong(next: SongInfo | undefined) {
    song = next;
    if (next) {
      const cover = coverOf(next);
      if (cover.image) cover.image.node.src = cover.image.url;
      art.replaceChildren(cover.node);
    } else art.replaceChildren();
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
      place(next.song);
      for (const tab of packTabs) {
        const selected = String(tab.index === row?.pack);
        if (tab.element.getAttribute("aria-selected") !== selected)
          tab.element.setAttribute("aria-selected", selected);
      }
      write(
        packName,
        packTabs.find((tab) => tab.index === row?.pack)?.name ?? "",
      );
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
      before.disabled = after.disabled = !next.host;
      for (const tab of packTabs) tab.element.disabled = !next.host;
      for (const button of modeButtons) button.element.disabled = !next.host;
      note.hidden = next.host;
    }
    showBests(next);
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
  /** To the first song of the pack before or after the selected song's. */
  function stepPack(by: number): boolean {
    if (!shown?.host || packTabs.length === 0) return false;
    const pack = rows.get(shown.song)?.pack;
    const at = packTabs.findIndex((tab) => tab.index === pack);
    const to =
      at < 0
        ? by > 0
          ? 0
          : packTabs.length - 1
        : (at + by + packTabs.length) % packTabs.length;
    const id = packTabs[to]!.first;
    if (id !== shown.song && to !== at) options.onSong(id);
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
        case "ArrowLeft":
        case "KeyA":
        case "KeyJ":
          return stepSong(-1);
        case "ArrowRight":
        case "KeyD":
        case "KeyL":
          return stepSong(1);
        case "ArrowUp":
        case "KeyW":
        case "KeyI":
          return stepChart(-1);
        case "ArrowDown":
        case "KeyS":
        case "KeyK":
          return stepChart(1);
        case "PageUp":
          return stepPack(-1);
        case "PageDown":
          return stepPack(1);
        case "Tab":
        case "KeyM":
          return toggleMode();
        default:
          return false;
      }
    },
  };
}
