import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  clockText,
  createTimingPanel,
  errorText,
  micText,
  pressText,
  timingReport,
  type OffsetKey,
  type TimingView,
} from "../src/app/debug-timing.js";
import { createLatencyProbe } from "../src/app/latency.js";
import { MIC_MIN_PRESSES, type MicReport } from "../src/app/mic.js";
import { EYE_MIN_HITS } from "../src/app/timing-session.js";

const three = (median: number, spread: number, n: number) => ({
  median,
  spread,
  n,
});
const micReport = (over: Partial<MicReport> = {}): MicReport => ({
  clicks: 40,
  clicksHeard: 40,
  roundTrip: three(63.2, 0.3, 40),
  presses: 30,
  pressesHeard: 29,
  trueMs: three(-21, 6, 29),
  gameMs: three(6, 6.2, 29),
  residualMs: three(27, 1.1, 29),
  stampMs: three(-6, 1, 29),
  keyFloor: 0.01,
  leak: 0.001,
  recent: [],
  ...over,
});
const view = (over: Partial<TimingView> = {}): TimingView => ({
  mode: "screen",
  report: createLatencyProbe().report(),
  context: {
    baseMs: 5.3,
    outputMs: 168,
    driftMs: -0.4,
    audible: true,
    offsetMs: 0,
    hits: { biasMs: 0, spreadMs: 0, used: 0 },
  },
  clock: {
    source: "paired",
    lagMs: 176,
    pairedMs: 0.11,
    sampleRate: 48000,
    restarts: 0,
    hz: 120,
    leadMs: 8.3,
  },
  offsets: { audioMs: 0, inputMs: 0, visualMs: 0 },
  ear: [],
  eye: [],
  presses: [],
  totalPresses: 0,
  bent: 0,
  leastSlackMs: undefined,
  song: "STEADY CLICK 2.5 / s",
  clickBpm: 150,
  mic: {
    state: "off",
    note: "",
    label: "",
    reportedMs: undefined,
    level: 0,
    report: undefined,
    devices: [],
    device: "",
  },
  log: { lines: 0, file: "" },
  ...over,
});

function mount(options: { details?: boolean } = {}) {
  const { document } = parseHTML("<!doctype html><body></body>");
  const calls: string[] = [];
  const panel = createTimingPanel(
    document,
    {
      nudge: (key: OffsetKey, by: number) => calls.push(`nudge ${key} ${by}`),
      set: (key: OffsetKey, ms: number) => calls.push(`set ${key} ${ms}`),
      centre: () => calls.push("centre"),
      resetHits: () => calls.push("reset"),
      click: (bpm) => calls.push(`click ${bpm}`),
      openScreen: () => calls.push("openScreen"),
      mic: (on, device) => calls.push(`mic ${on} ${device ?? ""}`.trim()),
      applyMic: () => calls.push("applyMic"),
      copy: (text) => calls.push(`copy ${text.split("\n")[0]}`),
      download: () => calls.push("download"),
    },
    options,
  );
  document.body.append(panel.element);
  const button = (text: string, within: ParentNode = panel.element) =>
    [...within.querySelectorAll("button")].find(
      (each) => each.textContent === text,
    )!;
  return { document, panel, calls, button };
}

