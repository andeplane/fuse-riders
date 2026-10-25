/**
 * The HUD in the 3D robot style: dark glass panels, a portrait rendered from the hero's 3D model (`look.ts`), stroke
 * spell icons, bars with their numbers. Text, bars and buttons are DOM (readable, clickable and tappable); every write
 * goes through `put`, which skips a value already written, so a steady frame touches nothing and nothing reads layout.
 */
import { el } from "fuse-ui";
import { KITS, MAX_LEVEL, SPELL_INFO, type UnitKind } from "../engine/index.js";
import type { WorldView } from "../engine/index.js";
import { minimapBase, paintMinimap } from "../render/minimap.js";
import { Img } from "../render/pixel/image.js";
import { unitCard } from "../render/pixel/scenes.js";
import { HERO_ROLES, heroPortrait, spellIcon } from "./look.js";
import {
  createHud,
  deriveHud,
  factoriesOf,
  factoryPanel,
} from "./hud-state.js";
import type { SlotView } from "./model.js";
import { label, spellTooltip, targetPanel } from "./targeting.js";

export interface HudActions {
  /** Casts or aims a slot; `queued` (Shift) puts the cast behind the hero's route. */
  cast(slot: number, queued?: boolean): void;
  /** Arms an attack-move: the next click on the map sends the hero there, fighting on the way. */
  attackMove(): void;
  /** Centres the camera on fractions of the map. */
  look(fx: number, fy: number): void;
  /** Sends the hero to fractions of the map (a right click on the minimap; with Shift, queued). */
  move(fx: number, fy: number, queued?: boolean): void;
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

export class Hud {
  readonly top = el("div", "", "ff-bar");
  readonly bottom = el("div", "", "ff-panel");
  readonly orders = el("div", "", "ff-orders ff-frame");
  readonly state = createHud();
  private readonly written = new WeakMap<HTMLElement, Map<string, string>>();
  /** The sector tug-of-war: red, neutral and blue shares of one bar, with each side's count beside it. */
  private readonly meter = el("div", "", "ff-meter");
  private readonly shares = ["ff-t0", "ff-tn", "ff-t1"].map((t) =>
    el("i", "", `ff-share ${t}`),
  );
  private readonly scores = [0, 1].map((t) => el("b", "", `ff-score ff-t${t}`));
  private readonly clock = el("span", "", "ff-note");
  private readonly timer = el("span", "", "ff-timer");
  private readonly chips = el("div", "", "ff-chips");
  private readonly bars = ["hp", "en", "xp"].map((k) =>
    el("i", "", `ff-fill ff-${k}`),
  );
  private readonly values = [0, 1, 2].map(() => el("span", "", "ff-value"));
  private readonly heroName = el("b", "", "ff-hero-name");
  private readonly level = el("span", "", "ff-note");
  /** The player's gold (`gold.ts`), at the right of the hero's name. */
  private readonly purse = el("b", "", "ff-purse");
  private readonly spells = [0, 1, 2, 3].map(() => ({
    button: el("button", "", "ff-spell"),
    icon: el("span", "", "ff-icon"),
    shade: el("i", "", "ff-shade"),
    secs: el("span", "", "ff-secs"),
    tag: el("small", "", "ff-tag"),
    tip: el("span", "", "ff-tip ff-frame"),
  }));
  private readonly amove = el("button", "A attack-move", "ff-switch ff-amove");
  /** A toggle for touch: while lit, every order queues as if Shift were held. */
  private readonly queueButton = el("button", "⇧ queue", "ff-switch ff-queue");
  private queueOn = false;
  /** What the hero shoots: its name, hit points and whether it was chosen. */
  private readonly target = el("span", "", "ff-target");
  private readonly targetName = el("b");
  private readonly targetHp = el("i", "", "ff-fill ff-hp");
  private readonly targetTag = el("span", "", "ff-label ff-tag");
  private readonly factories = el("div", "", "ff-factories");
  private readonly portrait = el("div", "", "ff-face");
  private readonly mini = el("canvas", "", "ff-mini");
  private readonly camera = el("i", "", "ff-camera");
  private readonly map = el("div", "", "ff-minimap");
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
    this.meter.append(...this.shares);
    const war = el("div", "", "ff-war");
    war.append(this.scores[0]!, this.meter, this.scores[1]!);
    this.top.append(war, this.clock, this.timer, this.chips);
    const bars = el("div", "", "ff-bars");
    const head = el("div", "", "ff-head");
    this.purse.title = "Gold: last hits, kills, towers, camps and a trickle";
    head.append(this.heroName, this.level, this.purse);
    bars.append(head);
    ["HP", "EN", "XP"].forEach((name, i) => {
      const track = el("span", "", "ff-track");
      track.append(this.bars[i]!);
      bars.append(el("span", name, "ff-label"), track, this.values[i]!);
    });
    // What the hero shoots, under its own bars: name, hit points, and FOCUS or AUTO.
    const targetHp = el("span", "", "ff-track");
    targetHp.append(this.targetHp);
    const aim = el("span", "TARGET", "ff-label");
    this.target.append(aim, this.targetName, targetHp, this.targetTag);
    bars.append(this.target);
    const spells = el("div", "", "ff-spells");
    this.spells.forEach(({ button, icon, shade, secs, tag, tip }, slot) => {
      tip.setAttribute("role", "tooltip");
      const key = el("kbd", this.state.spells[slot]!.key);
      button.append(icon, shade, secs, key, tag);
      // The tooltip sits beside the button, not in it, so it shows over a disabled (cooling) one too.
      const bay = el("span", "", "ff-spell-bay");
      bay.append(button, tip);
      button.onclick = () => this.actions.cast(slot);
      spells.append(bay);
    });
    const stance = el("div", "", "ff-stance");
    this.amove.title = "Attack-move: click the map (A)";
    this.amove.onclick = () => this.actions.attackMove();
    this.queueButton.title =
      "Queue: orders go behind the hero's route (or hold Shift)";
    this.queueButton.onclick = () => {
      this.queueOn = !this.queueOn;
      this.flag(this.queueButton, "ff-lit", this.queueOn);
    };
    const toggles = el("div", "", "ff-toggles");
    toggles.append(this.amove, this.queueButton);
    stance.append(toggles, this.factories);
    const map = this.map;
    map.append(this.mini, this.camera);
    // A left click looks there; a right click sends the hero there.
    map.onpointerdown = (event) => {
      const box = this.mini.getBoundingClientRect();
      if (!box.width) return;
      const fx = (event.clientX - box.left) / box.width,
        fy = (event.clientY - box.top) / box.height;
      if (event.button === 2)
        this.actions.move(fx, fy, event.shiftKey || this.queueOn);
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
    const team = seat < 0 ? 0 : seat % 2;
    this.put(this.portrait, "hero", team + s.kind, () => {
      this.portrait.replaceChildren(heroPortrait(s.kind, team));
      this.portrait.className = `ff-face ff-t${team}`;
    });
    const total = s.red + s.neutral + s.blue || 1;
    [s.red, s.neutral, s.blue].forEach((n, i) =>
      this.css(this.shares[i]!, "flex-grow", String(n / total)),
    );
    this.text(this.scores[0]!, `RED ${s.red}`);
    this.text(this.scores[1]!, `${s.blue} BLUE`);
    const build = `×${(s.clock / 100).toFixed(2)}`;
    this.text(this.clock, `${s.neutral} neutral · build ${build}`);
    this.text(this.timer, s.time);
    const levels = world.heroes.map((h) => `${h.seat}${h.kind}${h.level}`);
    this.put(this.chips, "slots", JSON.stringify([slots, levels]), () =>
      this.chips.replaceChildren(
        ...slots.map((slot) => {
          const name = slot.self
            ? "You"
            : slot.bot
              ? `AI ${slot.difficulty}`
              : slot.name;
          const hero = world.heroes.find((h) => h.seat === slot.slot);
          const label = hero ? `${name} · ${hero.kind} ${hero.level}` : name;
          const own = slot.self ? " ff-own" : "";
          return el("span", label, `ff-chip ff-t${slot.team}${own}`);
        }),
      ),
    );
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    [s.hp, s.energy, s.xp].forEach((v, i) =>
      this.css(this.bars[i]!, "width", pct(v)),
    );
    const values = [s.hpNow.toLocaleString("en"), String(s.energyNow)];
    values.push(s.level >= MAX_LEVEL ? "MAX" : `LV ${s.level + 1}`);
    values.forEach((v, i) => this.text(this.values[i]!, v));
    this.text(this.heroName, s.kind.toUpperCase());
    const role = `${HERO_ROLES[s.kind]} · level ${s.level}`;
    this.text(this.level, s.respawn ? `RESPAWN ${s.respawn}s` : role);
    this.text(this.purse, `◆ ${s.gold.toLocaleString("en")}`);
    const kit = SPELL_INFO[s.kind];
    s.spells.forEach((spell, i) => {
      const { button, icon, shade, secs, tag, tip } = this.spells[i]!;
      // The kit's icon and name, redrawn only when the hero changes.
      this.put(icon, "effect", spell.effect + spell.name, () => {
        icon.replaceChildren(spellIcon(KITS[s.kind][i]!.effect));
        const t = spellTooltip(kit[i]!);
        const title = el("span", "", "ff-tip-head");
        title.append(el("b", `${spell.key} · ${t.name}`), el("small", t.aim));
        tip.replaceChildren(title, el("span", t.desc), el("small", t.stats));
        button.setAttribute(
          "aria-label",
          `${spell.name} (${spell.key}): ${t.desc}`,
        );
      });
      this.css(shade, "height", pct(spell.locked ? 1 : spell.shade));
      this.text(secs, spell.locked ? "" : String(spell.seconds || ""));
      this.text(
        tag,
        spell.locked ? `LV ${kit[i]!.unlock}` : spell.passive ? "PASSIVE" : "",
      );
      this.flag(button, "ff-gold", spell.ultimate);
      this.flag(button, "ff-ready", spell.ready);
      // With QUEUE on, a cooling spell can still be queued: it waits its turn behind the route.
      button.disabled = !spell.ready && !(this.queueOn && !spell.locked);
    });
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

  /** Whether the QUEUE toggle is on: orders queue as with Shift held. */
  get queueing(): boolean {
    return this.queueOn;
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
          // v3 dropped factory orders (the waves are the army): the panel only shows what it builds until M6.
          button.disabled = true;
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
