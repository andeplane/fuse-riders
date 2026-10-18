/**
 * The Z-style HUD as DOM over pixel art: steel, frames, the portrait, spell icons and unit cards are painted once by
 * `render/pixel/` into small canvases or data URLs and scaled 2x by CSS with `image-rendering: pixelated`, so they
 * stay crisp. Text, bars and buttons are DOM (readable, clickable and tappable); every write goes through `put`, which
 * skips a value already written, so a steady frame touches nothing and nothing reads layout.
 */
import { el } from "fuse-ui";
import {
  SPELL_INFO,
  STANCES,
  type Stance,
  type UnitKind,
} from "../engine/index.js";
import type { WorldView } from "../engine/index.js";
import { minimapBase, paintMinimap } from "../render/minimap.js";
import { Img } from "../render/pixel/image.js";
import { portrait } from "../render/pixel/portraits.js";
import { unitCard } from "../render/pixel/scenes.js";
import { spellIcon } from "../render/pixel/icons.js";
import { frame, steelTile } from "../render/pixel/ui.js";
import {
  createHud,
  deriveHud,
  factoriesOf,
  factoryPanel,
} from "./hud-state.js";
import type { SlotView } from "./model.js";
import { label, spellTooltip, targetPanel } from "./targeting.js";

export interface HudActions {
  cast(slot: number): void;
  /** Arms an attack-move: the next click on the map sends the hero there, fighting on the way. */
  attackMove(): void;
  stance(stance: Stance): void;
  order(factory: number, kind: UnitKind): void;
  /** Centres the camera on fractions of the map. */
  look(fx: number, fy: number): void;
  /** Sends the hero to fractions of the map (a right click on the minimap). */
  move(fx: number, fy: number): void;
}

/** Pings on the minimap at once at most; a new one past this replaces the oldest. */
const MAX_PINGS = 4;

/** Copies `img` into a canvas of its size. */
function draw(canvas: HTMLCanvasElement, img: Img): void {
  const ctx = canvas.getContext("2d");
  const data = ctx?.createImageData(img.w, img.h);
  if (ctx && data) ctx.putImageData((data.data.set(img.d), data), 0, 0);
}

