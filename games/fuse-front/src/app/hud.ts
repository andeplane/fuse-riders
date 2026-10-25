/**
 * The HUD in the 3D robot style: dark glass panels, a portrait rendered from the hero's 3D model (`look.ts`), stroke
 * spell icons, bars with their numbers. Text, bars and buttons are DOM (readable, clickable and tappable); every write
 * goes through `put`, which skips a value already written, so a steady frame touches nothing and nothing reads layout.
 */
import { el } from "fuse-ui";
import { ITEMS, KITS, MAX_LEVEL, SPELL_INFO } from "../engine/index.js";
import type { WorldView } from "../engine/index.js";
import { campTip, minimapBase, paintMinimap } from "../render/minimap.js";
import { Img } from "../render/pixel/image.js";
import { HERO_ROLES, heroPortrait, spellIcon } from "./look.js";
import { createHud, deriveHud, upgradesOf } from "./hud-state.js";
import type { SlotView } from "./model.js";
import { minimapTile, type Ping } from "./radar.js";
import { spellTooltip, targetPanel } from "./targeting.js";
import { ShopPanel } from "./shop-panel.js";
import { ITEM_KEYS, itemStats, shopOf, slotsOf } from "./shop-state.js";

export interface HudActions {
  /** Casts or aims a slot; `queued` (Shift) puts the cast behind the hero's route. */
  cast(slot: number, queued?: boolean): void;
  /** Arms an attack-move: the next click on the map sends the hero there, fighting on the way. */
  attackMove(): void;
  /** Centres the camera on fractions of the map. */
  look(fx: number, fy: number): void;
  /** Sends the hero to fractions of the map (a right click on the minimap; with Shift, queued). */
  move(fx: number, fy: number, queued?: boolean): void;
  /** Uses (or, for a BLINK, aims) the item in `slot`. */
  useItem(slot: number): void;
  /** Buys shop item `id`, and sells the item in `slot`, at the hero's fort (`shop.ts`). */
  buy(id: number): void;
  sell(slot: number): void;
}

/** Pings on the minimap at once at most; a new one past this replaces the oldest. */
const MAX_PINGS = 4;

/** Copies `img` into a canvas of its size. */
function draw(canvas: HTMLCanvasElement, img: Img): void {
  const ctx = canvas.getContext("2d");
  const data = ctx?.createImageData(img.w, img.h);
  if (ctx && data) ctx.putImageData((data.data.set(img.d), data), 0, 0);
}

/** Appends `child` to `box`, first dropping the oldest of its `className` children past `most`. */
function cap(box: HTMLElement, child: HTMLElement, most: number): void {
  const old = box.querySelectorAll(`.${child.classList[0]}`);
  if (old.length >= most) old[0]!.remove();
  child.onanimationend = () => child.remove();
  box.append(child);
}

export class Hud {
  readonly top = el("div", "", "ff-bar");
  readonly bottom = el("div", "", "ff-panel");
  /** The held jungle factories' wave upgrades, as badges in the top bar. */
  private readonly upgrades = el("div", "", "ff-upgrades");
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
  /** The item bar (keys 1–6) and the shop (B), v3 M3. */
  private readonly items = [0, 1, 2, 3, 4, 5].map(() => ({
    button: el("button", "", "ff-item"),
    mark: el("span", "", "ff-mark"),
    shade: el("i", "", "ff-shade"),
    secs: el("span", "", "ff-secs"),
    tip: el("span", "", "ff-tip ff-frame"),
  }));
  private readonly shopButton = el("button", "B shop", "ff-shop-open");
  readonly shop: ShopPanel;
  /** A toggle for touch: while lit, every order queues as if Shift were held. */
  private readonly queueButton = el("button", "⇧ queue", "ff-switch ff-queue");
  private queueOn = false;
  /** What the hero shoots: its name, hit points and whether it was chosen. */
  private readonly target = el("span", "", "ff-target");
  private readonly targetName = el("b");
  private readonly targetHp = el("i", "", "ff-fill ff-hp");
  private readonly targetTag = el("span", "", "ff-label ff-tag");
  private readonly portrait = el("div", "", "ff-face");
  private readonly mini = el("canvas", "", "ff-mini");
  private readonly camera = el("i", "", "ff-camera");
  private readonly map = el("div", "", "ff-minimap");
  private miniBase = new Img(1, 1);
  private miniImg = new Img(1, 1);
  private miniStep = -1;
  private world: WorldView | undefined;
  private seat = -1;
  private box = { x: -1, y: -1, w: 0, h: 0 };

