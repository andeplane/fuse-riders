import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  BATTLE_MODE,
  SCORE_MODE,
  type ChartInfo,
  type SongInfo,
} from "../src/engine/index.js";
import {
  WHEEL_REACH,
  chartLevel,
  coverTint,
  createSongPicker,
  lengthText,
  tempoText,
  wheelOffset,
  type PickerState,
  type SongPickerOptions,
} from "../src/app/song-picker.js";
import { testLibrary } from "./fixtures/songs.js";

const chart = (name: string, meter: number): ChartInfo => ({
  name,
  meter,
  steps: meter * 40,
  holds: meter,
  mines: meter > 6 ? 3 : 0,
  peak: meter + 2,
});
const FOUR = [
  chart("Easy", 2),
  chart("Medium", 5),
  chart("Hard", 8),
  chart("Challenge", 11),
];
const song = (id: string, charts: ChartInfo[] = FOUR): SongInfo => ({
  id,
  title: `Song ${id}`,
  artist: `Artist ${id}`,
  audio: `music/${id}.mp3`,
  bpm: [128, 128],
  sampleStart: 0,
  sampleLength: 10,
  charts,
  endMs: 105_000,
});
/** Three songs: `b` has only two charts. */
const THREE = [
  song("a"),
  song("b", [chart("Easy", 3), chart("Hard", 9)]),
  song("c"),
];

const state = (over: Partial<PickerState> = {}): PickerState => ({
  song: "a",
  chart: 0,
  mode: SCORE_MODE,
  host: true,
  ...over,
});

