import test from "node:test";
import assert from "node:assert/strict";
import { COLUMNS } from "../src/engine/view-kit.js";
import {
  boxX,
  boxY,
  laneOf,
  layoutFor,
  raceBand,
  ownPlace,
  type Field,
  type Layout,
} from "../src/render/layout.js";
import { BASE_WINDOW_MS, type LaneGeometry } from "../src/render/mods.js";

/** Canvas sizes in CSS pixels, with the device's pixel ratio. */
const SCREENS = [
  { name: "small phone, portrait", width: 360, height: 640, ratio: 3 },
  { name: "phone, portrait", width: 412, height: 915, ratio: 2.625 },
  { name: "phone, landscape", width: 740, height: 360, ratio: 3 },
  { name: "tablet, portrait", width: 768, height: 1024, ratio: 2 },
  { name: "laptop", width: 1366, height: 768, ratio: 1 },
  { name: "TV", width: 1920, height: 1080, ratio: 1 },
  { name: "4K TV", width: 3840, height: 2160, ratio: 1 },
  { name: "ultrawide", width: 3440, height: 1080, ratio: 1 },
] as const;
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const fieldBox = (field: Field): Box => ({
  x: field.x,
  y: field.top,
  width: field.col * COLUMNS,
  height: field.laneBottom - field.top,
});
const boxes = (layout: Layout): Box[] =>
  layout.panel
    ? Array.from({ length: layout.panel.count }, (_, row) => ({
        x: boxX(layout.panel!, row),
        y: boxY(layout.panel!, row),
        width: layout.panel!.boxWidth,
        height: layout.panel!.boxHeight,
      }))
    : [];
const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
const lane = (): LaneGeometry => ({
  columnWidth: 0,
  targetY: 0,
  length: 0,
  runout: 0,
  windowMs: 0,
  down: false,
});

test("every field and every leaderboard box is inside the canvas and above the touch buttons, for 1 to 5 riders on every screen", () => {
  for (const screen of SCREENS)
    for (const inset of [0, 130])
      for (let riders = 1; riders <= 5; riders++)
        for (const local of [-1, 0, riders - 1]) {
          const unit = screen.ratio;
          const width = Math.round(screen.width * unit),
            height = Math.round(screen.height * unit);
          const layout = layoutFor(width, height, riders, local, inset, unit);
          const where = `${screen.name}, ${riders} riders, local ${local}, inset ${inset}`;
          const floor = height - inset * unit;

          // Every rider's field, each once.
          assert.equal(layout.fields.length, riders, where);
          assert.deepEqual(
            layout.fields.map((field) => field.slot).sort(),
            Array.from({ length: riders }, (_, i) => i),
            where,
          );
          for (const field of layout.fields) {
            const box = fieldBox(field);
            assert.ok(box.x >= 0 && box.x + box.width <= width, where);
            assert.ok(field.top >= layout.barHeight, `${where}: under the bar`);
            assert.ok(field.laneBottom <= floor, `${where}: above the inset`);
            assert.equal(field.laneTop, field.top + field.headerHeight);
            assert.ok(
              field.laneBottom - field.laneTop >= field.col * 4.5,
              `${where}: lanes long enough to read`,
            );
            assert.ok(Number.isInteger(field.x) && Number.isInteger(field.col));
            // Both ways up, the targets are in the lanes and so above the inset.
            for (const down of [false, true]) {
              const geometry = laneOf(field, 1, down, lane());
              assert.ok(
                geometry.targetY - field.col / 2 >= field.laneTop,
                where,
              );
              assert.ok(geometry.targetY + field.col / 2 <= floor, where);
              assert.ok(geometry.length > field.col * 3.5, where);
            }
          }
          for (const [i, a] of layout.fields.entries())
            for (const b of layout.fields.slice(i + 1)) {
              assert.ok(!overlap(fieldBox(a), fieldBox(b)), where);
              // Left to right, with the lanes starting level.
              assert.ok(a.x < b.x, where);
              assert.equal(a.laneTop, b.laneTop, where);
            }

          const panel = boxes(layout);
          assert.equal(panel.length > 0, layout.panel !== undefined);
          if (riders === 1) assert.equal(layout.panel, undefined, where);
          if (riders > 1 && local >= 0)
            assert.equal(panel.length, riders, `${where}: a box per rider`);
          for (const [i, box] of panel.entries()) {
            assert.ok(box.x >= 0 && box.x + box.width <= width, where);
            assert.ok(
              box.y >= layout.barHeight && box.y + box.height <= floor,
              where,
            );
            assert.ok(box.width > 40 * unit && box.height > 30 * unit, where);
            for (const field of layout.fields)
              assert.ok(
                !overlap(box, fieldBox(field)),
                `${where}: box ${i} over a field`,
              );
            for (const other of panel.slice(i + 1))
              assert.ok(!overlap(box, other), `${where}: boxes overlap`);
          }
        }
});

