import {
  createDefragSessions,
  defaultDefragDeps,
  prefersReducedMotion,
} from "./defragDepsContext";
import type { DefragSession } from "./defragSession";
import { createDefragSession } from "./defragSession";

function newSession(): DefragSession {
  return createDefragSession({
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    random: () => 0,
    reducedMotion: () => false,
    winampTrack: () => undefined,
  });
}

describe("prefersReducedMotion", () => {
  it("reads the media query, and takes a browser without one as no preference", () => {
    const queries: string[] = [];
    expect(
      prefersReducedMotion({
        matchMedia: (query) => {
          queries.push(query);
          return { matches: true };
        },
      }),
    ).toBe(true);
    expect(queries).toEqual(["(prefers-reduced-motion: reduce)"]);
    expect(
      prefersReducedMotion({ matchMedia: () => ({ matches: false }) }),
    ).toBe(false);
    expect(prefersReducedMotion({})).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
  });
});

describe("defaultDefragDeps", () => {
  it("uses the browser's timers, chance and motion preference", () => {
    vi.useFakeTimers();
    try {
      const fired: string[] = [];
      defaultDefragDeps.setTimeout(() => fired.push("kept"), 10);
      const dropped = defaultDefragDeps.setTimeout(
        () => fired.push("dropped"),
        10,
      );
      defaultDefragDeps.clearTimeout(dropped);
      vi.advanceTimersByTime(10);
      expect(fired).toEqual(["kept"]);
    } finally {
      vi.useRealTimers();
    }
    const value = defaultDefragDeps.random();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    expect(typeof defaultDefragDeps.reducedMotion()).toBe("boolean");
  });
});

describe("createDefragSessions", () => {
  it("creates one session per window, hands the same one back, and disposes it on release", () => {
    const sessions = createDefragSessions();
    let created = 0;
    let notified = 0;
    const unsubscribe = sessions.subscribe(() => {
      notified += 1;
    });
    const create = () => {
      created += 1;
      return newSession();
    };
    expect(sessions.get("w1")).toBeUndefined();
    const session = sessions.acquire("w1", create);
    expect(sessions.acquire("w1", create)).toBe(session);
    expect(sessions.get("w1")).toBe(session);
    expect(created).toBe(1);
    expect(notified).toBe(1);

    let heard = 0;
    session.subscribe(() => {
      heard += 1;
    });
    sessions.release("w1");
    expect(sessions.get("w1")).toBeUndefined();
    expect(notified).toBe(2);
    // Disposed: it no longer tells anyone anything.
    session.choose("A");
    expect(heard).toBe(0);

    // Releasing what is not there is nothing; an unsubscribed listener hears nothing more.
    sessions.release("w1");
    expect(notified).toBe(2);
    unsubscribe();
    sessions.acquire("w2", create);
    expect(notified).toBe(2);
  });
});