function setup(
  songs: readonly SongInfo[] = THREE,
  extra: Pick<
    SongPickerOptions,
    "best" | "hideMode" | "cover" | "packs" | "tools"
  > = {},
) {
  const { document, window } = parseHTML(
    "<!doctype html><html><body></body></html>",
  );
  const calls: string[] = [];
  const picker = createSongPicker({
    document: document as unknown as Document,
    songs,
    onSong: (id) => calls.push(`song ${id}`),
    onChart: (index) => calls.push(`chart ${index}`),
    onMode: (mode) => calls.push(`mode ${mode}`),
    ...extra,
  });
  document.body.append(picker.element);
  const all = <T extends HTMLElement = HTMLElement>(selector: string): T[] => [
    ...picker.element.querySelectorAll<T>(selector),
  ];
  const one = (selector: string): HTMLElement => {
    const found = picker.element.querySelector<HTMLElement>(selector);
    assert.ok(found, `${selector} is in the picker`);
    return found;
  };
  return {
    picker,
    calls,
    all,
    one,
    rows: () => all<HTMLButtonElement>(".fm-picker-row"),
    /** The chips on screen: a song with fewer charts hides the rest. */
    chips: () =>
      all<HTMLButtonElement>(".fm-picker-chip").filter((chip) => !chip.hidden),
    modes: () => all<HTMLButtonElement>(".fm-picker-mode"),
    selected: () =>
      all(".fm-picker-row[aria-selected='true']").map(
        (row) => row.querySelector(".fm-picker-row-title")?.textContent,
      ),
    pressed: () =>
      all(".fm-picker-chip[aria-pressed='true']").map(
        (chip) => chip.querySelector(".fm-picker-chip-name")?.textContent,
      ),
    /** Every DOM write under the picker since the last call, as "type:attribute". */
    writes: (() => {
      const observer = new window.MutationObserver(() => {});
      observer.observe(picker.element, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      return (): string[] =>
        observer
          .takeRecords()
          .map(
            (record: MutationRecord) =>
              `${record.type}:${record.attributeName ?? ""}`,
          );
    })(),
  };
}

test("tempo, length and difficulty read as the song select shows them", () => {
  assert.equal(tempoText([128, 128]), "128 BPM");
  assert.equal(tempoText([120, 140]), "120–140 BPM");
  assert.equal(tempoText([127.6, 128.4]), "128 BPM");
  assert.equal(lengthText(105_000), "1:45");
  assert.equal(lengthText(59_600), "1:00");
  assert.equal(lengthText(0), "0:00");
  assert.equal(chartLevel("Challenge"), "challenge");
  assert.equal(chartLevel("BEGINNER"), "beginner");
  assert.equal(chartLevel("Edit"), "edit");
  assert.equal(chartLevel("Oni"), "other");
});

test("has a cover for every song of the library, with its title and meters", () => {
  const library = testLibrary();
  const f = setup(library.songs);
  const rows = f.rows();
  assert.equal(rows.length, library.songs.length);
  library.songs.forEach((info, index) => {
    const row = rows[index]!;
    assert.equal(row.getAttribute("role"), "option");
    assert.equal(row.type, "button");
    const text = (part: string) =>
      row.querySelector(`.fm-picker-row-${part}`)?.textContent;
    assert.equal(text("title"), info.title);
    assert.ok(row.querySelector(".fm-cover"), "every song wears a cover");
    assert.deepEqual(
      [...row.querySelectorAll<HTMLElement>(".fm-picker-row-meter")].map(
        (meter) => [meter.textContent, meter.dataset.level],
      ),
      info.charts.map((item) => [String(item.meter), chartLevel(item.name)]),
    );
  });
  assert.equal(f.one(".fm-picker-list").getAttribute("role"), "listbox");
  // Nothing is selected until the page says what is.
  assert.deepEqual(f.selected(), []);
  assert.deepEqual(f.chips(), []);
});

test("shows the selected song's details and one chip per chart", () => {
  const library = testLibrary();
  const grid = library.song("grid")!;
  const f = setup(library.songs);
  f.picker.update(state({ song: "grid", chart: 1 }));
  assert.deepEqual(f.selected(), ["Grid"]);
  assert.equal(f.one(".fm-picker-title").textContent, "Grid");
  assert.equal(f.one(".fm-picker-artist").textContent, "Test");
  assert.equal(f.one(".fm-picker-tempo").textContent, "120 BPM");
  assert.equal(f.one(".fm-picker-length").textContent, lengthText(grid.endMs));
  const chips = f.chips();
  assert.equal(chips.length, 2);
  grid.charts.forEach((info, index) => {
    const chip = chips[index]!;
    const text = (part: string) =>
      chip.querySelector(`.fm-picker-chip-${part}`)?.textContent;
    assert.equal(text("name"), info.name);
    assert.equal(text("meter"), String(info.meter));
    assert.equal(
      text("stats"),
      `STEPS ${info.steps}HOLDS ${info.holds}MINES ${info.mines}PEAK ${info.peak}/s`,
    );
    assert.equal(chip.dataset.level, chartLevel(info.name));
    assert.equal(
      chip.querySelectorAll(".fm-picker-chip-bars .fm-picker-on").length,
      Math.min(info.meter, 10),
    );
    assert.equal(chip.querySelectorAll(".fm-picker-chip-bars i").length, 10);
  });
  assert.deepEqual(f.pressed(), ["Hard"]);
  assert.deepEqual(
    chips.map((chip) => chip.getAttribute("aria-pressed")),
    ["false", "true"],
  );
});

test("a row click asks for the song, for a host only, and the picker waits for the page's answer", () => {
  const f = setup();
  f.picker.update(state());
  f.rows()[2]!.click();
  assert.deepEqual(f.calls, ["song c"]);
  // It never moves on its own: in a room the choice goes through the log first.
  assert.deepEqual(f.selected(), ["Song a"]);
  f.rows()[0]!.click();
  assert.deepEqual(f.calls, ["song c"], "the song already shown is not news");

  f.picker.update(state({ host: false }));
  f.rows()[1]!.click();
  f.rows()[2]!.click();
  assert.deepEqual(f.calls, ["song c"]);
  assert.equal(f.picker.element.dataset.host, "false");
  assert.equal(f.one(".fm-picker-list").getAttribute("aria-disabled"), "true");
  // The covers are never disabled: the page shows a guest the chosen song as a card instead of the carousel.
  assert.equal(
    f.rows().some((row) => row.disabled),
    false,
  );

  f.picker.update(state({ host: true }));
  assert.equal(f.one(".fm-picker-list").hasAttribute("aria-disabled"), false);
  f.rows()[1]!.click();
  assert.deepEqual(f.calls, ["song c", "song b"]);
});

test("a chip click asks for the chart, for a guest as much as a host", () => {
  for (const host of [true, false]) {
    const f = setup();
    f.picker.update(state({ host }));
    f.chips()[2]!.click();
    assert.deepEqual(f.calls, ["chart 2"]);
    assert.deepEqual(f.pressed(), ["Easy"], "until the page answers");
    f.chips()[0]!.click();
    assert.deepEqual(
      f.calls,
      ["chart 2"],
      "the chart already shown is not news",
    );
    assert.equal(
      f.chips().some((chip) => chip.disabled),
      false,
    );
  }
});

test("the mode switch is the host's", () => {
  const f = setup();
  f.picker.update(state());
  const [score, battle] = f.modes();
  assert.ok(score && battle);
  assert.equal(score.textContent, "SCORE ATTACKBest accuracy wins");
  assert.equal(
    battle.textContent,
    "BATTLEHit the glowing arrows for power-ups, throw them at your friends",
  );
  assert.deepEqual(
    [score.getAttribute("aria-pressed"), battle.getAttribute("aria-pressed")],
    ["true", "false"],
  );
  assert.deepEqual([score.disabled, battle.disabled], [false, false]);
  battle.click();
  score.click();
  assert.deepEqual(f.calls, [`mode ${BATTLE_MODE}`]);

  f.picker.update(state({ mode: BATTLE_MODE }));
  assert.deepEqual(
    [score.getAttribute("aria-pressed"), battle.getAttribute("aria-pressed")],
    ["false", "true"],
  );
  score.click();
  assert.deepEqual(f.calls, [`mode ${BATTLE_MODE}`, `mode ${SCORE_MODE}`]);

  f.calls.length = 0;
  f.picker.update(state({ mode: BATTLE_MODE, host: false }));
  assert.deepEqual([score.disabled, battle.disabled], [true, true]);
  score.click();
  battle.click();
  assert.deepEqual(f.calls, []);
  assert.equal(
    battle.getAttribute("aria-pressed"),
    "true",
    "a guest still sees the mode",
  );
});

test("a guest is told who picks what, a host is not", () => {
  const f = setup();
  const note = f.one(".fm-picker-note");
  f.picker.update(state({ host: false }));
  assert.equal(note.hidden, false);
  assert.match(note.textContent ?? "", /host picks the song/i);
  assert.match(note.textContent ?? "", /you pick your difficulty/i);
  f.picker.update(state({ host: true }));
  assert.equal(note.hidden, true);
});

test("hideMode leaves the mode switch out", () => {
  const f = setup(THREE, { hideMode: true });
  f.picker.update(state());
  assert.deepEqual(f.modes(), []);
  assert.equal(f.picker.key("Tab"), false);
  assert.equal(f.picker.key("KeyM"), false);
  assert.deepEqual(f.calls, []);
  f.picker.update(state({ host: false }));
  assert.doesNotMatch(f.one(".fm-picker-note").textContent ?? "", /mode/i);
});

test("update moves the selection and the pressed states to the new state", () => {
  const f = setup();
  f.picker.update(state());
  assert.deepEqual(f.selected(), ["Song a"]);
  assert.deepEqual(f.pressed(), ["Easy"]);

  f.picker.update(state({ song: "c", chart: 3, mode: BATTLE_MODE }));
  assert.deepEqual(f.selected(), ["Song c"]);
  assert.equal(f.one(".fm-picker-title").textContent, "Song c");
  assert.equal(f.one(".fm-picker-artist").textContent, "Artist c");
  assert.deepEqual(f.pressed(), ["Challenge"]);
  assert.deepEqual(
    f.modes().map((mode) => mode.getAttribute("aria-pressed")),
    ["false", "true"],
  );

  f.picker.update(state({ song: "c", chart: 1, mode: BATTLE_MODE }));
  assert.deepEqual(f.selected(), ["Song c"]);
  assert.deepEqual(f.pressed(), ["Medium"]);
});

test("update with an equal state writes nothing to the DOM", () => {
  const f = setup(THREE, { best: () => "AA 94.2%" });
  const shown = state({ song: "b", chart: 1, mode: BATTLE_MODE, host: false });
  f.picker.update(shown);
  const rows = f.rows(),
    chips = f.chips(),
    html = f.picker.element.outerHTML;
  f.writes();

  f.picker.update(shown);
  f.picker.update({ ...shown });
  assert.deepEqual(f.writes(), []);
  assert.equal(f.picker.element.outerHTML, html);
  f.rows().forEach((row, index) => assert.equal(row, rows[index]));
  f.chips().forEach((chip, index) => assert.equal(chip, chips[index]));
});

test("a change writes only what changed", () => {
  const f = setup();
  f.picker.update(state());
  f.writes();
  f.picker.update(state({ chart: 2 }));
  // Two chips change their pressed state; covers, texts and the mode are left alone.
  assert.deepEqual(f.writes(), [
    "attributes:aria-pressed",
    "attributes:aria-pressed",
  ]);
  f.picker.update(state({ chart: 2, mode: BATTLE_MODE }));
  assert.deepEqual(f.writes(), [
    "attributes:aria-pressed",
    "attributes:aria-pressed",
  ]);
});

test("a state object the caller reuses and changes is still drawn", () => {
  const f = setup();
  const live = state();
  f.picker.update(live);
  live.song = "c";
  live.chart = 2;
  f.picker.update(live);
  assert.deepEqual(f.selected(), ["Song c"]);
  assert.deepEqual(f.pressed(), ["Hard"]);
});

test("chips are refilled for another song, not rebuilt, so a focused one stays", () => {
  const f = setup();
  f.picker.update(state({ chart: 1 }));
  const before = f.chips();
  assert.equal(before.length, 4);

  f.picker.update(state({ song: "b", chart: 1 }));
  const two = f.chips();
  assert.equal(two.length, 2);
  two.forEach((chip, index) => assert.equal(chip, before[index]));
  assert.deepEqual(
    two.map((chip) => chip.querySelector(".fm-picker-chip-name")?.textContent),
    ["Easy", "Hard"],
  );
  assert.deepEqual(
    two.map((chip) => chip.dataset.level),
    ["easy", "hard"],
  );

  f.picker.update(state({ song: "c", chart: 1 }));
  const back = f.chips();
  assert.equal(back.length, 4);
  back.forEach((chip, index) => assert.equal(chip, before[index]));
  assert.deepEqual(f.pressed(), ["Medium"]);
});

test("a chart past the song's charts shows its last one", () => {
  const f = setup();
  f.picker.update(state({ song: "b", chart: 3 }));
  assert.deepEqual(f.pressed(), ["Hard"]);
  // The last chip is what is shown, so pressing it asks for nothing; the other is a change.
  f.chips()[1]!.click();
  assert.deepEqual(f.calls, []);
  f.chips()[0]!.click();
  assert.deepEqual(f.calls, ["chart 0"]);

  // The preference survives: back on a song with four charts it is the fourth again.
  f.picker.update(state({ song: "c", chart: 3 }));
  assert.deepEqual(f.pressed(), ["Challenge"]);
  for (const odd of [-1, Number.NaN, 2.7]) {
    f.picker.update(state({ song: "c", chart: odd }));
    assert.equal(f.pressed().length, 1, `chart ${odd} still shows one chip`);
  }
});

test("a song the library does not have selects nothing", () => {
  const f = setup();
  f.picker.update(state({ song: "a" }));
  f.picker.update(state({ song: "gone" }));
  assert.deepEqual(f.selected(), []);
  assert.deepEqual(f.chips(), []);
  assert.equal(f.one(".fm-picker-title").textContent, "SELECT A SONG");
  assert.equal(f.one(".fm-picker-facts").hidden, true);
  assert.equal(f.picker.key("ArrowDown"), false, "no song, no chart to change");
  // From nowhere, right is the first song and left the last.
  assert.equal(f.picker.key("ArrowRight"), true);
  assert.equal(f.picker.key("ArrowLeft"), true);
  assert.deepEqual(f.calls, ["song a", "song c"]);
});

test("keys turn the carousel for a host and wrap at both ends", () => {
  const f = setup();
  assert.equal(f.picker.key("ArrowRight"), false, "nothing is shown yet");
  const press = (code: string, from: Partial<PickerState>) => {
    f.calls.length = 0;
    f.picker.update(state(from));
    return [f.picker.key(code), ...f.calls];
  };
  for (const right of ["ArrowRight", "KeyD", "KeyL"]) {
    assert.deepEqual(press(right, { song: "a" }), [true, "song b"]);
    assert.deepEqual(press(right, { song: "c" }), [true, "song a"]);
  }
  for (const left of ["ArrowLeft", "KeyA", "KeyJ"]) {
    assert.deepEqual(press(left, { song: "b" }), [true, "song a"]);
    assert.deepEqual(press(left, { song: "a" }), [true, "song c"]);
  }
  // The song is the host's: a guest's key is left for the page.
  for (const code of [
    "ArrowLeft",
    "ArrowRight",
    "KeyA",
    "KeyD",
    "KeyJ",
    "KeyL",
  ])
    assert.deepEqual(press(code, { song: "a", host: false }), [false]);
  for (const code of ["Enter", "Space", "KeyQ", ""])
    assert.deepEqual(press(code, {}), [false]);
});

test("keys move the chart for anyone and wrap at both ends", () => {
  const f = setup();
  const press = (code: string, from: Partial<PickerState>) => {
    f.calls.length = 0;
    f.picker.update(state(from));
    return [f.picker.key(code), ...f.calls];
  };
  for (const host of [true, false]) {
    for (const down of ["ArrowDown", "KeyS", "KeyK"]) {
      assert.deepEqual(press(down, { chart: 0, host }), [true, "chart 1"]);
      assert.deepEqual(press(down, { chart: 3, host }), [true, "chart 0"]);
    }
    for (const up of ["ArrowUp", "KeyW", "KeyI"]) {
      assert.deepEqual(press(up, { chart: 2, host }), [true, "chart 1"]);
      assert.deepEqual(press(up, { chart: 0, host }), [true, "chart 3"]);
    }
  }
  // On a song with two charts a fourth-chart preference stands on its last, and moves from there.
  assert.deepEqual(press("ArrowUp", { song: "b", chart: 3 }), [
    true,
    "chart 0",
  ]);
  assert.deepEqual(press("ArrowDown", { song: "b", chart: 3 }), [
    true,
    "chart 0",
  ]);
});

test("Tab and M toggle the mode for a host", () => {
  const f = setup();
  f.picker.update(state());
  assert.equal(f.picker.key("Tab"), true);
  f.picker.update(state({ mode: BATTLE_MODE }));
  assert.equal(f.picker.key("KeyM"), true);
  assert.deepEqual(f.calls, [`mode ${BATTLE_MODE}`, `mode ${SCORE_MODE}`]);
  f.picker.update(state({ host: false }));
  assert.equal(
    f.picker.key("Tab"),
    false,
    "a guest's Tab still moves the focus",
  );
  assert.equal(f.picker.key("KeyM"), false);
  assert.equal(f.calls.length, 2);
});

test("one song and one chart: the keys are used but there is nothing to ask for", () => {
  const f = setup([song("solo", [chart("Medium", 5)])]);
  f.picker.update(state({ song: "solo" }));
  for (const code of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
    assert.equal(f.picker.key(code), true);
  assert.deepEqual(f.calls, []);
});

test("best results show on the chips and, for the chart the player would play, on the rows", () => {
  const bests = new Map([
    ["a/0", "B 71.0%"],
    ["a/2", "AA 94.2%"],
    ["b/1", "S 99.1%"],
  ]);
  const f = setup(THREE, { best: (id, index) => bests.get(`${id}/${index}`) });
  const chipBests = () =>
    f
      .chips()
      .map((chip) => chip.querySelector(".fm-picker-chip-best")?.textContent);
  const rowBests = () =>
    f
      .rows()
      .map((row) => row.querySelector(".fm-picker-row-best")?.textContent);

  f.picker.update(state({ chart: 2 }));
  assert.deepEqual(chipBests(), ["B 71.0%", "", "AA 94.2%", ""]);
  // Row b has two charts, so chart 2 plays its second.
  assert.deepEqual(rowBests(), ["AA 94.2%", "S 99.1%", ""]);

  f.picker.update(state({ chart: 0 }));
  assert.deepEqual(rowBests(), ["B 71.0%", "", ""]);

  f.picker.update(state({ song: "b", chart: 0 }));
  assert.deepEqual(chipBests(), ["", "S 99.1%"]);

  // A new best after a song shows on the next update although the state is the same, and is all that is written.
  f.writes();
  bests.set("b/0", "A 88.0%");
  f.picker.update(state({ song: "b", chart: 0 }));
  assert.deepEqual(chipBests(), ["A 88.0%", "S 99.1%"]);
  assert.deepEqual(rowBests(), ["B 71.0%", "A 88.0%", ""]);
  assert.deepEqual(f.writes(), ["childList:", "childList:"]);
});

test("the carousel is a ring: each song's place is the nearest way round from the selected one", () => {
  assert.equal(wheelOffset(3, 3, 20), 0);
  assert.equal(wheelOffset(4, 3, 20), 1);
  assert.equal(wheelOffset(2, 3, 20), -1);
  // Round the ends: the last song sits left of the first.
  assert.equal(wheelOffset(19, 0, 20), -1);
  assert.equal(wheelOffset(0, 19, 20), 1);
  // One past the reach waits off the edge; further out is not drawn.
  assert.equal(wheelOffset(WHEEL_REACH + 1, 0, 20), WHEEL_REACH + 1);
  assert.equal(wheelOffset(WHEEL_REACH + 2, 0, 20), undefined);
  assert.equal(wheelOffset(10, 0, 20), undefined);
  // A short ring puts each song on one side only, and nothing selected places nothing.
  assert.deepEqual(
    [0, 1, 2].map((index) => wheelOffset(index, 0, 3)),
    [0, 1, -1],
  );
  assert.deepEqual(
    [0, 1].map((index) => wheelOffset(index, 0, 2)),
    [0, 1],
  );
  assert.equal(wheelOffset(0, -1, 3), undefined);
  assert.equal(wheelOffset(0, 0, 0), undefined);
});

test("update turns the carousel to the selected song and writes only the covers that moved", () => {
  const many = Array.from({ length: 12 }, (_, index) => song(`s${index}`));
  const f = setup(many);
  const offsets = () => f.rows().map((row) => row.dataset.offset ?? "");
  f.picker.update(state({ song: "s0" }));
  assert.deepEqual(offsets(), [
    "0",
    "1",
    "2",
    "3",
    "4",
    "",
    "",
    "",
    "-4",
    "-3",
    "-2",
    "-1",
  ]);
  f.picker.update(state({ song: "s1" }));
  assert.deepEqual(offsets(), [
    "-1",
    "0",
    "1",
    "2",
    "3",
    "4",
    "",
    "",
    "",
    "-4",
    "-3",
    "-2",
  ]);
  // Tab stops on the selected cover alone.
  assert.deepEqual(
    f.rows().map((row) => row.getAttribute("tabindex")),
    ["-1", "0", ...many.slice(2).map(() => "-1")],
  );
  // A song the library does not have leaves nothing on the carousel.
  f.picker.update(state({ song: "nope" }));
  assert.deepEqual(
    offsets(),
    many.map(() => ""),
  );
  assert.ok(f.rows().every((row) => row.getAttribute("tabindex") === "-1"));
});

test("a click on a side cover or an arrow asks for that song, for a host only", () => {
  const f = setup();
  const [before, after] = [
    f.one(".fm-picker-prev") as HTMLButtonElement,
    f.one(".fm-picker-next") as HTMLButtonElement,
  ];
  // Nobody can turn it until the page says who may.
  assert.equal(before.disabled, true);
  f.picker.update(state({ song: "a" }));
  assert.equal(before.disabled, false);
  after.click();
  before.click();
  assert.deepEqual(f.calls, ["song b", "song c"]);
  f.picker.update(state({ song: "a", host: false }));
  assert.equal(after.disabled, true);
  f.calls.length = 0;
  after.click();
  f.rows()[1]!.click();
  assert.deepEqual(f.calls, []);
  assert.equal(f.picker.element.dataset.host, "false");
});

test("a sideways drag turns the carousel one song for each stretch, and swallows the click that ends it", () => {
  const f = setup();
  f.picker.update(state({ song: "a" }));
  const list = f.one(".fm-picker-list");
  const window = list.ownerDocument.defaultView!;
  const pointer = (type: string, clientX: number) => {
    const event = new window.Event(type, { bubbles: true });
    Object.assign(event, { pointerId: 1, clientX });
    list.dispatchEvent(event);
  };
  pointer("pointerdown", 200);
  pointer("pointermove", 180);
  assert.deepEqual(f.calls, [], "a short move is not a turn");
  pointer("pointermove", 140);
  assert.deepEqual(f.calls, ["song b"], "dragging left brings the next song");
  pointer("pointerup", 140);
  f.rows()[2]!.click();
  assert.deepEqual(f.calls, ["song b"], "the drag's own click asks nothing");
  // The next press is a click again.
  pointer("pointerdown", 100);
  pointer("pointerup", 100);
  f.rows()[2]!.click();
  assert.deepEqual(f.calls, ["song b", "song c"]);
  // Dragging right goes back.
  f.calls.length = 0;
  pointer("pointerdown", 100);
  pointer("pointermove", 170);
  assert.deepEqual(f.calls, ["song c"]);
  // A drag that ended off the covers leaves no click behind: a key's click (detail 0) on a cover still asks.
  pointer("pointerup", 170);
  const byKey = new window.Event("click", { bubbles: true });
  Object.assign(byKey, { detail: 0 });
  f.rows()[1]!.dispatchEvent(byKey);
  assert.deepEqual(f.calls, ["song c", "song b"]);
});

test("a cover is drawn from the song's id, and wears the song's image once it comes near", () => {
  assert.deepEqual(coverTint("snaky-blue"), coverTint("snaky-blue"));
  assert.notDeepEqual(coverTint("snaky-blue"), coverTint("snaky-jazz"));
  for (const id of ["", "a", "victory", "reduced-noise-orchestra"]) {
    const tint = coverTint(id);
    assert.ok(tint.a >= 0 && tint.a < 360 && tint.b >= 0 && tint.b < 360);
    assert.ok(tint.angle >= 20 && tint.angle <= 160);
  }
  const many = Array.from({ length: 12 }, (_, index) => song(`s${index}`));
  const f = setup(many, {
    cover: (info) => (info.id === "s3" ? undefined : `covers/${info.id}.jpg`),
  });
  const images = () =>
    f.rows().map((row) => {
      const image = row.querySelector<HTMLImageElement>(".fm-cover-image");
      return image ? image.getAttribute("src") : "none";
    });
  // Nothing is fetched before the page shows a song.
  assert.deepEqual(new Set(images()), new Set([null, "none"]));
  // A guest never sees the carousel: only the chosen song's card fetches its cover.
  f.picker.update(state({ song: "s0", host: false }));
  assert.deepEqual(new Set(images()), new Set([null, "none"]));
  assert.equal(
    f.one(".fm-picker-art .fm-cover-image").getAttribute("src"),
    "covers/s0.jpg",
  );
  f.picker.update(state({ song: "s0" }));
  assert.deepEqual(images(), [
    "covers/s0.jpg",
    "covers/s1.jpg",
    "covers/s2.jpg",
    "none",
    "covers/s4.jpg",
    null,
    null,
    null,
    "covers/s8.jpg",
    "covers/s9.jpg",
    "covers/s10.jpg",
    "covers/s11.jpg",
  ]);
  // The selected song's card carries its cover too: what a guest sees of the host's choice.
  assert.equal(
    f.one(".fm-picker-art .fm-cover-image").getAttribute("src"),
    "covers/s0.jpg",
  );
  f.picker.update(state({ song: "s3" }));
  assert.equal(f.picker.element.querySelector(".fm-picker-art img"), null);
  assert.ok(f.one(".fm-picker-art .fm-cover"));
  // An image that fails to load leaves the drawn cover.
  const broken = f.rows()[0]!.querySelector(".fm-cover-image")!;
  broken.dispatchEvent(new broken.ownerDocument.defaultView!.Event("error"));
  assert.equal(f.rows()[0]!.querySelector(".fm-cover-image"), null);
});

test("packs group the carousel: a tab each, the songs pack by pack, and PageUp/PageDown between them", () => {
  const six = ["a", "b", "c", "d", "e", "f"].map((id) => song(id));
  const f = setup(six, {
    packs: [
      { id: "jazz", name: "JAZZ MIX", songs: ["e", "b"] },
      { id: "empty", name: "EMPTY", songs: ["not-here"] },
      { id: "fuse", name: "FUSE", songs: ["a", "d"] },
    ],
  });
  const titles = () =>
    f
      .rows()
      .map((row) => row.querySelector(".fm-picker-row-title")?.textContent);
  // Pack by pack in the pack's order; the songs no pack names come last. An empty pack has no tab.
  assert.deepEqual(titles(), [
    "Song e",
    "Song b",
    "Song a",
    "Song d",
    "Song c",
    "Song f",
  ]);
  const tabs = () => f.all<HTMLButtonElement>(".fm-picker-pack");
  const lit = () =>
    tabs()
      .filter((tab) => tab.getAttribute("aria-selected") === "true")
      .map((tab) => tab.querySelector(".fm-picker-pack-name")?.textContent);
  assert.deepEqual(
    tabs().map((tab) => tab.textContent),
    ["JAZZ MIX2 SONGS", "FUSE2 SONGS"],
  );
  assert.deepEqual(lit(), []);

  f.picker.update(state({ song: "d" }));
  assert.deepEqual(lit(), ["FUSE"]);
  assert.equal(f.one(".fm-picker-pack-of").textContent, "FUSE");
  // Turning past a pack's last song goes on into what follows.
  assert.equal(f.picker.key("ArrowRight"), true);
  assert.deepEqual(f.calls, ["song c"]);
  f.picker.update(state({ song: "c" }));
  assert.deepEqual(lit(), [], "a song outside every pack lights none");
  assert.equal(f.one(".fm-picker-pack-of").textContent, "");

  // A tab or a page key goes to the pack's first song; the pack already shown asks nothing.
  f.calls.length = 0;
  f.picker.update(state({ song: "d" }));
  tabs()[1]!.click();
  tabs()[0]!.click();
  assert.deepEqual(f.calls, ["song e"]);
  assert.equal(f.picker.key("PageDown"), true);
  assert.equal(f.picker.key("PageUp"), true);
  assert.deepEqual(f.calls, ["song e", "song e", "song e"], "two packs wrap");
  f.picker.update(state({ song: "b" }));
  assert.equal(f.picker.key("PageDown"), true);
  assert.equal(f.calls.at(-1), "song a");

  // The packs are the host's to change.
  f.calls.length = 0;
  f.picker.update(state({ song: "b", host: false }));
  assert.equal(tabs()[1]!.disabled, true);
  tabs()[1]!.click();
  assert.equal(f.picker.key("PageDown"), false);
  assert.deepEqual(f.calls, []);
});

test("without packs there are no tabs and the songs keep the library's order", () => {
  const one = setup(THREE, {
    packs: [{ id: "only", name: "ONLY", songs: ["a", "b", "c"] }],
  });
  one.picker.update(state());
  assert.equal(one.all(".fm-picker-pack").length, 1);
  assert.equal(
    one.picker.key("PageDown"),
    false,
    "one pack: the key stays the page's",
  );
  const f = setup();
  assert.equal(f.one(".fm-picker-packs").hidden, true);
  assert.deepEqual(f.all(".fm-picker-pack"), []);
  f.picker.update(state());
  assert.equal(f.picker.key("PageDown"), false);
  assert.deepEqual(
    f
      .rows()
      .map((row) => row.querySelector(".fm-picker-row-title")?.textContent),
    ["Song a", "Song b", "Song c"],
  );
});

test("with no songs it says so and ignores everything", () => {
  const f = setup([]);
  assert.equal(f.picker.element.textContent, "No songs loaded");
  assert.deepEqual(f.rows(), []);
  f.picker.update(state());
  for (const code of ["ArrowDown", "ArrowRight", "Tab"])
    assert.equal(f.picker.key(code), false);
  assert.equal(f.picker.element.textContent, "No songs loaded");
  assert.deepEqual(f.calls, []);
});

test("the picker's tools (RANDOM SONG) sit at the top of the carousel, before the covers and never under the levels", () => {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const random = (document as unknown as Document).createElement("button");
  random.textContent = "RANDOM SONG";
  const f = setup(THREE, { tools: [random] });
  f.picker.update(state());
  const wheel = f.one(".fm-picker-wheel"),
    tools = f.one(".fm-picker-tools");
  assert.equal(tools.hidden, false);
  assert.equal(tools.contains(random), true);
  assert.equal(wheel.contains(random), true);
  assert.equal(f.one(".fm-picker-detail").contains(random), false);
  // Document order: the tools, then the covers, then the levels.
  const order = f.all(".fm-picker-tools, .fm-picker-list, .fm-picker-charts");
  assert.deepEqual(
    order.map((node) => node.className),
    ["fm-picker-tools", "fm-picker-list", "fm-picker-charts"],
  );
  // No tools, no empty strip.
  assert.equal(setup().one(".fm-picker-tools").hidden, true);
});
