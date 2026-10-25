/**
 * The shop panel (v3 M3), opened with B or the HUD's SHOP button: the items by category, each with its stats, cost
 * and a BUY button, and the hero's six slots with a SELL button each. Buying and selling work only in the hero's own
 * fort's courtyard, so away from it the panel still browses but its buttons rest. The cards are built once; a frame
 * only flips what changed (gold, the buttons' state), so a click never lands on a rebuilt button.
 */
import { el } from "fuse-ui";
import { ITEM_CATEGORIES, type ItemCategory } from "../engine/index.js";
import type { ShopState } from "./shop-state.js";

export interface ShopActions {
  buy(id: number): void;
  sell(slot: number): void;
}

const TAB_NAMES: Readonly<Record<ItemCategory, string>> = {
  weapons: "WEAPONS",
  armour: "ARMOUR",
  systems: "SYSTEMS",
  special: "SPECIAL",
};

export class ShopPanel {
  readonly element = el("div", "", "ff-shop ff-frame");
  private readonly gold = el("b", "", "ff-purse");
  private readonly note = el("span", "", "ff-note");
  private readonly tabs = ITEM_CATEGORIES.map((category) =>
    el("button", TAB_NAMES[category], "ff-switch ff-tab"),
  );
  private readonly grid = el("div", "", "ff-wares");
  private readonly sells = el("div", "", "ff-sells");
  private tab: ItemCategory = "weapons";
  private built = "";
  private readonly last = new WeakMap<HTMLElement, string>();

  constructor(private readonly actions: ShopActions) {
    this.element.hidden = true;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", "Shop");
    const head = el("div", "", "ff-shop-head");
    const close = el("button", "✕", "ff-close");
    close.title = "Close (B or Esc)";
    close.onclick = () => this.close();
    head.append(el("h3", "SHOP"), this.gold, this.note, close);
    const tabs = el("div", "", "ff-tabs");
    this.tabs.forEach((button, i) => {
      button.onclick = () => {
        this.tab = ITEM_CATEGORIES[i]!;
        this.built = "";
      };
      tabs.append(button);
    });
    this.element.append(
      head,
      tabs,
      this.grid,
      el("small", "SELL · half the cost back", "ff-label"),
      this.sells,
    );
  }

  get open(): boolean {
    return !this.element.hidden;
  }
  toggle(): void {
    this.element.hidden = !this.element.hidden;
  }
  close(): void {
    this.element.hidden = true;
  }

  private set(
    target: HTMLElement,
    key: string,
    value: string,
    apply: () => void,
  ) {
    const id = `${key}=${value}`;
    if (this.last.get(target) === id) return;
    this.last.set(target, id);
    apply();
  }

  /** Shows `state`; called every frame, it writes only what changed and nothing while closed. */
  update(state: ShopState): void {
    if (!this.open) return;
    this.set(this.gold, "text", String(state.gold), () => {
      this.gold.textContent = `◆ ${state.gold.toLocaleString("en")}`;
    });
    const note = !state.atFort
      ? "Return to your fort to buy and sell"
      : state.full
        ? "Every slot is full: sell to make room"
        : "At your fort";
    this.set(this.note, "text", note, () => (this.note.textContent = note));
    this.tabs.forEach((button, i) =>
      button.classList.toggle("ff-lit", ITEM_CATEGORIES[i] === this.tab),
    );
    const wares = state.tabs.find((t) => t.category === this.tab)!.items;
    if (this.built !== this.tab) {
      this.built = this.tab;
      this.grid.replaceChildren(
        ...wares.map(({ id, item, stats }) => {
          const card = el("div", "", "ff-ware");
          const buy = el("button", "", "ff-choice ff-buy");
          buy.dataset.item = String(id);
          buy.onclick = () => this.actions.buy(id);
          const tags = el("span", "", "ff-tags");
          tags.append(...stats.map((tag) => el("i", tag)));
          card.append(el("b", item.name), el("small", item.desc), tags, buy);
          return card;
        }),
      );
    }
    for (const button of this.grid.querySelectorAll<HTMLButtonElement>(
      ".ff-buy",
    )) {
      const ware = wares.find((w) => String(w.id) === button.dataset.item)!;
      const label =
        ware.short > 0
          ? `◆ ${ware.item.cost} · need ${ware.short}`
          : `BUY ◆ ${ware.item.cost}`;
      this.set(button, "text", label, () => (button.textContent = label));
      button.disabled = !ware.buyable;
    }
    const slots = state.slots.map((s) => `${s.id}:${s.sellable}`).join();
    this.set(this.sells, "slots", slots, () =>
      this.sells.replaceChildren(
        ...state.slots.map((slot) => {
          const button = el(
            "button",
            slot.id < 0
              ? `${slot.key} · empty`
              : `${slot.key} · ${slot.name} · +${slot.refund}`,
            "ff-switch ff-sell",
          );
          button.disabled = !slot.sellable;
          button.title =
            slot.id < 0
              ? "An empty slot"
              : `Sell ${slot.name} for ${slot.refund}`;
          button.onclick = () => this.actions.sell(slot.slot);
          return button;
        }),
      ),
    );
  }
}
