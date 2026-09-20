import {
  mountArenaPresentation,
  LOADING_STALL_MS,
  STARTUP_DEADLINE_MS,
  type GraphicsReport,
  type PresentationDependencies,
} from "../games/fuse-riders/src/render/phaser/presentation.js";
import type {
  ArenaOptions,
  PhaserArena,
} from "../games/fuse-riders/src/render/phaser/arena.js";
import { visualFixture } from "./lib/benchmark-fixture.js";
import { defaultTheme } from "../games/fuse-riders/src/render/themes.js";

function check(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
// Typed loader, arena and scheduler fakes. These checks run in a browser for real DOM/button behavior,
// but advance deadlines and readiness explicitly, without patching globals or sleeping.
export async function checkPresentationLifecycle(): Promise<void> {
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const fixture = visualFixture(40);
  const same = (actual: GraphicsReport[], expected: GraphicsReport[]) =>
    JSON.stringify(actual) === JSON.stringify(expected);
  function harness() {
    let canvas = document.createElement("canvas");
    document.body.append(canvas);
    const reports: GraphicsReport[] = [];
    const loads: ReturnType<
      typeof deferred<
        Awaited<ReturnType<PresentationDependencies["loadArena"]>>
      >
    >[] = [];
    const timers = new Set<{ delay: number; callback: () => void }>();
    const arenas: {
      ready: ReturnType<typeof deferred<void>>;
      status: ArenaOptions["onStatus"];
      progress: ArenaOptions["onProgress"];
      draws: number;
      destroys: number;
      failPaint: boolean;
      rejectOnDestroy: boolean;
      scope?: string;
      selfId?: string;
    }[] = [];
    let throwOnCreate = false;
    const module: Awaited<ReturnType<PresentationDependencies["loadArena"]>> = {
      createPhaserArena: (_canvas, options) => {
        if (throwOnCreate) throw Error("Graphics initialization failed");
        const record = {
          ready: deferred<void>(),
          status: options?.onStatus,
          progress: options?.onProgress,
          draws: 0,
          destroys: 0,
          failPaint: false,
          rejectOnDestroy: true,
          scope: undefined as string | undefined,
          selfId: undefined as string | undefined,
        };
        arenas.push(record);
        const arena: PhaserArena = {
          ready: record.ready.promise,
          render: (_snapshot, _now, _theme, scope, selfId) => {
            if (record.failPaint) throw Error("Paint failed");
            record.draws++;
            record.scope = scope;
            record.selfId = selfId;
          },
          resize: () => {},
          reset: () => {},
          destroy: () => {
            record.destroys++;
            if (record.rejectOnDestroy) record.ready.reject(Error("Disposed"));
          },
          metrics: () => ({
            renderer: "canvas",
            objects: 0,
            particles: 0,
            renderMs: 0,
            automaticLoopRunning: false,
            trailHistoryBuilds: 0,
            defaultTextureGuard: true,
          }),
        };
        return arena;
      },
    };
    const presentation = mountArenaPresentation(
      canvas,
      (replacement) => {
        canvas = replacement;
      },
      (event) => reports.push(event),
      {
        loadArena: () => {
          const load = deferred<typeof module>();
          loads.push(load);
          return load.promise;
        },
        schedule: (delay, callback) => {
          const timer = { delay, callback };
          timers.add(timer);
          return () => {
            timers.delete(timer);
          };
        },
      },
    );
    return {
      presentation,
      reports,
      loads,
      arenas,
      timers,
      module,
      canvas: () => canvas,
      render: (scope = "current-match", selfId?: string) =>
        presentation.render(fixture, 1000, defaultTheme, scope, selfId),
      throwOnCreate: () => {
        throwOnCreate = true;
      },
      expire: (delay: number) => {
        const timer = [...timers].find((timer) => timer.delay === delay);
        check(timer, `No ${delay} deadline`);
        timers.delete(timer);
        timer.callback();
      },
      bar: () => {
        const node = document.querySelector<HTMLElement>(
          ".graphics-status:not([hidden]) .graphics-progress:not([hidden])",
        );
        if (!node) return undefined;
        const fill = node.querySelector<HTMLElement>(".graphics-progress-fill");
        return {
          value: node.getAttribute("aria-valuenow"),
          indeterminate: node.classList.contains("is-indeterminate"),
          width: fill?.style.width ?? "",
          text:
            document.querySelector<HTMLElement>(
              ".graphics-status:not([hidden]) span",
            )?.textContent ?? "",
        };
      },
      retry: () => {
        const button = document.querySelector<HTMLButtonElement>(
          ".graphics-status:not([hidden]) button",
        );
        check(button && !button.hidden, "Missing visible retry button");
        button.click();
      },
      destroy: () => {
        presentation.destroy();
        presentation.destroy();
        canvas.remove();
        check(timers.size === 0, "Disposal leaked deadlines");
        check(
          !document.querySelector(".graphics-status"),
          "Disposal leaked status",
        );
      },
    };
  }
  {
    const h = harness();
    check(h.loads.length === 0, "Hidden controller eagerly loads Phaser");
    h.render();
    h.destroy();
    h.loads[0]!.resolve(h.module);
    await flush();
    check(h.arenas.length === 0, "Import after disposal created an arena");
  }
  {
    const h = harness();
    h.render();
    h.expire(STARTUP_DEADLINE_MS);
    check(
      h.canvas().dataset.rendererStatus === "failed",
      "Module download had no deadline",
    );
    check(
      same(h.reports, [{ kind: "failed", stage: "startup" }]),
      "Download timeout was not reported as a startup failure",
    );
    h.retry();
    h.loads[1]!.resolve(h.module);
    await flush();
    const arena = h.arenas[0]!;
    arena.ready.resolve();
    await flush();
    const draws = arena.draws;
    h.loads[0]!.reject(Error("Late failed download"));
    await flush();
    check(
      h.canvas().dataset.renderer === "phaser-canvas" && arena.destroys === 0,
      "Stale import failure destroyed retry",
    );
    check(
      draws === 1,
      "Retry did not repaint stored snapshot without another frame",
    );
    check(
      same(h.reports, [
        { kind: "failed", stage: "startup" },
        { kind: "ready", renderer: "canvas" },
      ]),
      "Retry readiness was not reported once, after the stale failure",
    );
    h.destroy();
  }
  {
    const h = harness();
    h.render();
    h.expire(STARTUP_DEADLINE_MS);
    h.retry();
    h.loads[0]!.resolve(h.module);
    await flush();
    check(h.arenas.length === 0, "Timed-out download created a stale arena");
    h.destroy();
    h.loads[1]!.reject(Error("Disposed import"));
    await flush();
  }
  for (const failure of ["import", "create", "ready"] as const) {
    const h = harness();
    h.render();
    if (failure === "import") h.loads[0]!.reject(Error("Download failed"));
    else {
      if (failure === "create") h.throwOnCreate();
      h.loads[0]!.resolve(h.module);
      await flush();
      if (failure === "ready") h.arenas[0]!.ready.reject(Error("Boot failed"));
    }
    await flush();
    check(
      h.canvas().dataset.rendererStatus === "failed",
      `${failure} failure did not offer retry`,
    );
    check(h.timers.size === 0, `${failure} failure leaked timers`);
    check(
      same(h.reports, [{ kind: "failed", stage: "startup" }]),
      `${failure} failure was not reported once as startup`,
    );
    h.destroy();
  }
  {
    const h = harness();
    h.render();
    h.loads[0]!.resolve(h.module);
    await flush();
    const old = h.arenas[0]!;
    old.rejectOnDestroy = false;
    h.expire(STARTUP_DEADLINE_MS);
    check(old.destroys === 1, "Startup timeout did not dispose arena");
    h.retry();
    h.loads[1]!.resolve(h.module);
    await flush();
    old.status?.("restored");
    old.ready.resolve();
    await flush();
    check(
      h.canvas().dataset.rendererStatus === "starting",
      "Late old status changed retry",
    );
    check(
      h.canvas().dataset.renderer === undefined,
      "Stale readiness published a renderer",
    );
    check(
      [...h.timers].some((timer) => timer.delay === STARTUP_DEADLINE_MS),
      "Stale readiness cancelled retry startup deadline",
    );
    check(
      h.arenas[1]!.draws === 0,
      "Stale readiness painted the unready replacement",
    );
    check(
      !h.reports.some((report) => report.kind === "ready"),
      "Stale readiness was reported",
    );
    h.render("new-match", "local-rider");
    h.arenas[1]!.ready.resolve();
    await flush();
    check(
      h.arenas[1]!.scope === "new-match",
      "Retry used stale scope/snapshot",
    );
    check(
      h.arenas[1]!.selfId === "local-rider",
      "Retry lost the local rider identity",
    );
    h.destroy();
  }
  {
    const h = harness();
    h.render();
    h.loads[0]!.resolve(h.module);
    await flush();
    const arena = h.arenas[0]!;
    arena.ready.resolve();
    await flush();
    arena.status?.("context-lost");
    check(h.timers.size === 1, "Lost context has no deadline");
    arena.status?.("restored");
    check(Number(h.timers.size) === 0, "Restoration did not cancel deadline");
    check(arena.draws === 2, "Restoration did not repaint a paused view");
    arena.failPaint = true;
    h.render();
    check(
      h.canvas().dataset.rendererStatus === "failed",
      "Paint exception escaped failure UI",
    );
    h.render();
    check(arena.destroys === 1, "Failed frames repeatedly destroyed arena");
    check(
      same(h.reports, [
        { kind: "ready", renderer: "canvas" },
        { kind: "failed", stage: "render" },
      ]),
      "Paint failure was not reported once as a render failure",
    );
    h.destroy();
  }
  {
    const h = harness();
    h.render();
    h.loads[0]!.resolve(h.module);
    await flush();
    h.arenas[0]!.ready.resolve();
    await flush();
    h.arenas[0]!.status?.("context-lost");
    h.expire(2000);
    check(
      h.canvas().dataset.rendererStatus === "failed",
      "Unrestored context did not offer retry",
    );
    check(
      same(h.reports, [
        { kind: "ready", renderer: "canvas" },
        { kind: "failed", stage: "context" },
      ]),
      "Unrestored context was not reported as a context failure",
    );
    h.destroy();
  }
  {
    const h = harness();
    h.render();
    h.loads[0]!.resolve(h.module);
    await flush();
    const arena = h.arenas[0]!;
    h.destroy();
    await flush();
    check(arena.destroys === 1, "Pending startup disposal was not idempotent");
    arena.status?.("context-lost");
    check(h.timers.size === 0, "Disposed context event scheduled recovery");
  }

  // A loading bar, and a deadline that a load still making progress does not trip.
  {
    const h = harness();
    h.render();
    const waiting = h.bar();
    check(
      waiting?.indeterminate === true && waiting.value === null,
      "No indeterminate bar while the module downloads",
    );
    h.loads[0]!.resolve(h.module);
    await flush();
    const arena = h.arenas[0]!;
    arena.progress?.(0.25);
    const quarter = h.bar();
    check(
      quarter?.value === "25" &&
        quarter.width === "25%" &&
        !quarter.indeterminate &&
        quarter.text === "Loading graphics 25%",
      `Loader progress did not reach the bar: ${JSON.stringify(quarter)}`,
    );
    // Both deadlines are the same length, so the timer itself is the evidence: each step forward must replace the
    // pending one rather than leave it running down, and never leave two armed at once.
    for (const step of [0.5, 0.75, 0.9]) {
      const pending = [...h.timers];
      check(pending.length === 1, `Loading armed ${pending.length} deadlines`);
      arena.progress?.(step);
      const replaced = [...h.timers];
      check(
        replaced.length === 1 && replaced[0] !== pending[0],
        "Progress did not push the deadline back",
      );
    }
    check(
      h.bar()?.value === "90" &&
        h.canvas().dataset.rendererStatus === "starting" &&
        h.reports.length === 0,
      "A load that kept progressing was failed anyway",
    );
    // Progress that repeats itself is not progress: the loader has stopped where it stands.
    const standing = [...h.timers];
    arena.progress?.(0.9);
    check(
      [...h.timers][0] === standing[0],
      "A repeated figure bought the loader more time",
    );
    // A stalled load still fails, rather than hanging forever behind a bar that never moves.
    h.expire(LOADING_STALL_MS);
    check(
      h.canvas().dataset.rendererStatus === "failed" &&
        same(h.reports, [{ kind: "failed", stage: "startup" }]),
      "A stalled load was not failed",
    );
    check(!h.bar(), "The loading bar outlived a failed load");
    h.destroy();
    arena.ready.reject(Error("Disposed"));
    await flush();
  }
  // Readiness clears the bar and leaves no deadline behind.
  {
    const h = harness();
    h.render();
    h.loads[0]!.resolve(h.module);
    await flush();
    const arena = h.arenas[0]!;
    arena.progress?.(0.5);
    arena.progress?.(1);
    arena.ready.resolve();
    await flush();
    check(!h.bar(), "The loading bar outlived a ready arena");
    check(h.timers.size === 0, "Readiness left a loading deadline armed");
    check(
      same(h.reports, [{ kind: "ready", renderer: "canvas" }]),
      "A load that showed progress did not report ready",
    );
    h.destroy();
  }
}