test("the lines say what was measured, signed and in ms", () => {
  assert.equal(errorText("by ear", []), "by ear: no hits yet");
  assert.equal(
    errorText("by ear", [-20, -16, -18]),
    "by ear: −18.0 ms ±1.6 (3 hits)",
  );
  const table = pressText([
    {
      id: 1,
      source: "key",
      column: 1,
      stamp: 1000,
      handled: 1000.4,
      used: true,
      songMs: 12082.3,
      frameMs: 6.7,
      drawnMs: 7.1,
      judgment: 0,
      offMs: -18,
      slackMs: 160,
    },
    {
      id: 2,
      source: "touch",
      column: 3,
      stamp: 0,
      handled: 2000,
      used: false,
      songMs: 13000,
      slackMs: -12,
    },
  ]).split("\n");
  assert.match(table[1]!, /^↓ +0\.4 +6\.7 +12082 {2}MARV −18$/);
  assert.match(table[2]!, /^→ +no ts +- +13000 {2}- {2}MOVED BY ROOM CLOCK$/);

  const game = (over: Partial<TimingView> = {}) =>
    view({ mode: "game", ...over });
  const clocks = clockText(game({ totalPresses: 40, leastSlackMs: 131.6 }));
  assert.match(clocks, /song position from .*getOutputTimestamp/);
  assert.match(clocks, /heard 176\.0 ms behind the audio clock/);
  assert.match(clocks, /display 120 Hz, picture drawn 8\.3 ms ahead/);
  assert.match(
    clocks,
    /room clock: moved 0 of 40 presses \(least room 132 ms\)/,
  );
  assert.match(
    clockText(game({ totalPresses: 40, bent: 3 })),
    /room clock: MOVED 3 of 40 presses/,
  );
  assert.match(
    clockText(game({ clock: { ...view().clock, source: "room" } })),
    /the room clock \(no sound\)/,
  );
  // The Timing screen has no room: its clocks say nothing of one.
  const screen = clockText(view({ totalPresses: 40, leastSlackMs: 131.6 }));
  assert.match(screen, /click position from .*getOutputTimestamp/);
  assert.match(screen, /display 120 Hz/);
  assert.doesNotMatch(screen, /room/);
  assert.match(
    clockText(view({ clock: { ...view().clock, source: "room" } })),
    /the page's clock \(no sound\)/,
  );
});

test("the microphone's lines go from nothing heard to a number to act on", () => {
  const offsets = { audioMs: 0, inputMs: 0, visualMs: 0 };
  const on = {
    ...view().mic,
    state: "on" as const,
    label: "MacBook Pro Microphone",
    reportedMs: 12,
  };
  assert.equal(
    micText({ ...view().mic, state: "failed", note: "No." }, offsets),
    "No.",
  );
  assert.match(
    micText(
      {
        ...on,
        report: micReport({
          clicksHeard: 0,
          roundTrip: three(0, 0, 0),
          presses: 0,
          pressesHeard: 0,
          residualMs: three(0, 0, 0),
        }),
      },
      offsets,
    ),
    /no tick heard yet \(40 looked for\)/,
  );
  const good = micText({ ...on, report: micReport() }, offsets);
  assert.match(good, /MacBook Pro Microphone \(reports 12 ms\)/);
  assert.match(
    good,
    /tick heard 63\.2 ms after it was scheduled ±0\.3 \(40 of 40 ticks\)/,
  );
  assert.match(good, /game − microphone: +\+27\.0 ms ±1\.1 {2}\(n=29\)/);
  assert.match(good, /places presses 27 ms later than you made them/);
  assert.match(
    micText(
      { ...on, report: micReport({ residualMs: three(1.2, 1, 29) }) },
      offsets,
    ),
    /offsets are right for this device/,
  );
  assert.match(
    micText(
      { ...on, report: micReport({ residualMs: three(27, 1, 5) }) },
      offsets,
    ),
    new RegExp(`${MIC_MIN_PRESSES - 5} more presses to trust it`),
  );
  assert.match(
    micText(
      { ...on, report: micReport({ presses: 30, pressesHeard: 4 }) },
      offsets,
    ),
    /keys heard: 4 of 30 · tap firmer/,
  );
});