/** A canvas holding `img` at 2 CSS pixels per art pixel. */
export function pixels(img: Img): HTMLCanvasElement {
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
  private readonly spells = [0, 1, 2, 3].map(() => ({
    button: el("button", "", "ff-spell ff-bay"),
    icon: el("span", "", "ff-icon"),
    shade: el("i", "", "ff-shade"),
    secs: el("span", "", "ff-secs"),
    tip: el("span", "", "ff-tip ff-frame"),
  }));
  private readonly amove = el("button", "A ATTACK-MOVE", "ff-switch");
  /** What the hero shoots: its name, hit points and whether it was chosen. */
  private readonly target = el("span", "", "ff-target");
  private readonly targetName = el("b");
  private readonly targetHp = el("i", "", "ff-fill ff-hp");
  private readonly targetTag = el("span", "", "ff-label ff-tag");
  private readonly stances = STANCES.map((s, i) =>
    el("button", `${i + 1} ${s.toUpperCase()}`, "ff-switch"),
  );
  private readonly factories = el("div", "", "ff-factories");
  private readonly portrait = el("div", "", "ff-bay");
  private readonly mini = el("canvas", "", "ff-mini");
  private readonly camera = el("i", "", "ff-camera");
  private readonly map = el("div", "", "ff-minimap ff-bay");
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
    // What the hero shoots, under its own bars: name, FOCUS or AUTO, and hit points.
    const targetHp = el("span", "", "ff-track");
    targetHp.append(this.targetHp);
    this.target.append(this.targetName, this.targetTag, targetHp);
    bars.append(el("span", "TGT", "ff-label"), this.target, this.level);
    const spells = el("div", "", "ff-spells");
    this.spells.forEach(({ button, icon, shade, secs, tip }, slot) => {
      tip.setAttribute("role", "tooltip");
      button.append(icon, shade, secs, el("kbd", this.state.spells[slot]!.key));
      // The tooltip sits beside the button, not in it, so it shows over a disabled (cooling) one too.
      const bay = el("span", "", "ff-spell-bay");
      bay.append(button, tip);
      button.onclick = () => this.actions.cast(slot);
      spells.append(bay);
    });
    const stance = el("div", "", "ff-stance");
    this.stances.forEach(
      (button, i) => (button.onclick = () => this.actions.stance(STANCES[i]!)),
    );
    this.amove.title = "Attack-move: click the map (A)";
    this.amove.onclick = () => this.actions.attackMove();
    stance.append(...this.stances, this.amove, this.factories);
    const map = this.map;
    map.append(this.mini, this.camera);
    // A left click looks there; a right click sends the hero there.
    map.onpointerdown = (event) => {
      const box = this.mini.getBoundingClientRect();
      if (!box.width) return;
      const fx = (event.clientX - box.left) / box.width,
        fy = (event.clientY - box.top) / box.height;
      if (event.button === 2) this.actions.move(fx, fy);
      else this.actions.look(fx, fy);
    };
    map.oncontextmenu = (event) => event.preventDefault();
    this.bottom.append(this.portrait, bars, spells, stance, map);
    const close = el("button", "✕", "ff-close");
    close.title = "Close (Esc)";
    close.onclick = () => this.close();
    const build = el("span", "", "ff-track");
    build.append(this.build);
    this.orders.append(this.title, close, this.choices, build, this.eta);
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
    this.put(this.portrait, "hero", team + s.kind, () => {
      const img = new Img(44, 44);
      portrait(img, 0, 0, s.kind, team);
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
    const kit = SPELL_INFO[s.kind];
    s.spells.forEach((spell, i) => {
      const { button, icon, shade, secs, tip } = this.spells[i]!;
      // The kit's icon and name, redrawn only when the hero changes.
      this.put(icon, "effect", spell.effect + spell.name, () => {
        const art = new Img(30, 30);
        spellIcon(spell.effect)(art, 0, 0);
        icon.replaceChildren(pixels(art));
        const t = spellTooltip(kit[i]!);
        tip.replaceChildren(
          el("b", t.name),
          el("span", t.desc),
          el("small", t.stats),
        );
        button.setAttribute(
          "aria-label",
          `${spell.name} (${spell.key}): ${t.desc}`,
        );
      });
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
    const aim = targetPanel(world, seat);
    // The panel keeps its place with nothing to shoot, so the HUD does not reflow as targets come and go.
    this.text(this.targetName, aim?.name ?? "NONE");
    this.css(this.targetHp, "width", pct(aim?.hp ?? 0));
    this.text(this.targetTag, aim ? (aim.chosen ? "FOCUS" : "AUTO") : "");
    this.flag(this.target, "ff-focus", !!aim?.chosen);
    this.flag(this.target, "ff-t0", aim?.team === 0);
    this.flag(this.target, "ff-t1", aim?.team === 1);
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

  /** A ring that swells and fades on the minimap at fractions `fx`, `fy`: red for a flag lost, amber for one under fire. */
  ping(fx: number, fy: number, kind: "attack" | "lost"): void {
    const dot = el("span", "", `ff-ping ff-ping-${kind}`);
    Object.assign(dot.style, { left: `${fx * 100}%`, top: `${fy * 100}%` });
    dot.onanimationend = () => dot.remove();
    const pings = this.map.querySelectorAll(".ff-ping");
    if (pings.length >= MAX_PINGS) pings[0]!.remove();
    this.map.append(dot);
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

  /** Lights the spell button that is aiming (-1 for none) and the attack-move button while one is armed. */
  armed(slot: number, attackMove: boolean): void {
    this.spells.forEach(({ button }, i) =>
      this.flag(button, "ff-aiming", i === slot),
    );
    this.flag(this.amove, "ff-lit", attackMove);
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
