/**
 * The Z-style HUD as DOM over pixel art: steel, frames, the portrait, spell icons and unit cards are painted once by
 * `render/pixel/` into small canvases or data URLs and scaled 2x by CSS with `image-rendering: pixelated`, so they
 * stay crisp. Text, bars and buttons are DOM (readable, clickable and tappable); every write goes through `put`, which
 * skips a value already written, so a steady frame touches nothing and nothing reads layout.
 */
import { el } from "fuse-ui";
import { STANCES, type Stance, type UnitKind } from "../engine/index.js";
import type { WorldView } from "../engine/index.js";
import { minimapBase, paintMinimap } from "../render/minimap.js";
import { Img } from "../render/pixel/image.js";
import { portrait } from "../render/pixel/portraits.js";
import { unitCard } from "../render/pixel/scenes.js";
import { SPELL_ICONS, frame, steelTile } from "../render/pixel/ui.js";
import {
  createHud,
  deriveHud,
  factoriesOf,
  factoryPanel,
} from "./hud-state.js";
import type { SlotView } from "./model.js";

export interface HudActions {
  cast(slot: number): void;
  stance(stance: Stance): void;
  order(factory: number, kind: UnitKind): void;
  /** Centres the camera on fractions of the map. */
  look(fx: number, fy: number): void;
}

/** "lightTank" reads "LIGHT TANK". */
const label = (id: string) => id.replace(/([A-Z])/g, " $1").toUpperCase();

/** Copies `img` into a canvas of its size. */
function draw(canvas: HTMLCanvasElement, img: Img): void {
  const ctx = canvas.getContext("2d");
  const data = ctx?.createImageData(img.w, img.h);
  if (ctx && data) ctx.putImageData((data.data.set(img.d), data), 0, 0);
}

/** A canvas holding `img` at 2 CSS pixels per art pixel. */
function pixels(img: Img): HTMLCanvasElement {
  const canvas = el("canvas");
  [canvas.width, canvas.height] = [img.w, img.h];
  draw(canvas, img);
  canvas.style.width = `${img.w * 2}px`;
  return canvas;
}

let skinned = false;
/** The steel and frame textures as CSS custom properties, painted once per page. */
function paintSkin(): void {
  if (skinned) return;
  skinned = true;
  const url = (img: Img) => `url(${pixels(img).toDataURL()})`;
  const frames = (["steel", "lit", "gold", "bay"] as const).map(
    (k) => `--ff-frame-${k}: ${url(frame(k))};`,
  );
  const tile = `--ff-steel-tile: ${url(steelTile())};`;
  document.head.append(el("style", `:root { ${tile} ${frames.join(" ")} }`));
}

export class Hud {
  readonly top = el("div", "", "ff-bar");
  readonly bottom = el("div", "", "ff-panel");
  readonly orders = el("div", "", "ff-orders ff-frame");
  readonly state = createHud();
  private readonly written = new WeakMap<HTMLElement, Map<string, string>>();
  private readonly meter = el("div", "", "ff-meter");
  private readonly clock = el("span");
  private readonly timer = el("span");
  private readonly chips = el("div", "", "ff-chips");
  private readonly bars = ["hp", "en", "xp"].map((k) =>
    el("i", "", `ff-fill ff-${k}`),
  );
  private readonly level = el("b");
  private readonly spells = SPELL_ICONS.map(() => ({
    button: el("button", "", "ff-spell ff-bay"),
    shade: el("i", "", "ff-shade"),
    secs: el("span", "", "ff-secs"),
  }));
  private readonly stances = STANCES.map((s, i) =>
    el("button", `${i + 1} ${s.toUpperCase()}`, "ff-switch"),
  );
  private readonly factories = el("div", "", "ff-factories");
  private readonly portrait = el("div", "", "ff-bay");
  private readonly mini = el("canvas", "", "ff-mini");
  private readonly camera = el("i", "", "ff-camera");
  private readonly title = el("h3");
  private readonly choices = el("div", "", "ff-choices");
  private readonly build = el("i", "", "ff-fill ff-xp");
  private readonly eta = el("span", "", "ff-eta");
  private miniBase = new Img(1, 1);
  private miniImg = new Img(1, 1);
  private miniStep = -1;
  private open = -1;
  private world: WorldView | undefined;
  private seat = -1;
  private box = { x: -1, y: -1, w: 0, h: 0 };

