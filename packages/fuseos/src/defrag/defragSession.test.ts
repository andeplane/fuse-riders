import type { ManualTimers } from "../display/effects/effectsDeps";
import { createManualTimers } from "../display/effects/effectsDeps";
import { scriptedRandom } from "../__mocks__/seededRandom";

import type { DefragFile } from "./defragDisk";
import { CELL_STATES } from "./defragDisk";
import type { DefragSession, DefragSessionDeps } from "./defragSession";
import {
  ANOTHER_PROGRAM_WROTE,
  BLAMES,
  CHECK_TICKS,
  CLUSTERS,
  CONTENTS_CHANGED,
  createDefragSession,
  DEFAULT_OPTIONS,
  FALLBACK_FILES,
  FLOPPY_FILES,
  FLOPPY_GRIND_TICKS,
  isProgramFile,
  MAX_WINAMP_RESTARTS,
  REDUCED_TICK_MS,
  RESTART_NOTICE_MS,
  TICK_MS,
} from "./defragSession";

const FILES: readonly DefragFile[] = [
  { path: "games/fuseball/index.html", size: 30_000 },
  { path: "packages/fuseos/src/App.tsx", size: 60_000 },
  { path: "public/music/theme.mp3", size: 200_000 },
];

type Harness = {
  session: DefragSession;
  timers: ManualTimers;
  env: { reduced: boolean; track: string | undefined; grinds: number };
  notified: () => number;
};

function setup(
  options: {
    random?: readonly number[];
    drive?: "C" | "A";
    floppy?: boolean;
  } = {},
): Harness {
  const timers = createManualTimers();
  const env: Harness["env"] = { reduced: false, track: undefined, grinds: 0 };
  const deps: DefragSessionDeps = {
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    // 0.99 puts "contents have changed" at 59%.
    random: scriptedRandom(options.random ?? [0.99, 0]),
    reducedMotion: () => env.reduced,
    winampTrack: () => env.track,
    ...(options.floppy === false
      ? {}
      : {
          floppySound: () => {
            env.grinds += 1;
          },
        }),
  };
  const session = createDefragSession(
    deps,
    options.drive ? { drive: options.drive } : {},
  );
  let notifications = 0;
  session.subscribe(() => {
    notifications += 1;
  });
  return { session, timers, env, notified: () => notifications };
}

const snap = (harness: Harness) => harness.session.getSnapshot();

/** Runs beats until `until` holds; fails rather than spinning if it never does. */
function runUntil(harness: Harness, until: () => boolean, tick = TICK_MS) {
  for (let beat = 0; beat < 60_000; beat += 1) {
    if (until()) return;
    harness.timers.advance(tick);
  }
  throw new Error("the condition never held");
}

function startOnC(harness: Harness) {
  harness.session.setHardDrive(FILES, 7);
  harness.session.start();
}

describe("the Select Drive and Settings dialogs", () => {
  it("opens on Select Drive with C chosen and both options on, doing nothing yet", () => {
    const harness = setup();
    expect(snap(harness)).toMatchObject({
      stage: "select",
      choice: "C",
      drive: "C",
      options: DEFAULT_OPTIONS,
      details: false,
      legend: false,
      paused: false,
      percent: 0,
      dialog: undefined,
      exited: false,
    });
    expect(harness.timers.pending()).toBe(0);
  });

  it("keeps the options OK saves and drops the ones Cancel leaves", () => {
    const harness = setup();
    harness.session.openSettings();
    expect(snap(harness).stage).toBe("settings");
    const chosen = { rearrange: false, checkErrors: false, everyTime: false };
    harness.session.saveSettings(chosen);
    expect(snap(harness)).toMatchObject({ stage: "select", options: chosen });
    harness.session.openSettings();
    harness.session.cancelSettings();
    expect(snap(harness)).toMatchObject({ stage: "select", options: chosen });
  });

  it("quits on Exit", () => {
    const harness = setup();
    harness.session.exit();
    expect(snap(harness).exited).toBe(true);
  });

  it("defragments C for All Hard Drives, there being one", () => {
    const harness = setup();
    harness.session.setHardDrive(FILES, 7);
    harness.session.choose("all");
    expect(snap(harness).choice).toBe("all");
    harness.session.start();
    expect(snap(harness)).toMatchObject({ stage: "running", drive: "C" });
  });

  it("ignores the run's buttons while no run is on", () => {
    const harness = setup();
    harness.session.togglePause();
    harness.session.requestStop();
    harness.session.answerStop(true);
    harness.session.answerComplete(true);
    harness.session.dismissRestart();
    expect(snap(harness)).toMatchObject({
      stage: "select",
      paused: false,
      dialog: undefined,
      exited: false,
    });
  });
});