test("the leaderboard is a column on the right where there is room, and a strip along the top of a portrait phone", () => {
  const at = (name: string, riders: number, local: number) => {
    const screen = SCREENS.find((s) => s.name === name)!;
    return layoutFor(
      Math.round(screen.width * screen.ratio),
      Math.round(screen.height * screen.ratio),
      riders,
      local,
      0,
      screen.ratio,
    );
  };
  for (const name of ["small phone, portrait", "phone, portrait"]) {
    const phone = at(name, 4, 1);
    assert.equal(phone.panel?.strip, true, name);
    // The strip is above the fields, and the rider's own keeps half the canvas's width.
    const field = phone.fields.find((each) => each.slot === 1)!;
    assert.ok(phone.panel!.y + phone.panel!.boxHeight < field.top);
    assert.ok(
      field.col * COLUMNS > phone.width * 0.5,
      "the rider's field keeps its width",
    );
    // The leader's box is the first on the left.
    assert.ok(boxX(phone.panel!, 0) < boxX(phone.panel!, 1));
    assert.equal(boxY(phone.panel!, 0), boxY(phone.panel!, 3));
  }
  for (const name of ["phone, landscape", "laptop", "TV"]) {
    const wide = at(name, 4, 1);
    assert.equal(wide.panel?.strip, false, name);
    const first = wide.fields[0]!,
      last = wide.fields[wide.fields.length - 1]!;
    const end = last.x + last.col * COLUMNS;
    assert.ok(end < wide.panel!.x, name);
    // The leader's box is on top.
    assert.ok(boxY(wide.panel!, 0) < boxY(wide.panel!, 1));
    assert.equal(boxX(wide.panel!, 0), boxX(wide.panel!, 3));
    // The row of fields is centred in what the panel leaves.
    assert.ok(
      Math.abs((first.x + end) / 2 - wide.panel!.x / 2) < wide.panel!.x * 0.03,
      name,
    );
  }
  // Where a column of boxes would squeeze the other riders' fields, the board is the strip: a tablet held upright.
  assert.equal(at("tablet, portrait", 4, 1).panel?.strip, true);
  assert.equal(at("tablet, portrait", 2, 1).panel?.strip, false);
  // The shared screen: every field, and the board beside them when the fields stay a good size.
  assert.equal(at("TV", 5, -1).panel?.strip, false);
  assert.equal(at("TV", 2, -1).panel?.strip, false);
  assert.equal(at("small phone, portrait", 3, -1).panel, undefined);
  // A local slot that is not in the match is a watcher.
  assert.equal(at("laptop", 2, 7).fields.length, 2);
});

test("a rider's own field is in the middle of an odd number of riders and on the left of an even one, and the biggest", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(ownPlace), [0, 0, 1, 0, 2]);
  for (const screen of SCREENS)
    for (let riders = 2; riders <= 5; riders++)
      for (let local = 0; local < riders; local++) {
        const unit = screen.ratio;
        const layout = layoutFor(
          Math.round(screen.width * unit),
          Math.round(screen.height * unit),
          riders,
          local,
          0,
          unit,
        );
        const where = `${screen.name}, ${riders} riders, local ${local}`;
        const mine = ownPlace(riders);
        assert.equal(layout.fields[mine]!.slot, local, where);
        // The others are in slot order around it, all one size, and smaller.
        const others = layout.fields.filter((_, i) => i !== mine);
        assert.deepEqual(
          others.map((field) => field.slot),
          Array.from({ length: riders }, (_, i) => i).filter(
            (slot) => slot !== local,
          ),
          where,
        );
        const own = layout.fields[mine]!.col;
        for (const field of others) {
          assert.equal(field.col, others[0]!.col, where);
          assert.ok(
            field.col < own,
            `${where}: the rider's own is the biggest`,
          );
          assert.ok(field.col >= own * 0.2, `${where}: and theirs can be seen`);
          assert.ok(field.col >= 9 * unit, `${where}: ${field.col / unit}px`);
        }
      }
  // On a big screen two riders' fields are both a good size, and the rider's own is as big as it is alone.
  const tv = layoutFor(1920, 1080, 2, 1);
  assert.equal(tv.fields[0]!.col, layoutFor(1920, 1080, 1, 0).fields[0]!.col);
  assert.ok(tv.fields[1]!.col >= tv.fields[0]!.col * 0.75);
  // A shared screen and a watcher have no field of their own: every field alike, in slot order.
  const shared = layoutFor(1920, 1080, 4, -1);
  assert.deepEqual(
    shared.fields.map((field) => field.slot),
    [0, 1, 2, 3],
  );
  assert.equal(new Set(shared.fields.map((field) => field.col)).size, 1);
});