  constructor(readonly actions: HudActions) {
    paintSkin();
    const clock = el("span", "CLOCK", "ff-label");
    this.top.append(this.meter, clock, this.clock, this.timer, this.chips);
    const bars = el("div", "", "ff-bars ff-bay");
    ["HP", "EN", "XP"].forEach((name, i) => {
      const track = el("span", "", "ff-track");
      track.append(this.bars[i]!);
      bars.append(el("span", name, "ff-label"), track);
    });
    bars.append(this.level);
    const spells = el("div", "", "ff-spells");
    this.spells.forEach(({ button, shade, secs }, slot) => {
      const icon = new Img(30, 30);
      SPELL_ICONS[slot]!(icon, 0, 0);
      const { key, name } = this.state.spells[slot]!;
      button.append(pixels(icon), shade, secs, el("kbd", key));
      button.title = name;
      button.setAttribute("aria-label", `${name} (${key})`);
      button.onclick = () => this.actions.cast(slot);
      spells.append(button);
    });
    const stance = el("div", "", "ff-stance");
    this.stances.forEach(
      (button, i) => (button.onclick = () => this.actions.stance(STANCES[i]!)),
    );
    stance.append(...this.stances, this.factories);
    const map = el("div", "", "ff-minimap ff-bay");
    map.append(this.mini, this.camera);
    map.onpointerdown = (event) => {
      const box = this.mini.getBoundingClientRect();
      if (box.width)
        this.actions.look(
          (event.clientX - box.left) / box.width,
          (event.clientY - box.top) / box.height,
        );
    };
    this.bottom.append(this.portrait, bars, spells, stance, map);
    const close = el("button", "✕", "ff-close");
    close.title = "Close (Esc)";
    close.onclick = () => this.close();
    const track = el("span", "", "ff-track");
    track.append(this.build);
    this.orders.append(this.title, close, this.choices, track, this.eta);
    this.orders.hidden = true;
  }

  /** Writes `value` through `apply` only when it differs from the last value written under `key`. */
  private put(t: HTMLElement, key: string, value: string, apply: () => void) {
    let seen = this.written.get(t);
    if (!seen) this.written.set(t, (seen = new Map()));
    if (seen.get(key) !== value) (apply(), seen.set(key, value));
  }
  private text(target: HTMLElement, value: string): void {
    this.put(target, "text", value, () => (target.textContent = value));
  }
  private css(target: HTMLElement, prop: string, value: string): void {
    this.put(target, prop, value, () => target.style.setProperty(prop, value));
  }
  private flag(target: HTMLElement, name: string, on: boolean): void {
    this.put(target, name, String(on), () => target.classList.toggle(name, on));
  }

