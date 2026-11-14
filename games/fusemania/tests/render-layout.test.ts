import test from "node:test";
import assert from "node:assert/strict";
import { COLUMNS } from "../src/engine/view-kit.js";
import {
  boxX,
  boxY,
  laneOf,
  layoutFor,
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

          assert.equal(layout.fields.length, local >= 0 ? 1 : riders, where);
          assert.deepEqual(
            layout.fields.map((field) => field.slot),
            local >= 0 ? [local] : Array.from({ length: riders }, (_, i) => i),
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
            for (const b of layout.fields.slice(i + 1))
              assert.ok(!overlap(fieldBox(a), fieldBox(b)), where);

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
    // The strip is above the field, which keeps the canvas's width.
    const field = phone.fields[0]!;
    assert.ok(phone.panel!.y + phone.panel!.boxHeight < field.top);
    assert.ok(
      field.col * COLUMNS > phone.width * 0.8,
      "the field keeps its width",
    );
    // The leader's box is the first on the left.
    assert.ok(boxX(phone.panel!, 0) < boxX(phone.panel!, 1));
    assert.equal(boxY(phone.panel!, 0), boxY(phone.panel!, 3));
  }
  for (const name of ["phone, landscape", "tablet, portrait", "laptop", "TV"]) {
    const wide = at(name, 4, 1);
    assert.equal(wide.panel?.strip, false, name);
    const field = wide.fields[0]!;
    assert.ok(field.x + field.col * COLUMNS < wide.panel!.x, name);
    // The leader's box is on top.
    assert.ok(boxY(wide.panel!, 0) < boxY(wide.panel!, 1));
    assert.equal(boxX(wide.panel!, 0), boxX(wide.panel!, 3));
    // The field is centred in what the panel leaves.
    const middle = field.x + (field.col * COLUMNS) / 2;
    assert.ok(
      Math.abs(middle - wide.panel!.x / 2) < wide.panel!.x * 0.03,
      name,
    );
  }
  // The shared screen: every field, and the board beside them when the fields stay a good size.
  assert.equal(at("TV", 5, -1).panel?.strip, false);
  assert.equal(at("TV", 2, -1).panel?.strip, false);
  assert.equal(at("small phone, portrait", 3, -1).panel, undefined);
  // A local slot that is not in the match is a watcher.
  assert.equal(at("laptop", 2, 7).fields.length, 2);
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