describe("a run", () => {
  it("waits for the drive's file list, then checks for errors and names the files it moves", () => {
    const harness = setup();
    harness.session.start();
    expect(snap(harness)).toMatchObject({
      stage: "running",
      status: "Reading drive information...",
    });
    expect(snap(harness).cells).toHaveLength(0);
    expect(harness.timers.pending()).toBe(0);

    harness.session.setHardDrive(FILES, 7);
    expect(snap(harness).cells).toHaveLength(CLUSTERS);
    harness.timers.advance(TICK_MS);
    expect(snap(harness).status).toBe("Checking drive for errors...");
    harness.timers.advance(TICK_MS * CHECK_TICKS);
    expect(snap(harness).status).toBe(
      "Rearranging program file: games/fuseball/index.html",
    );
    runUntil(harness, () => snap(harness).status.includes("App.tsx"));
    expect(snap(harness).status).toBe(
      "Defragmenting file: packages/fuseos/src/App.tsx",
    );
  });

  it("skips the error check and the rearranging when those options are off", () => {
    const harness = setup();
    harness.session.saveSettings({
      rearrange: false,
      checkErrors: false,
      everyTime: true,
    });
    startOnC(harness);
    harness.timers.advance(TICK_MS);
    expect(snap(harness).status).toBe(
      "Defragmenting file: games/fuseball/index.html",
    );
  });

  it("shows the head reading and writing, and the percent climbing", () => {
    const harness = setup();
    startOnC(harness);
    const seen = new Set<string>();
    runUntil(harness, () => {
      snap(harness).cells.forEach((code) => {
        seen.add(CELL_STATES[code] ?? "");
      });
      return snap(harness).percent >= 10;
    });
    expect(seen).toContain("reading");
    expect(seen).toContain("writing");
    expect(seen).toContain("optimized");
  });

  it("holds still while paused and carries on when resumed", () => {
    const harness = setup();
    startOnC(harness);
    runUntil(harness, () => snap(harness).percent >= 5);
    harness.session.togglePause();
    expect(snap(harness).paused).toBe(true);
    expect(harness.timers.pending()).toBe(0);
    const at = snap(harness).percent;
    harness.timers.advance(TICK_MS * 200);
    expect(snap(harness).percent).toBe(at);
    harness.session.togglePause();
    expect(snap(harness).paused).toBe(false);
    runUntil(harness, () => snap(harness).percent > at);
  });

  it("asks before stopping: No carries on, Yes quits", () => {
    const harness = setup();
    startOnC(harness);
    runUntil(harness, () => snap(harness).percent >= 5);
    harness.session.requestStop();
    expect(snap(harness).dialog).toEqual({ kind: "confirmStop" });
    expect(harness.timers.pending()).toBe(0);
    // A second press while the question is up changes nothing.
    harness.session.requestStop();
    harness.session.answerStop(false);
    expect(snap(harness).dialog).toBeUndefined();
    expect(harness.timers.pending()).toBe(1);
    harness.session.requestStop();
    harness.session.answerStop(true);
    expect(snap(harness).exited).toBe(true);
    expect(harness.timers.pending()).toBe(0);
  });

  it("toggles the details and only shows the legend with them", () => {
    const harness = setup();
    startOnC(harness);
    harness.session.setLegend(true);
    expect(snap(harness).legend).toBe(false);
    harness.session.toggleDetails();
    harness.session.setLegend(true);
    expect(snap(harness)).toMatchObject({ details: true, legend: true });
    harness.session.setLegend(false);
    expect(snap(harness).legend).toBe(false);
    harness.session.setLegend(true);
    harness.session.toggleDetails();
    expect(snap(harness)).toMatchObject({ details: false, legend: false });
  });

  it("finishes at 100% and asks whether to quit: No goes back to Select Drive", () => {
    const harness = setup();
    startOnC(harness);
    runUntil(harness, () => {
      harness.session.dismissRestart();
      return snap(harness).dialog?.kind === "complete";
    });
    expect(snap(harness)).toMatchObject({
      percent: 100,
      status: "Defragmentation complete.",
    });
    expect(
      [...snap(harness).cells].filter(
        (code) => CELL_STATES[code] === "optimized",
      ).length,
    ).toBe(Math.round(CLUSTERS * 0.62));
    expect(harness.timers.pending()).toBe(0);
    harness.session.answerComplete(false);
    expect(snap(harness)).toMatchObject({
      stage: "select",
      percent: 0,
      dialog: undefined,
      exited: false,
    });
    expect(snap(harness).cells).toHaveLength(0);
  });

  it("quits on Yes when it is done", () => {
    const harness = setup({ random: [0.99, 0] });
    startOnC(harness);
    runUntil(harness, () => {
      harness.session.dismissRestart();
      return snap(harness).dialog?.kind === "complete";
    });
    harness.session.answerComplete(true);
    expect(snap(harness).exited).toBe(true);
  });
});