  /** Refreshes the HUD from a new world for this device's `seat` and the match's slots. */
  update(world: WorldView, seat: number, slots: readonly SlotView[]): void {
    [this.world, this.seat] = [world, seat];
    const s = deriveHud(this.state, world, seat);
    const team = seat < 0 ? "red" : seat % 2 ? "blue" : "red";
    this.put(this.portrait, "team", team, () => {
      const img = new Img(44, 44);
      portrait(img, 0, 0, "brick", team);
      this.portrait.replaceChildren(pixels(img));
    });
    const blocks =
      "0".repeat(s.red) + "n".repeat(s.neutral) + "1".repeat(s.blue);
    const block = (b: string) => el("i", "", `ff-block ff-t${b}`);
    this.put(this.meter, "blocks", blocks, () =>
      this.meter.replaceChildren(...[...blocks].map(block)),
    );
    this.text(this.clock, `×${(s.clock / 100).toFixed(2)}`);
    this.text(this.timer, s.time);
    this.put(this.chips, "slots", JSON.stringify(slots), () =>
      this.chips.replaceChildren(
        ...slots.map((slot) => {
          const name = slot.bot ? `AI ${slot.difficulty}` : slot.name;
          return el("span", name, `ff-chip ff-t${slot.team}`);
        }),
      ),
    );
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    [s.hp, s.energy, s.xp].forEach((v, i) =>
      this.css(this.bars[i]!, "width", pct(v)),
    );
    this.text(
      this.level,
      s.respawn ? `RESPAWN ${s.respawn}s` : `LV ${s.level}`,
    );
    s.spells.forEach((spell, i) => {
      const { button, shade, secs } = this.spells[i]!;
      this.css(shade, "height", pct(spell.locked ? 1 : spell.shade));
      const left = spell.seconds ? String(spell.seconds) : "";
      this.text(secs, spell.locked ? "LV6" : left);
      this.flag(button, "ff-gold", spell.ultimate);
      button.disabled = !spell.ready;
    });
    this.stances.forEach((button, i) =>
      this.flag(button, "ff-lit", s.stance === STANCES[i]),
    );
    const mine = factoriesOf(world, seat);
    this.put(this.factories, "ids", mine.map((f) => f.id).join(), () =>
      this.factories.replaceChildren(
        ...mine.map((f, i) => {
          const kind = f.kind === "robotFactory" ? "ROBOTS" : "TANKS";
          const button = el("button", `${kind} ${i + 1}`, "ff-switch");
          button.title = `${label(f.kind)} orders`;
          button.onclick = () => this.openFactory(f.id);
          return button;
        }),
      ),
    );
    if (this.open >= 0) this.showOrders();
    this.paintMinimap(world);
  }

  /** The minimap redraws every 10 steps of match time, and at once when a sector changes hands or a match starts. */
  private paintMinimap(world: WorldView): void {
    if (this.miniBase.w !== world.width || world.step < this.miniStep) {
      this.miniBase = minimapBase(world);
      this.miniImg = new Img(world.width, world.height);
      [this.mini.width, this.mini.height] = [world.width, world.height];
      this.miniStep = -1;
    }
    const owners = world.sectorOwners.join();
    this.put(this.mini, "owners", owners, () => (this.miniStep = -1));
    if (this.miniStep >= 0 && world.step - this.miniStep < 10) return;
    this.miniStep = world.step;
    paintMinimap(this.miniImg, this.miniBase, world);
    draw(this.mini, this.miniImg);
  }

  /** Moves the minimap's camera rectangle; called every animation frame but writes only on change. */
  cameraBox(box: { x: number; y: number; w: number; h: number }): void {
    const { x, y, w, h } = this.box;
    if (box.x === x && box.y === y && box.w === w && box.h === h) return;
    this.box = box;
    const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
    Object.assign(this.camera.style, {
      left: pct(box.x),
      top: pct(box.y),
      width: pct(box.w),
      height: pct(box.h),
    });
  }

  /** Opens factory `id`'s orders panel; it follows the world until closed or the factory is lost. */
  openFactory(id: number): void {
    this.open = id;
    this.showOrders();
  }

  close(): void {
    this.open = -1;
    this.orders.hidden = true;
  }

  private showOrders(): void {
    const panel = this.world && factoryPanel(this.world, this.open, this.seat);
    if (!panel) return this.close();
    this.orders.hidden = false;
    this.text(this.title, label(panel.kind));
    this.put(this.choices, "kinds", `${panel.id}:${panel.choices.join()}`, () =>
      this.choices.replaceChildren(
        ...panel.choices.map((kind) => {
          const button = el("button", "", "ff-choice ff-bay");
          button.dataset.kind = kind;
          button.append(
            pixels(
              unitCard(
                kind === "lightTank" ? "light" : (kind as "grunt" | "torch"),
              ),
            ),
            el("span", label(kind)),
          );
          button.onclick = () => this.actions.order(panel.id, kind);
          return button;
        }),
      ),
    );
    for (const button of this.choices.children)
      if (button instanceof HTMLElement)
        this.flag(button, "ff-lit", button.dataset.kind === panel.order);
    this.css(this.build, "width", `${Math.round(panel.progress / 10)}%`);
    const order = panel.order && `${label(panel.order)} in ${panel.eta}s`;
    this.text(this.eta, panel.paused ? "PAUSED · unit cap" : (order ?? "IDLE"));
  }
}