test("the panel shows the offsets and its buttons report what was asked, without keeping the focus", () => {
  const { panel, calls, button } = mount();
  panel.update(view({ offsets: { audioMs: 140, inputMs: -12, visualMs: 5 } }));
  const rows = [...panel.element.querySelectorAll(".fm-dt-offset")];
  assert.deepEqual(
    rows.map((row) => row.querySelector("output")!.textContent),
    ["+140 ms", "−12 ms", "+5 ms"],
  );
  button("+5", rows[0]!).click();
  button("−1", rows[1]!).click();
  button("0", rows[2]!).click();
  assert.deepEqual(calls, [
    "nudge audioMs 5",
    "nudge inputMs -1",
    "set visualMs 0",
  ]);
  for (const each of panel.element.querySelectorAll("button")) {
    assert.equal(each.type, "button");
    // A game key must never press a panel button.
    assert.equal(each.tabIndex, -1, each.textContent ?? "");
  }
  calls.length = 0;
  button("2.5 / s").click();
  button("LISTEN WITH THE MICROPHONE").click();
  button("COPY").click();
  button("SAVE LOG").click();
  button("RESET").click();
  assert.deepEqual(calls, [
    "click 150",
    "mic true",
    "copy Fusemania timing · STEADY CLICK 2.5 / s",
    "download",
    "reset",
  ]);
});

test("by ear centres the input offset; by eye against by ear sets the visual offset", () => {
  const { panel, calls, button } = mount();
  panel.update(view({ ear: [-18, -17] }));
  assert.equal(
    button("CENTRE BY EAR").disabled,
    true,
    "two hits are no measurement",
  );
  assert.equal(button("SET VISUAL").disabled, true);
  const ear = Array.from({ length: EYE_MIN_HITS }, () => -12),
    eye = Array.from({ length: EYE_MIN_HITS }, () => 9);
  panel.update(
    view({ ear, eye, offsets: { audioMs: 0, inputMs: 0, visualMs: 4 } }),
  );
  assert.match(
    panel.element.textContent ?? "",
    /By eye you hit 21 ms later than by ear: the picture is late\. SET VISUAL makes it \+25 ms\./,
  );
  button("CENTRE BY EAR").click();
  button("SET VISUAL").click();
  assert.deepEqual(calls, ["centre", "set visualMs 25"]);
  panel.update(view({ ear, eye: ear }));
  assert.equal(button("SET VISUAL").disabled, true);
  assert.match(panel.element.textContent ?? "", /By eye and by ear agree/);
});

test("the microphone's APPLY shows only for a residual worth acting on, and the report is the whole panel as text", () => {
  const { panel, calls, button } = mount();
  const on = {
    ...view().mic,
    state: "on" as const,
    label: "Built-in",
    devices: [
      { id: "a", label: "Built-in" },
      { id: "b", label: "AirPods" },
    ],
    device: "a",
  };
  panel.update(view({ mic: { ...on, report: micReport() } }));
  assert.equal(button("APPLY").hidden, false);
  assert.equal(
    button("STOP THE MICROPHONE").textContent,
    "STOP THE MICROPHONE",
  );
  assert.deepEqual(
    [...panel.element.querySelectorAll("option")].map(
      (each) => each.textContent,
    ),
    ["Built-in", "AirPods"],
  );
  button("APPLY").click();
  button("STOP THE MICROPHONE").click();
  assert.deepEqual(calls, ["applyMic", "mic false a"]);
  panel.update(
    view({
      mic: { ...on, report: micReport({ residualMs: three(1, 1, 29) }) },
    }),
  );
  assert.equal(button("APPLY").hidden, true);
  panel.update(
    view({
      mic: { ...on, report: micReport({ residualMs: three(27, 30, 29) }) },
    }),
  );
  assert.equal(button("APPLY").hidden, true, "too scattered");

  const text = timingReport(
    view({ ear: [-18, -17, -19], log: { lines: 12, file: "" } }),
  );
  assert.match(text, /^Fusemania timing · STEADY CLICK 2.5 \/ s\n/);
  assert.match(text, /offsets: audio 0 ms, input 0 ms, visual 0 ms/);
  assert.match(text, /by ear: −18\.0 ms/);
  assert.match(text, /press > handler/);
  assert.match(text, /getOutputTimestamp/);
});

