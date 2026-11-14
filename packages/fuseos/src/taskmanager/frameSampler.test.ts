import { FakeFrameWindow } from "./fakeTaskManagerDeps";
import { FrameSampler, History, STALL_MS } from "./frameSampler";

function clock() {
  let time = 0;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe(FrameSampler.name, () => {
  it("requests a frame as soon as it starts and keeps one requested after every frame", () => {
    const { now } = clock();
    const frame = new FakeFrameWindow(now);
    const sampler = new FrameSampler(frame, now);
    expect(frame.pendingCount()).toBe(1);
    frame.paint(3);
    expect(frame.pendingCount()).toBe(1);
    expect(frame.requested).toHaveLength(4);
    sampler.dispose();
  });

  it("reports frames per second over the interval since the last sample", () => {
    const { now, advance } = clock();
    const frame = new FakeFrameWindow(now);
    const sampler = new FrameSampler(frame, now);
    frame.paint(60);
    advance(1000);
    expect(sampler.sample()).toEqual({ fps: 60, status: "running" });
    frame.paint(15);
    advance(500);
    expect(sampler.sample()).toEqual({ fps: 30, status: "running" });
    sampler.dispose();
  });

  it("reports zero without dividing by zero when sampled twice at the same instant", () => {
    const { now } = clock();
    const frame = new FakeFrameWindow(now);
    const sampler = new FrameSampler(frame, now);
    expect(sampler.sample().fps).toBe(0);
    sampler.dispose();
  });

  it("is Not Responding once no frame has fired for longer than the stall limit, and recovers", () => {
    const { now, advance } = clock();
    const frame = new FakeFrameWindow(now);
    const sampler = new FrameSampler(frame, now);
    frame.paint();
    advance(STALL_MS);
    expect(sampler.sample().status).toBe("running");
    advance(1);
    expect(sampler.sample().status).toBe("notResponding");
    frame.paint();
    advance(100);
    expect(sampler.sample().status).toBe("running");
    sampler.dispose();
  });

  it("counts a page that never painted as Not Responding only after the stall limit", () => {
    const { now, advance } = clock();
    const frame = new FakeFrameWindow(now);
    const sampler = new FrameSampler(frame, now);
    advance(1000);
    expect(sampler.sample().status).toBe("running");
    advance(STALL_MS);
    expect(sampler.sample().status).toBe("notResponding");
    sampler.dispose();
  });

  it("re-arms the frame request when a sample saw no frame, so a navigated page is picked up again", () => {
    const { now, advance } = clock();
    const frame = new FakeFrameWindow(now);
    const sampler = new FrameSampler(frame, now);
    const [first] = frame.requested;
    advance(1000);
    sampler.sample();
    expect(frame.cancelled).toEqual([first]);
    expect(frame.requested).toHaveLength(2);
    expect(frame.pendingCount()).toBe(1);
    sampler.dispose();
  });

  it("cancels its pending frame on dispose and never requests another", () => {
    const { now } = clock();
    const frame = new FakeFrameWindow(now);
    const sampler = new FrameSampler(frame, now);
    sampler.dispose();
    expect(frame.pendingCount()).toBe(0);
    frame.paint();
    expect(frame.requested).toHaveLength(1);
    sampler.dispose();
    expect(frame.cancelled).toHaveLength(1);
  });
});

describe(History.name, () => {
  it("keeps the last `capacity` values, oldest first", () => {
    const history = new History(3);
    expect(history.latest()).toBeUndefined();
    expect(history.toArray()).toEqual([]);
    [1, 2, 3, 4].forEach((value) => history.push(value));
    expect(history.toArray()).toEqual([2, 3, 4]);
    expect(history.latest()).toBe(4);
  });

  it("hands out a copy, so a reader cannot change the series", () => {
    const history = new History(2);
    history.push(1);
    const values = history.toArray();
    expect(values).not.toBe(history.toArray());
  });
});
