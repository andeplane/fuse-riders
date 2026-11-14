import type { GameAudio } from "fuse-ui/game-audio";
import {
  BOO,
  MARVELOUS,
  STAR,
  isAttack,
  type PlayerView,
} from "../engine/index.js";
import { placeLag } from "./calibration.js";
import {
  CLICK_HZ,
  clickMs,
  clickRate,
  clickTicks,
  nearestClick,
} from "./click-track.js";
import {
  createTimingPanel,
  type OffsetKey,
  type ScopeTrace,
  type TimingView,
} from "./debug-timing.js";
import type { FrameLead } from "./frame-lead.js";
import type { LatencyContext, LatencyProbe } from "./latency.js";
import {
  createMicAnalyser,
  createMicSession,
  micUsable,
  type MicAnalyser,
  type MicSession,
} from "./mic.js";
import {
  listMics,
  openMic,
  wirelessMic,
  type MicCapture,
  type MicDevice,
} from "./mic-capture.js";
import {
  MAX_AUDIO_MS,
  MAX_OFFSET_MS,
  MAX_VISUAL_MS,
  type Prefs,
} from "./prefs.js";
import type { SongClock } from "./song-clock.js";
import {
  TIMING_LOG_PATH,
  createErrorBucket,
  createLogWriter,
  createPressLog,
  createTimingLog,
  isLocalHost,
  meanOf,
  type PressRecord,
} from "./timing-session.js";

/**
 * The timing lab behind `?debugtiming`: the page's glue between what the game measures (the latency probe, the
 * song clock, every press), a microphone, the panel that shows it and the log an agent can read afterwards. It is
 * loaded only on a debug page, so a player's game carries none of it.
 */
export interface TimingLabDeps {
  doc: Document;
  win: Window;
  audio: GameAudio;
  songClock: SongClock;
  probe: LatencyProbe;
  frameLead: FrameLead;
  prefs(): Prefs;
  setPrefs(next: Prefs): void;
  latencyContext(): LatencyContext;
  /** Starts a solo run on the click track at `bpm`. */
  startClick(bpm: number): void;
  now(): number;
}
export interface FrameState {
  /** This device's own player in the picture, when it has one. */
  mine: PlayerView | undefined;
  /** A song is running, and its position comes from the audio clock. */
  running: boolean;
  audible: boolean;
  /** The match, so a new one starts the counting over. */
  epoch: number;
  song: string;
  title: string;
}
export interface TimingLab {
  element: HTMLElement;
  /** A press was handled: its stamp, when the listener ran, the song time it was judged at, and its tick slack. */
  press(press: Omit<PressRecord, "id" | "frameMs" | "drawnMs">): void;
  /** A frame was drawn: `now` is its start and `done` the end of its drawing, on the page's clock. */
  frame(now: number, done: number, state: FrameState): void;
  /** Everything the session knows, for the console and for a script driving the page. */
  snapshot(): TimingView;
  logText(): string;
  /** The room is gone: the microphone is let go, what is left of the log is written, the panel leaves the page. */
  dispose(): void;
}

const clamp = (value: number, max: number) =>
  Math.max(-max, Math.min(max, Math.round(value)));
const judgedTotal = (player: PlayerView) => {
  let sum = 0;
  for (let judgment = MARVELOUS; judgment <= BOO; judgment++)
    sum += player.counts[judgment] ?? 0;
  return sum;
};