test("the panel says where the session's log is: a file, a download, or a server that would not take it", () => {
  const { panel } = mount();
  const line = () =>
    [...panel.element.querySelectorAll("p")]
      .map((each) => each.textContent ?? "")
      .find((text) => text.startsWith("Session log")) ?? "";
  panel.update(view({ log: { lines: 12, file: "" } }));
  assert.equal(line(), "Session log: 12 lines (SAVE LOG downloads it)");
  panel.update(
    view({ log: { lines: 40, file: "timing-logs/fusemania-x.jsonl" } }),
  );
  assert.equal(
    line(),
    "Session log: 40 lines, written to timing-logs/fusemania-x.jsonl",
  );
  panel.update(view({ log: { lines: 40, file: "", refused: true } }));
  assert.match(line(), /took none of it.*--allow-origin.*SAVE LOG/);
});

test("hidden, the panel is a chip and does no work", () => {
  const { panel, button } = mount();
  panel.update(view());
  button("HIDE").click();
  assert.equal(panel.element.classList.contains("fm-dt-closed"), true);
  const before = panel.element.textContent;
  panel.update(view({ offsets: { audioMs: 99, inputMs: 0, visualMs: 0 } }));
  assert.equal(panel.element.textContent, before);
  button("TIMING").click();
  panel.update(view({ offsets: { audioMs: 99, inputMs: 0, visualMs: 0 } }));
  assert.match(panel.element.textContent ?? "", /\+99 ms/);
});

test("on its own screen the panel has the click and the microphone, and keeps the details folded away", () => {
  const { panel, calls, button } = mount();
  panel.update(view());
  const details = panel.element.querySelector("details")!;
  assert.equal(details.open, false);
  assert.match(details.textContent ?? "", /PRESS TO JUDGMENT/);
  assert.match(details.textContent ?? "", /CLOCKS/);
  assert.match(details.textContent ?? "", /Session log/);
  assert.equal(panel.element.classList.contains("fm-dt-screen"), true);
  assert.equal(panel.element.querySelector("header b")!.textContent, "TIMING");
  assert.equal(button("HIDE").hidden, true, "nothing to hide it from");
  assert.equal(button("OPEN THE TIMING SCREEN").hidden, true);
  assert.equal(
    button("LISTEN WITH THE MICROPHONE").closest("section")!.hidden,
    false,
  );
  // The rate being played is the lit one, and the others change it.
  assert.deepEqual(
    [...panel.element.querySelectorAll(".fm-dt-click")].map((each) => [
      each.textContent,
      each.classList.contains("fm-dt-on"),
    ]),
    [
      ["2 / s", false],
      ["2.5 / s", true],
      ["3 / s", false],
    ],
  );
  button("3 / s").click();
  assert.deepEqual(calls, ["click 180"]);
  assert.match(
    panel.element.textContent ?? "",
    /2\.5 ticks a second, an arrow on every tick/,
  );
  const open = mount({ details: true });
  open.panel.update(view());
  assert.equal(open.panel.element.querySelector("details")!.open, true);
});

test("over a game the panel is a debug overlay: details open, no click to play, a way to the Timing screen", () => {
  const { panel, calls, button } = mount();
  panel.update(
    view({ mode: "game", clickBpm: undefined, song: "ARCADE ADVENTURE" }),
  );
  assert.equal(panel.element.querySelector("details")!.open, true);
  assert.equal(panel.element.classList.contains("fm-dt-screen"), false);
  assert.equal(
    panel.element.querySelector("header b")!.textContent,
    "TIMING DEBUG",
  );
  assert.equal(button("HIDE").hidden, false);
  assert.equal(button("2.5 / s").hidden, true);
  assert.equal(
    button("LISTEN WITH THE MICROPHONE").closest("section")!.hidden,
    true,
  );
  assert.match(
    panel.element.textContent ?? "",
    /Playing: ARCADE ADVENTURE\. The steady click and the microphone check are on the Timing screen\./,
  );
  button("OPEN THE TIMING SCREEN").click();
  assert.deepEqual(calls, ["openScreen"]);
});
