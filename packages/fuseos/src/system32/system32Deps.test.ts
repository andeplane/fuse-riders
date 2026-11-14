import { MemoryScheduler } from "./system32Deps";

describe(MemoryScheduler.name, () => {
  it("fires timers in due order as the clock advances, and only once", () => {
    const scheduler = new MemoryScheduler();
    const fired: string[] = [];
    scheduler.setTimeout(() => fired.push("b"), 20);
    scheduler.setTimeout(() => fired.push("a"), 10);
    scheduler.setTimeout(() => fired.push("c"), 30);
    expect(scheduler.pending).toBe(3);
    scheduler.advance(5);
    expect(fired).toEqual([]);
    scheduler.advance(15);
    expect(fired).toEqual(["a", "b"]);
    expect(scheduler.now).toBe(20);
    scheduler.advance(100);
    expect(fired).toEqual(["a", "b", "c"]);
    expect(scheduler.pending).toBe(0);
  });

  it("runs a timer a callback arms within the same advance when it is due, and drops cleared ones", () => {
    const scheduler = new MemoryScheduler();
    const fired: string[] = [];
    scheduler.setTimeout(() => {
      fired.push("first");
      scheduler.setTimeout(() => fired.push("chained"), 5);
    }, 10);
    const cleared = scheduler.setTimeout(() => fired.push("cleared"), 12);
    scheduler.clearTimeout(cleared);
    scheduler.advance(15);
    expect(fired).toEqual(["first", "chained"]);
    expect(scheduler.now).toBe(15);
  });
});