  constructor(readonly actions: HudActions) {
    this.shop = new ShopPanel(actions);
    this.meter.append(...this.shares);
    const war = el("div", "", "ff-war");
    war.append(this.scores[0]!, this.meter, this.scores[1]!);
    this.top.append(war, this.clock, this.timer, this.upgrades, this.chips);
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
    this.amove.title = "Attack-move: click the map (A)";
    this.amove.onclick = () => this.actions.attackMove();
    this.queueButton.title =
      "Queue: orders go behind the hero's route (or hold Shift)";
    this.queueButton.onclick = () => {
      this.queueOn = !this.queueOn;
      this.flag(this.queueButton, "ff-lit", this.queueOn);
    };
    const toggles = el("div", "", "ff-toggles");
    this.shopButton.title = "Shop: buy and sell at your fort (B)";
    this.shopButton.onclick = () => this.toggleShop();
    toggles.append(this.amove, this.queueButton);
    const items = el("div", "", "ff-items");
    this.items.forEach(({ button, mark, shade, secs, tip }, slot) => {
      tip.setAttribute("role", "tooltip");
      button.append(mark, shade, secs, el("kbd", ITEM_KEYS[slot]!));
      button.onclick = () => this.actions.useItem(slot);
      const bay = el("span", "", "ff-spell-bay");
      bay.append(button, tip);
      items.append(bay);
    });
    items.append(this.shopButton);
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
    // Hovering a jungle camp tells whether its guards stand, or when they return.
    map.onpointermove = (event) => {
      const box = this.mini.getBoundingClientRect();
      if (!box.width || !this.world) return;
      const { width, height } = this.world;
      const fx = (event.clientX - box.left) / box.width,
        fy = (event.clientY - box.top) / box.height;
      const tip = campTip(this.world, minimapTile(fx, fy, width, height));
      this.put(map, "title", tip ?? "", () => (map.title = tip ?? ""));
    };
    const kit = el("div", "", "ff-kit");
    kit.append(spells, items);
    const stance = el("div", "", "ff-stance");
    stance.append(toggles);
    this.bottom.append(this.portrait, bars, kit, stance, map);
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
    this.text(this.clock, `${s.neutral} neutral`);
    this.text(this.timer, s.time);
    const ups = upgradesOf(world, seat);
    this.put(this.upgrades, "ups", ups.map((u) => u.tip).join(), () =>
      this.upgrades.replaceChildren(
        ...ups.map((u) => {
          const badge = el("span", u.badge, "ff-upgrade");
          badge.title = u.tip;
          return badge;
        }),
      ),
    );
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
    const aim = targetPanel(world, seat);
    // The panel keeps its place with nothing to shoot, so the HUD does not reflow as targets come and go.
    this.text(this.targetName, aim?.name ?? "NONE");
    this.css(this.targetHp, "width", pct(aim?.hp ?? 0));
    this.text(this.targetTag, aim ? (aim.chosen ? "FOCUS" : "AUTO") : "");
    this.flag(this.target, "ff-focus", !!aim?.chosen);
    this.flag(this.target, "ff-t0", aim?.team === 0);
    this.flag(this.target, "ff-t1", aim?.team === 1);
    this.showItems(world, seat);
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
    paintMinimap(this.miniImg, this.miniBase, world, this.seat);
    draw(this.mini, this.miniImg);
  }

  /**
   * A ring that swells and fades on the minimap at fractions `fx`, `fy`: amber for a flag under fire, red for one
   * lost, white for a tower or gate under fire and a larger red one for the fort.
   */
  ping(fx: number, fy: number, kind: Ping["kind"]): void {
    const dot = el("span", "", `ff-ping ff-ping-${kind}`);
    Object.assign(dot.style, { left: `${fx * 100}%`, top: `${fy * 100}%` });
    cap(this.map, dot, MAX_PINGS);
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

  /** The item bar from the seat's slots, and the shop while it is open. */
  private showItems(world: WorldView, seat: number): void {
    const slots = slotsOf(world, seat);
    slots.forEach((slot, i) => {
      const { button, mark, shade, secs, tip } = this.items[i]!;
      this.put(tip, "item", String(slot.id), () => {
        const item = ITEMS[slot.id];
        if (!item) {
          tip.replaceChildren(
            el("b", `${slot.key} · empty`),
            el("small", "Buy items at your fort (B)"),
          );
          button.setAttribute("aria-label", `Item slot ${slot.key}: empty`);
          return;
        }
        const head = el("span", "", "ff-tip-head");
        head.append(
          el("b", `${slot.key} · ${item.name}`),
          el("small", item.active ? "ACTIVE" : "PASSIVE"),
        );
        tip.replaceChildren(
          head,
          el("span", item.desc),
          el("small", itemStats(item).join(" · ")),
        );
        button.setAttribute(
          "aria-label",
          `${item.name} (${slot.key}): ${item.desc}`,
        );
      });
      this.text(mark, slot.mark);
      this.css(shade, "height", `${Math.round(slot.shade * 100)}%`);
      this.text(secs, slot.seconds ? String(slot.seconds) : "");
      this.flag(button, "ff-empty", slot.id < 0);
      this.flag(button, "ff-ready", slot.ready);
      button.disabled = !slot.ready;
    });
    this.flag(this.shopButton, "ff-lit", this.shop.open);
    if (this.shop.open) this.shop.update(shopOf(world, seat));
  }

  /** Opens the shop, or closes it when open. */
  toggleShop(): void {
    this.shop.toggle();
    if (this.world) this.showItems(this.world, this.seat);
  }

  /** Lights the item button that is aiming a BLINK (-1 for none). */
  aimingItem(slot: number): void {
    this.items.forEach(({ button }, i) =>
      this.flag(button, "ff-aiming", i === slot),
    );
  }
}