describe("the classic interruptions", () => {
  it("finds the drive's contents changed once, blames someone, and restarts from 0%", () => {
    // 0 puts the change at 20%; the second 0 picks the first blame.
    const harness = setup({ random: [0, 0] });
    startOnC(harness);
    runUntil(harness, () => snap(harness).dialog !== undefined);
    expect(snap(harness)).toMatchObject({
      percent: 0,
      status: "Drive C's contents have changed: restarting...",
      dialog: {
        kind: "restart",
        message: CONTENTS_CHANGED("C"),
        detail: BLAMES[0],
      },
    });
    expect(CONTENTS_CHANGED("C")).toBe(
      "Drive C's contents have changed. Defragmenter will restart.",
    );
    // Nothing moves while the notice is up; it goes away by itself.
    expect(harness.timers.pending()).toBe(1);
    harness.timers.advance(RESTART_NOTICE_MS);
    expect(snap(harness).dialog).toBeUndefined();
    // The pass races back through what was already in order, then names files again.
    runUntil(harness, () => snap(harness).percent >= 20);
    expect(snap(harness).status).toMatch(/^(Defragmenting|Rearranging)/);
    // Once per sitting: the rest of the run, and the next run, are left alone.
    runUntil(harness, () => snap(harness).dialog !== undefined);
    expect(snap(harness).dialog).toEqual({ kind: "complete" });
    harness.session.answerComplete(false);
    harness.session.start();
    runUntil(harness, () => snap(harness).dialog !== undefined);
    expect(snap(harness).dialog).toEqual({ kind: "complete" });
  });

  it("lets OK dismiss the restart notice early", () => {
    const harness = setup({ random: [0, 0.9] });
    startOnC(harness);
    runUntil(harness, () => snap(harness).dialog !== undefined);
    expect(snap(harness).dialog).toMatchObject({ detail: BLAMES[1] });
    harness.session.dismissRestart();
    expect(snap(harness).dialog).toBeUndefined();
    expect(harness.timers.pending()).toBe(1);
    // The notice's own timer is gone: nothing fires later.
    harness.timers.advance(TICK_MS);
    harness.timers.advance(RESTART_NOTICE_MS);
    expect(snap(harness).dialog).toBeUndefined();
  });

  it("restarts because another program wrote to the disk while Winamp plays, but not forever", () => {
    const harness = setup({ random: [0.99, 0] });
    harness.env.track = "Fuseball Theme (Fuseball)";
    startOnC(harness);
    const notices: string[] = [];
    runUntil(harness, () => {
      const dialog = snap(harness).dialog;
      if (dialog?.kind === "restart") {
        notices.push(`${dialog.message} ${dialog.detail}`);
        harness.session.dismissRestart();
      }
      return dialog?.kind === "complete";
    });
    const winamp = notices.filter((notice) =>
      notice.startsWith(ANOTHER_PROGRAM_WROTE),
    );
    expect(winamp).toHaveLength(MAX_WINAMP_RESTARTS);
    expect(winamp[0]).toBe(
      `${ANOTHER_PROGRAM_WROTE} Winamp is playing Fuseball Theme (Fuseball).`,
    );
    expect(ANOTHER_PROGRAM_WROTE).toBe(
      "Windows is restarting Disk Defragmenter because another program wrote to the disk.",
    );
    // The contents-changed joke still had its one turn.
    expect(notices.length).toBe(MAX_WINAMP_RESTARTS + 1);
  });

  it("leaves a silent Winamp out of it", () => {
    const harness = setup({ random: [0.99, 0] });
    startOnC(harness);
    const notices: string[] = [];
    runUntil(harness, () => {
      const dialog = snap(harness).dialog;
      if (dialog?.kind === "restart") {
        notices.push(dialog.message);
        harness.session.dismissRestart();
      }
      return dialog?.kind === "complete";
    });
    expect(notices).toEqual([CONTENTS_CHANGED("C")]);
  });
});