export function createTimingLab(deps: TimingLabDeps): TimingLab {
  const { doc, win, audio, songClock, probe } = deps;
  const session = `${new Date().toISOString().replace(/[:.]/g, "-").toLowerCase()}`;
  const log = createTimingLog(session, deps.now);
  const local = isLocalHost(win.location.hostname);
  const file = `timing-logs/fusemania-${session}.jsonl`;
  const writer = createLogWriter(log, async (lines) => {
    if (!local) return false;
    const response = await win.fetch(
      `${TIMING_LOG_PATH}?game=fusemania&session=${session}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-ndjson" },
        body: `${lines.join("\n")}\n`,
      },
    );
    return response.ok;
  });
  const presses = createPressLog(),
    ear = createErrorBucket(),
    eye = createErrorBucket();
  let state: FrameState | undefined,
    run = "",
    seen = -1,
    restarts = 0,
    starts = songClock.starts,
    /** The match whose song has started: a second start in the same match is a realignment. */
    started = -1;

  // ---- the microphone ----
  let capture: MicCapture | undefined,
    analyser: MicAnalyser | undefined,
    micSession: MicSession | undefined,
    micState: "off" | "asking" | "on" | "failed" = "off",
    micNote = "",
    micDevices: MicDevice[] = [],
    micDevice = "",
    micLevel = 0,
    micBpm: number | undefined,
    named = -1,
    /** Counts starts and stops, so a microphone that arrives after it was turned off (or asked for again) is closed. */
    micTurn = 0;
  const stopMic = () => {
    micTurn++;
    capture?.stop();
    capture = undefined;
    analyser = undefined;
    micSession = undefined;
    micState = "off";
    micBpm = undefined;
    named = -1;
  };
  const startMic = async (device?: string) => {
    stopMic();
    const turn = micTurn;
    const context = audio.context?.(),
      media = win.navigator.mediaDevices;
    if (!(context instanceof AudioContext) || !media?.getUserMedia) {
      micState = "failed";
      micNote = audio.forcedMute
        ? "This page is muted (?mute): the microphone listens on the audio clock, which is off."
        : "This browser gives a page no microphone.";
      return;
    }
    micState = "asking";
    micNote = "";
    try {
      audio.unlock();
      const heard = createMicAnalyser({
        sampleRate: context.sampleRate,
        clickHz: CLICK_HZ,
      });
      let opened = await openMic(
        context,
        media,
        (samples, first) => heard.push(samples, first),
        device,
      );
      if (turn !== micTurn) return opened.stop();
      micDevices = await listMics(media);
      if (turn !== micTurn) return opened.stop();
      // A wireless headset's microphone is late and cannot hear the keyboard: take the computer's own when it was
      // only the default and another is there.
      const better = micDevices.find((each) => !wirelessMic(each.label));
      if (!device && wirelessMic(opened.label) && better) {
        opened.stop();
        opened = await openMic(
          context,
          media,
          (samples, first) => heard.push(samples, first),
          better.id,
        );
        if (turn !== micTurn) return opened.stop();
      }
      capture = opened;
      analyser = heard;
      micDevice =
        micDevices.find((each) => each.label === opened.label)?.id ??
        device ??
        "";
      micState = "on";
      micNote = [
        wirelessMic(opened.label)
          ? "This is a wireless headset's microphone: it is late and cannot hear the keyboard. Pick the computer's own."
          : "",
        opened.processing.length
          ? `The browser left ${opened.processing.join(", ")} on: timings may be bent.`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      // Not the microphone's name: a headset is often named after its owner.
      log.add("mic", {
        on: true,
        wireless: wirelessMic(opened.label),
        reportedMs: opened.reportedMs,
        processing: opened.processing,
        sampleRate: opened.sampleRate,
      });
    } catch (error) {
      if (turn !== micTurn) return;
      micState = "failed";
      micNote =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "The microphone was not allowed. Allow it for this site and try again."
          : `The microphone could not be opened (${error instanceof Error ? error.name : "error"}).`;
      log.add("mic", { on: false, error: micNote });
    }
  };
  /** Tells the microphone which ticks are coming, a few seconds ahead, on the schedule the song was started with. */
  const nameClicks = (bpm: number) => {
    if (!analyser) return;
    if (micBpm !== bpm || !micSession) {
      micBpm = bpm;
      micSession = createMicSession(analyser, 60 / bpm, {
        click: (index, tripMs) => log.add("tick", { index, tripMs }),
        heard: (press) => log.add("heard", { ...press }),
      });
      named = -1;
    }
    const heardMs = songClock.songMs(),
      ticks = clickTicks(bpm);
    const from = Math.max(named + 1, nearestClick(bpm, heardMs - 500).index);
    for (let index = from; index < ticks; index++) {
      const ms = clickMs(bpm, index);
      if (ms > heardMs + 3000) break;
      const at = songClock.scheduledAt(ms);
      if (at === undefined) break;
      micSession.expectClick({ index, at });
      named = index;
    }
  };

  // ---- offsets ----
  const offsets = () => {
    const prefs = deps.prefs();
    return {
      audioMs: prefs.audioMs,
      inputMs: prefs.offsetMs,
      visualMs: prefs.visualMs,
    };
  };
  const setOffsets = (next: Partial<ReturnType<typeof offsets>>) => {
    const before = offsets(),
      prefs = deps.prefs(),
      after = {
        audioMs: clamp(next.audioMs ?? before.audioMs, MAX_AUDIO_MS),
        inputMs: clamp(next.inputMs ?? before.inputMs, MAX_OFFSET_MS),
        visualMs: clamp(next.visualMs ?? before.visualMs, MAX_VISUAL_MS),
      };
    if (
      after.audioMs === before.audioMs &&
      after.inputMs === before.inputMs &&
      after.visualMs === before.visualMs
    )
      return;
    deps.setPrefs({
      ...prefs,
      audioMs: after.audioMs,
      offsetMs: after.inputMs,
      visualMs: after.visualMs,
    });
    // What was measured under the old offsets says nothing about the new ones.
    eye.reset();
    if (after.audioMs !== before.audioMs || after.inputMs !== before.inputMs) {
      ear.reset();
      micSession?.reset();
      named = -1;
    }
    log.add("offsets", after);
  };
  const place = (totalMs: number) => {
    const placed = placeLag(totalMs, deps.prefs().audioMs, {
      input: MAX_OFFSET_MS,
      audio: MAX_AUDIO_MS,
    });
    setOffsets({ inputMs: placed.offsetMs, audioMs: placed.audioMs });
  };

  const view = (): TimingView => {
    const mapping = songClock.mapping(),
      context = audio.context?.();
    return {
      report: probe.report(),
      context: deps.latencyContext(),
      clock: {
        source: !songClock.audible ? "room" : (mapping?.source ?? "room"),
        lagMs: mapping?.lagMs ?? 0,
        pairedMs: mapping?.pairedMs,
        sampleRate: context?.sampleRate,
        restarts,
        hz: deps.frameLead.hz,
        leadMs: deps.frameLead.ms,
      },
      offsets: offsets(),
      ear: ear.values(),
      eye: eye.values(),
      presses: presses.recent(40),
      totalPresses: presses.total,
      bent: presses.bent,
      leastSlackMs: presses.leastSlackMs,
      song: state?.title ?? "no song",
      clickBpm: state ? clickRate(state.song) : undefined,
      mic: {
        state: micState,
        note: micNote,
        label: capture?.label ?? "",
        reportedMs: capture?.reportedMs,
        level: micLevel,
        report: micSession?.report(),
        devices: micDevices,
        device: micDevice,
      },
      log: {
        lines: log.size,
        file: writer.state === "writing" ? file : "",
        refused: local && writer.state === "off",
      },
    };
  };

  const panel = createTimingPanel(doc, {
    nudge(key: OffsetKey, by: number) {
      setOffsets({ [key]: offsets()[key] + by });
    },
    set(key: OffsetKey, ms: number) {
      setOffsets({ [key]: ms });
    },
    centre() {
      if (ear.values().length > 0)
        place(deps.prefs().offsetMs + meanOf(ear.values()).mean);
    },
    resetHits() {
      ear.reset();
      eye.reset();
      presses.reset();
      probe.reset();
      micSession?.reset();
      named = -1;
    },
    click: (bpm) => deps.startClick(bpm),
    mic(on, device) {
      if (on) void startMic(device);
      else {
        stopMic();
        log.add("mic", { on: false });
      }
    },
    applyMic() {
      const report = micSession?.report();
      if (report && micUsable(report))
        place(deps.prefs().offsetMs + report.residualMs.median);
    },
    copy(text) {
      void win.navigator.clipboard?.writeText(text).catch(() => undefined);
    },
    download() {
      const url = URL.createObjectURL(
          new Blob([log.text()], { type: "application/x-ndjson" }),
        ),
        link = doc.createElement("a");
      link.href = url;
      link.download = `fusemania-timing-${session}.jsonl`;
      link.click();
      win.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });

  const detail = audio.clock()?.latencies?.();
  log.add("session", {
    id: session,
    agent: win.navigator.userAgent,
    solo: new URLSearchParams(win.location.search).get("solo") === "1",
    flags: [...new URLSearchParams(win.location.search).keys()].filter(
      (key) => key !== "room",
    ),
    pixelRatio: win.devicePixelRatio,
    offsets: offsets(),
    baseMs: detail?.base === undefined ? undefined : detail.base * 1000,
    outputMs: detail?.output === undefined ? undefined : detail.output * 1000,
  });

  let shown = 0,
    logged = 0,
    probed = 0,
    scoped = 0,
    pressLogged = 0;
  return {
    element: panel.element,
    press(press) {
      const record = presses.add(press);
      const bpm = state ? clickRate(state.song) : undefined;
      if (bpm && micSession && record.used && record.column >= 0) {
        const at = songClock.clockTime(record.stamp),
          near = nearestClick(bpm, record.songMs);
        if (at !== undefined)
          micSession.press({ at, click: near.index, gameMs: near.offMs });
      }
    },
    frame(now, done, next) {
      state = next;
      presses.frame(now, done);
      if (songClock.starts !== starts) {
        if (started === next.epoch) restarts++;
        started = next.epoch;
        starts = songClock.starts;
        micSession?.reset();
        named = -1;
        log.add("start", { starts, restarts, song: next.song });
      }
      const mine = next.mine;
      if (mine && !mine.bot && next.running) {
        const total = judgedTotal(mine),
          key = `${next.epoch}`;
        if (key !== run) {
          run = key;
          seen = total;
        } else if (total > seen) {
          seen = total;
          if (mine.judged >= MARVELOUS && mine.judged <= BOO) {
            const at = mine.judgedAt;
            const press = presses.judged(at, mine.judged, mine.judgedOff);
            const bent = mine.effects.some(
              (effect) =>
                (effect[0] === STAR || isAttack(effect[0])) &&
                effect[1] <= at + 250 &&
                at - 250 < effect[2],
            );
            if (!bent && next.audible)
              (audio.prefs.muted ? eye : ear).add(mine.judgedOff);
            log.add("judged", {
              press: press?.id,
              at,
              judgment: mine.judged,
              offMs: mine.judgedOff,
              by: !next.audible ? "room" : audio.prefs.muted ? "eye" : "ear",
            });
          }
        } else seen = total;
      }
      // Presses are written once the frame that shows them has been drawn.
      for (const press of presses.recent(40)) {
        if (
          press.id <= pressLogged ||
          (press.used && press.frameMs === undefined)
        )
          continue;
        pressLogged = press.id;
        log.add("press", {
          id: press.id,
          source: press.source,
          column: press.column,
          stamp: press.stamp,
          handlerMs: press.used ? press.handled - press.stamp : undefined,
          frameMs: press.frameMs,
          drawnMs: press.drawnMs,
          songMs: press.songMs,
          slackMs: press.slackMs,
        });
      }
      const bpm = clickRate(next.song);
      if (analyser && capture) {
        micLevel = Math.max(analyser.level(), micLevel * 0.9);
        if (bpm && next.running && next.audible) {
          nameClicks(bpm);
          micSession?.settle();
        }
      }
      if (done - logged > 1000) {
        logged = done;
        const mapping = songClock.mapping(),
          latencies = audio.clock()?.latencies?.();
        log.add("clock", {
          source: mapping?.source,
          lagMs: mapping?.lagMs,
          pairedMs: mapping?.pairedMs,
          stepMs:
            mapping === undefined
              ? undefined
              : (mapping.reading - mapping.smoothed) * 1000,
          driftMs: songClock.drift,
          audible: songClock.audible,
          muted: audio.prefs.muted,
          outputMs:
            latencies?.output === undefined
              ? undefined
              : latencies.output * 1000,
          hz: deps.frameLead.hz,
          songMs: next.running ? songClock.songMs(now) : undefined,
        });
        void writer.flush();
      }
      if (done - probed > 5000) {
        probed = done;
        const snapshot = view();
        log.add("summary", {
          song: next.song,
          report: snapshot.report,
          ear: meanOf(snapshot.ear),
          eye: meanOf(snapshot.eye),
          presses: presses.total,
          bent: presses.bent,
          leastSlackMs: presses.leastSlackMs,
          restarts,
          mic: snapshot.mic.report
            ? { ...snapshot.mic.report, recent: undefined }
            : undefined,
        });
      }
      if (done - shown > 250) {
        shown = done;
        panel.update(view());
      }
      if (analyser && micSession && done - scoped > 100) {
        scoped = done;
        const traces: ScopeTrace[] = [];
        for (const heard of micSession.report().recent.slice(-8)) {
          const tick = heard.keyAt - heard.trueMs / 1000,
            from = tick - 0.12,
            to = tick + 0.12;
          if (from < analyser.from) continue;
          traces.push({
            fromMs:
              (Math.ceil(from / analyser.binS) * analyser.binS - tick) * 1000,
            binMs: analyser.binS * 1000,
            click: analyser.envelope("click", from, to),
            key: analyser.envelope("key", from, to),
            trueMs: heard.trueMs,
            gameMs: heard.gameMs,
          });
        }
        panel.scope(traces);
      }
    },
    snapshot: view,
    logText: () => log.text(),
    dispose() {
      stopMic();
      void writer.flush();
      panel.element.remove();
    },
  };
}
