import test from "node:test";
import assert from "node:assert/strict";
import {
  APPLY,
  CITY,
  DOCKS,
  EMPLOYERS,
  FRESHCO,
  FUSETOWN,
  HOURS,
  JOBHUB,
  JOBS,
  LESSONS,
  LONGEST_TRIP,
  PLACES,
  ROOMSHARE,
  STEPS,
  STREETS,
  UNITS_PER_HOUR,
  WORK,
  WORKPLACE,
  appliesAt,
  buildStreets,
  doorOf,
  nextStep,
  walkSteps,
  type City,
} from "../src/game/index.js";
import {
  act,
  addBot,
  enter,
  fold,
  runWhile,
  started,
} from "./fixtures/lane.js";

const DECKHAND = JOBS.findIndex((job) => job.title === "Deckhand");
const PORT = EMPLOYERS.indexOf("Fusetown Port");

test("Fusetown's data: one door node per place, in PLACES order, every edge between known nodes, all on the map", () => {
  assert.equal(CITY, FUSETOWN);
  assert.deepEqual(
    CITY.places.map((place) => place.id),
    PLACES.map((place) => place.id),
  );
  const ids = CITY.nodes.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, "node ids are unique");
  for (const place of CITY.places) assert.ok(ids.includes(place.door));
  assert.ok(ids.includes(CITY.start));
  const onMap = ([x, y]: readonly [number, number]) =>
    x >= 0 && x <= CITY.map.width && y >= 0 && y <= CITY.map.height;
  for (const edge of CITY.edges) {
    assert.ok(ids.includes(edge.from) && ids.includes(edge.to));
    for (const point of edge.via) assert.ok(onMap(point));
  }
  for (const node of CITY.nodes) assert.ok(onMap(node.at), node.id);
  for (const place of CITY.places) {
    assert.ok(place.tap.length >= 3, place.id);
    assert.ok(place.tap.every(onMap) && onMap(place.label), place.id);
  }
});

test("the streets are one connected graph of unit steps, and every door is reachable from every step", () => {
  assert.equal(STEPS, STREETS.size);
  assert.equal(STREETS.points.length, STEPS);
  assert.equal(STREETS.start, doorOf(ROOMSHARE));
  STREETS.neighbours.forEach((around, step) => {
    assert.ok(around.length > 0, `step ${step} has a neighbour`);
    assert.deepEqual(
      [...around],
      [...around].sort((a, b) => a - b),
    );
    for (const other of around) {
      assert.ok(
        STREETS.neighbours[other]!.includes(step),
        "links go both ways",
      );
      // One step is about the same distance everywhere: 1 / scale map px.
      const [x0, y0] = STREETS.points[step]!,
        [x1, y1] = STREETS.points[other]!;
      const pixels = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
      assert.ok(
        pixels * STREETS.scale > 0.5 && pixels * STREETS.scale < 1.6,
        `step ${step}–${other} is ${(pixels * STREETS.scale).toFixed(2)} steps long`,
      );
    }
  });
  PLACES.forEach((_, place) => {
    assert.equal(walkSteps(doorOf(place), place), 0);
    for (let step = 0; step < STEPS; step++)
      assert.ok(walkSteps(step, place) >= 0, `${step} reaches place ${place}`);
  });
});

test("following the next steps walks from every step to every place's door in exactly its distance", () => {
  PLACES.forEach((_, place) => {
    for (let step = 0; step < STEPS; step++) {
      let at = step,
        taken = 0;
      while (at !== doorOf(place) && taken <= STEPS) {
        const next = nextStep(at, place);
        assert.ok(STREETS.neighbours[at]!.includes(next), "one step at a time");
        assert.equal(walkSteps(next, place), walkSteps(at, place) - 1);
        at = next;
        taken++;
      }
      assert.equal(at, doorOf(place));
      assert.equal(taken, walkSteps(step, place));
    }
    assert.equal(nextStep(doorOf(place), place), doorOf(place));
  });
});

test("the longest trip between two places is about the old ring's half lap, 85 steps", () => {
  let longest = 0,
    total = 0,
    trips = 0;
  PLACES.forEach((_, from) =>
    PLACES.forEach((__, to) => {
      if (from === to) return;
      const steps = walkSteps(doorOf(from), to);
      assert.equal(steps, walkSteps(doorOf(to), from), "the same both ways");
      assert.ok(steps > 0, `${PLACES[from]!.id} and ${PLACES[to]!.id} differ`);
      longest = Math.max(longest, steps);
      total += steps;
      trips++;
    }),
  );
  assert.equal(LONGEST_TRIP, 85);
  assert.ok(Math.abs(longest - LONGEST_TRIP) <= 2, `longest ${longest}`);
  const mean = total / trips;
  assert.ok(mean > 30 && mean < 60, `mean trip ${mean.toFixed(1)}`);
  // In hours: the longest walk is under 6, the shortest across town over 1.
  assert.ok(longest / UNITS_PER_HOUR < 6);
});