test("a field's columns stop growing with a wide screen, and a lone field is centred", () => {
  const wide = layoutFor(3440, 1080, 1, 0, 0, 1),
    laptop = layoutFor(1366, 768, 1, 0, 0, 1);
  assert.ok(wide.fields[0]!.col <= 108);
  assert.equal(laptop.fields[0]!.col, 88);
  for (const layout of [wide, laptop]) {
    const field = layout.fields[0]!;
    assert.ok(
      Math.abs(field.x + (field.col * COLUMNS) / 2 - layout.width / 2) <= 1,
    );
    // With room beside the field, the power-up read-out goes there.
    assert.equal(field.hudAlign, -1);
    assert.ok(field.hudX < field.x);
  }
  const phone = layoutFor(360, 640, 1, 0, 0, 1).fields[0]!;
  assert.equal(phone.hudAlign, 1);
  assert.ok(phone.hudX >= phone.x && phone.col * COLUMNS >= 300);
});

test("the race line is right below the targets, in the lanes of the rider's own field or across a shared screen's", () => {
  for (const screen of SCREENS)
    for (const inset of [0, 130])
      for (let riders = 1; riders <= 5; riders++)
        for (const local of [-1, 0, riders - 1])
          for (const down of [false, true]) {
            const unit = screen.ratio;
            const width = Math.round(screen.width * unit),
              height = Math.round(screen.height * unit);
            const layout = layoutFor(width, height, riders, local, inset, unit);
            const where = `${screen.name}, ${riders} riders, local ${local}, inset ${inset}, down ${down}`;
            const race = raceBand(layout, local, down, {
              x: 0,
              y: 0,
              width: 0,
              height: 0,
            })!;
            assert.ok(race, where);
            const first =
                local < 0
                  ? layout.fields[0]!
                  : layout.fields.find((field) => field.slot === local)!,
              last = local < 0 ? layout.fields[riders - 1]! : first;
            assert.equal(race.x, first.x, where);
            assert.equal(
              race.x + race.width,
              last.x + last.col * COLUMNS,
              where,
            );
            // In the lanes, so inside the canvas and above the touch buttons.
            assert.ok(race.y >= first.laneTop, where);
            assert.ok(race.y + race.height <= first.laneBottom, where);
            const target = laneOf(first, 1, down, lane()).targetY;
            // Its middle is below the targets' middle: under them, or in the run-out beneath them.
            const middle = race.y + race.height / 2;
            assert.ok(middle > target, `${where}: below the targets`);
            // Clear of the targets both ways up, and right under them where the arrows come up to them.
            assert.ok(
              race.y >= Math.floor(target + first.col / 2),
              `${where}: clear of the targets`,
            );
            if (!down)
              assert.ok(
                race.y <= target + first.col / 2 + 4 * unit + 1,
                `${where}: right below them`,
              );
            else
              assert.ok(
                race.height >= Math.min(26 * unit - 1, first.col * 0.4),
                `${where}: as tall as the run-out lets it be`,
              );
          }
  assert.equal(
    raceBand(layoutFor(800, 600, 0, -1), -1, false, {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }),
    undefined,
  );
});

test("degenerate canvases lay out without nonsense", () => {
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [2000, 10],
    [10, 2000],
  ] as const)
    for (let riders = 0; riders <= 6; riders++) {
      const layout = layoutFor(width, height, riders, 0, 50, 2);
      for (const field of layout.fields) {
        assert.ok(field.col >= 1 && Number.isFinite(field.x));
        assert.ok(field.laneBottom >= field.laneTop);
        const geometry = laneOf(field, 0, false, lane());
        assert.ok(geometry.length >= 1 && geometry.windowMs === BASE_WINDOW_MS);
      }
    }
  assert.deepEqual(layoutFor(800, 600, 0, -1).fields, []);
});

test("the scroll speed sets how much of the song a field shows", () => {
  const field = layoutFor(1366, 768, 1, 0).fields[0]!;
  assert.equal(laneOf(field, 1, false, lane()).windowMs, BASE_WINDOW_MS);
  assert.equal(laneOf(field, 2, false, lane()).windowMs, BASE_WINDOW_MS / 2);
  assert.equal(laneOf(field, 0.5, true, lane()).windowMs, BASE_WINDOW_MS * 2);
  const up = laneOf(field, 1, false, lane()),
    down = laneOf(field, 1, true, lane());
  assert.ok(up.targetY < down.targetY, "classic: targets at the top");
  assert.equal(up.length, down.length);
});
