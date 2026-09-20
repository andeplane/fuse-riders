import {
  mountArenaPresentation,
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
    h.expire(10000);
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
    h.expire(10000);
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
    h.expire(10000);
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
      [...h.timers].some((timer) => timer.delay === 10000),
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
}