test("the streets are built the same every time, and a broken city is refused", () => {
  const again = buildStreets(CITY);
  assert.deepEqual(again.points, STREETS.points);
  assert.deepEqual(again.neighbours, STREETS.neighbours);
  assert.deepEqual(
    again.next.map((row) => [...row]),
    STREETS.next.map((row) => [...row]),
  );
  // A tiny city: two places at the ends of one bent street.
  const tiny: City = {
    id: "tiny",
    name: "Tiny",
    map: { art: "board-tiny", width: 100, height: 100 },
    nodes: [
      { id: "a", at: [0, 0] },
      { id: "b", at: [60, 80] },
      { id: "c", at: [90, 90] },
    ],
    edges: [
      { from: "a", to: "b", via: [[60, 0]], kind: "road" },
      { from: "b", to: "c", via: [], kind: "path" },
    ],
    places: [
      {
        id: "x",
        door: "a",
        tap: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        label: [0, 0],
      },
      {
        id: "y",
        door: "c",
        tap: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        label: [0, 0],
      },
    ],
    start: "a",
    occluders: [],
  };
  const streets = buildStreets(tiny, 20);
  assert.equal(streets.distance[1]![streets.doors[0]!], 20);
  assert.equal(streets.start, 0);
  assert.throws(
    () => buildStreets({ ...tiny, edges: [tiny.edges[0]!] }),
    /not connected/,
  );
  assert.throws(
    () =>
      buildStreets({
        ...tiny,
        edges: [...tiny.edges, { from: "a", to: "zz", via: [], kind: "road" }],
      }),
    /bad edge/,
  );
  assert.throws(
    () =>
      buildStreets({
        ...tiny,
        places: [{ ...tiny.places[0]!, door: "nowhere" }],
      }),
    /no door/,
  );
});

test("the docks are Fusetown Port's workplace: its jobs are hireable at the gate and at the Job Hub", () => {
  assert.equal(PLACES[DOCKS]!.id, "docks");
  assert.equal(PLACES[DOCKS]!.name, "Fusetown Docks");
  assert.equal(WORKPLACE[PORT], DOCKS);
  assert.ok(
    WORKPLACE.every((place) => place >= 0),
    "every employer has a workplace",
  );
  const ladder = JOBS.filter((job) => job.employer === PORT);
  assert.deepEqual(
    ladder.map((job) => job.title),
    ["Deckhand", "Forklift Driver", "Crane Operator", "Harbour Master"],
  );
  for (const job of ladder) {
    assert.ok(appliesAt(DOCKS, job));
    assert.ok(appliesAt(JOBHUB, job));
    assert.ok(!appliesAt(FRESHCO, job), "not at another employer's shop");
  }

  // Hired at the gate, then a shift on the quay.
  const room = started();
  const a = room.players.a!;
  Object.assign(a, { dep: 150, exp: 150 });
  enter(room, "a", DOCKS);
  fold(room, { a: [act(room, DOCKS, APPLY, DECKHAND)] });
  assert.equal(a.job, DECKHAND, a.msg);
  const cash = a.cash,
    time = a.time;
  fold(room, { a: [act(room, DOCKS, WORK)] });
  assert.equal(a.time, time + HOURS.work * UNITS_PER_HOUR);
  assert.ok(a.cash > cash);

  // Or at the Job Hub; an application at a shop that is not the employer's gate does nothing.
  const b = room.players.b!;
  Object.assign(b, { dep: 150, exp: 150 });
  b.courses[0] = LESSONS; // the Forklift Driver needs the first degree
  enter(room, "b", FRESHCO);
  const before = b.time;
  fold(room, { b: [act(room, FRESHCO, APPLY, DECKHAND + 1)] });
  assert.equal(b.time, before);
  assert.equal(b.job, -1);
  enter(room, "b", JOBHUB);
  fold(room, { b: [act(room, JOBHUB, APPLY, DECKHAND + 1)] });
  assert.equal(b.job, DECKHAND + 1, b.msg);
});

test("bots live whole weeks on the streets: every step they stand on is a real one, and they find work", () => {
  const room = started(undefined, [addBot("bot:1", 2), addBot("bot:2", 3)]);
  const seen = new Set<number>();
  runWhile(
    room,
    () => {
      for (const id of ["bot:1", "bot:2"]) seen.add(room.players[id]!.pos);
      return room.week < 4;
    },
    60_000,
  );
  assert.equal(room.week, 4);
  for (const step of seen) assert.ok(step >= 0 && step < STEPS);
  assert.ok(seen.size > 20, "they walked about town");
  assert.ok(
    ["bot:1", "bot:2"].some((id) => room.players[id]!.job >= 0),
    "a bot got a job",
  );
});