describe("reduced motion", () => {
  it("moves in fewer, larger steps and never flashes the head", () => {
    const harness = setup();
    harness.env.reduced = true;
    startOnC(harness);
    // Nothing is due at the ordinary beat.
    harness.timers.advance(TICK_MS);
    expect(snap(harness).status).toBe("Reading drive information...");
    harness.timers.advance(REDUCED_TICK_MS);
    expect(snap(harness).status).toBe("Checking drive for errors...");
    const seen = new Set<string>();
    runUntil(
      harness,
      () => {
        snap(harness).cells.forEach((code) => {
          seen.add(CELL_STATES[code] ?? "");
        });
        harness.session.dismissRestart();
        return snap(harness).dialog?.kind === "complete";
      },
      REDUCED_TICK_MS,
    );
    expect(seen).not.toContain("reading");
    expect(seen).not.toContain("writing");
    expect(snap(harness).percent).toBe(100);
  });
});

describe("the floppy", () => {
  it("grinds when the run starts and every so often after, on A: only", () => {
    const harness = setup({ drive: "A" });
    expect(snap(harness)).toMatchObject({
      stage: "running",
      drive: "A",
      choice: "A",
    });
    expect(snap(harness).cells).toHaveLength(CLUSTERS);
    expect(harness.env.grinds).toBe(1);
    harness.timers.advance(TICK_MS * FLOPPY_GRIND_TICKS);
    expect(harness.env.grinds).toBe(2);
    runUntil(harness, () => snap(harness).status.startsWith("Defragmenting"));
    expect(snap(harness).status).toBe("Defragmenting file: slackbacup.zip");
    expect(FLOPPY_FILES.map((file) => file.path)).toEqual([
      "slackbacup.zip",
      "porn/homework.txt",
    ]);

    const hard = setup();
    startOnC(hard);
    hard.timers.advance(TICK_MS * FLOPPY_GRIND_TICKS * 2);
    expect(hard.env.grinds).toBe(0);
  });

  it("defragments in silence where nothing can make the noise", () => {
    const harness = setup({ drive: "A", floppy: false });
    harness.timers.advance(TICK_MS * FLOPPY_GRIND_TICKS);
    expect(snap(harness).stage).toBe("running");
  });
});

describe("the drive's files", () => {
  it("falls back to a familiar drive when the list is empty", () => {
    const harness = setup();
    harness.session.saveSettings({ ...DEFAULT_OPTIONS, checkErrors: false });
    harness.session.setHardDrive([], 3);
    harness.session.start();
    harness.timers.advance(TICK_MS);
    expect(FALLBACK_FILES.map((file) => file.path)).toContain(
      snap(harness).status.replace(/^.*: /, ""),
    );
  });

  it("does not disturb a run when the list arrives late or again", () => {
    const harness = setup({ drive: "A" });
    harness.session.setHardDrive(FILES, 7);
    expect(snap(harness).drive).toBe("A");
    const running = setup();
    startOnC(running);
    runUntil(running, () => snap(running).percent >= 5);
    const at = snap(running).percent;
    running.session.setHardDrive(FILES, 8);
    expect(snap(running).percent).toBe(at);
  });

  it("knows a program file when it sees one", () => {
    expect(isProgramFile("games/fuseball/index.html")).toBe(true);
    expect(isProgramFile("PROGRAM FILES/WINAMP/WINAMP.EXE")).toBe(true);
    expect(isProgramFile("packages/fuseos/src/App.tsx")).toBe(false);
  });
});

describe("subscriptions and disposal", () => {
  it("notifies on every change until unsubscribed", () => {
    const harness = setup();
    let calls = 0;
    const unsubscribe = harness.session.subscribe(() => {
      calls += 1;
    });
    harness.session.choose("A");
    expect(calls).toBe(1);
    expect(harness.notified()).toBe(1);
    unsubscribe();
    harness.session.choose("C");
    expect(calls).toBe(1);
  });

  it("stops its timers and goes quiet when disposed", () => {
    const harness = setup({ random: [0, 0] });
    startOnC(harness);
    runUntil(harness, () => snap(harness).dialog !== undefined);
    harness.session.dispose();
    expect(harness.timers.pending()).toBe(0);
    const before = harness.notified();
    harness.session.togglePause();
    harness.session.togglePause();
    expect(harness.timers.pending()).toBe(0);
    expect(harness.notified()).toBe(before);
  });
});
