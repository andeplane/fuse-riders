import type { KnockoutView, WorldView } from "../engine/view.js";
import { keeperColor } from "../render/identity.js";

export const SHOW_MS = 4500,
  MAX_ROWS = 4;
export interface FeedRow {
  key: string;
  by: string;
  target: string;
  at: number;
}
/**
 * The feed's bounded, time-limited history, newest first. Knockouts already
 * in the state when a round is first seen are history, not news; a new
 * round clears the rows.
 */
export class KnockoutLog {
  rows: FeedRow[] = [];
  private seen = new Set<string>();
  private round = -1;
  /** The rows this update added, oldest first. */
  update(
    knockouts: readonly Pick<KnockoutView, "tick" | "by" | "target">[],
    round: number,
    time: number,
  ): FeedRow[] {
    if (round !== this.round) {
      this.round = round;
      this.seen.clear();
      this.rows = [];
      for (const e of knockouts) this.seen.add(`${e.tick}:${e.target}`);
    }
    const added: FeedRow[] = [];
    for (const e of knockouts) {
      const key = `${e.tick}:${e.target}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const row = { key, by: e.by, target: e.target, at: time };
      added.push(row);
      this.rows.unshift(row);
    }
    while (
      this.rows.length > MAX_ROWS ||
      (this.rows.length && time - this.rows.at(-1)!.at > SHOW_MS)
    )
      this.rows.pop();
    if (this.seen.size > 64)
      for (const key of [...this.seen].slice(0, this.seen.size - 32))
        this.seen.delete(key);
    return added;
  }
  reset(): void {
    this.round = -1;
    this.seen.clear();
    this.rows = [];
  }
}
/**
 * A short feed naming both keepers of each bomb knockout. Presentation of
 * replicated events only: rows are text, never HTML.
 */
export function createKnockoutFeed(
  parent: HTMLElement,
  now: () => number = () => performance.now(),
) {
  const list = document.createElement("ol");
  list.id = "knockout-feed";
  list.setAttribute("aria-live", "polite");
  list.setAttribute("aria-label", "Bomb knockouts");
  parent.append(list);
  const log = new KnockoutLog(),
    shown = new Map<string, HTMLLIElement>();
  let round = -1;
  const tag = (view: WorldView, id: string) => {
    const k = view.keepers.find((k) => k.id === id);
    const span = document.createElement("span");
    span.className = "feed-keeper";
    span.style.setProperty("--keeper-color", keeperColor(k?.slot ?? 0));
    span.textContent = `P${(k?.slot ?? 0) + 1} ${k?.name ?? "Keeper"}`;
    return span;
  };
  const clear = () => {
    for (const li of shown.values()) li.remove();
    shown.clear();
  };
  return {
    update(view: WorldView, currentRound: number) {
      if (currentRound !== round) {
        round = currentRound;
        clear();
      }
      for (const row of log.update(view.knockouts, round, now())) {
        const li = document.createElement("li");
        const self = row.by === row.target;
        li.append(tag(view, row.by));
        const verb = document.createElement("span");
        verb.className = "feed-verb";
        verb.textContent = self ? " ✹ own bomb" : " ✹ ";
        li.append(verb);
        if (!self) li.append(tag(view, row.target));
        li.title = self
          ? "Knocked out by their own bomb"
          : "Knocked out by a bomb";
        list.prepend(li);
        shown.set(row.key, li);
      }
      if (shown.size !== log.rows.length) {
        const keep = new Set(log.rows.map((r) => r.key));
        for (const [key, li] of shown)
          if (!keep.has(key)) {
            li.remove();
            shown.delete(key);
          }
      }
      list.hidden = !shown.size;
    },
    reset() {
      round = -1;
      log.reset();
      clear();
      list.hidden = true;
    },
  };
}
