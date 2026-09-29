import type { WorldView } from "../engine/view.js";
import { keeperColor } from "../render/identity.js";

const SHOW_MS = 4500,
  MAX_ROWS = 4;
/**
 * A short feed naming both keepers of each bomb knockout, and hazard knockouts
 * with the rival credited for the push. Presentation of
 * replicated events only: rows are text, never HTML, and the feed keeps its
 * own bounded, time-limited history.
 */
export function createKnockoutFeed(
  parent: HTMLElement,
  now: () => number = () => performance.now(),
) {
  const list = document.createElement("ol");
  list.id = "knockout-feed";
  list.setAttribute("aria-live", "polite");
  list.setAttribute("aria-label", "Knockouts");
  parent.append(list);
  const seen = new Set<string>();
  let round = -1;
  const rows: { el: HTMLLIElement; at: number }[] = [];
  const tag = (view: WorldView, id: string) => {
    const k = view.keepers.find((k) => k.id === id);
    const span = document.createElement("span");
    span.className = "feed-keeper";
    span.style.setProperty("--keeper-color", keeperColor(k?.slot ?? 0));
    span.textContent = `P${(k?.slot ?? 0) + 1} ${k?.name ?? "Keeper"}`;
    return span;
  };
  return {
    update(view: WorldView, currentRound: number) {
      const time = now();
      if (currentRound !== round) {
        round = currentRound;
        seen.clear();
        rows.splice(0).forEach((r) => r.el.remove());
        // Events already in the state when a round is first seen are history.
        for (const e of view.knockouts) seen.add(`${e.tick}:${e.target}`);
      }
      for (const e of view.knockouts) {
        const key = `${e.tick}:${e.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const li = document.createElement("li");
        const verb = document.createElement("span");
        verb.className = "feed-verb";
        if (e.cause === "hazard") {
          // A hazard: "P2 Blue ⚡ zapped", or credited: "P1 Amber ⚡ P2 Blue".
          if (e.by) li.append(tag(view, e.by));
          else li.append(tag(view, e.target));
          verb.textContent = e.by ? " ⚡ " : " ⚡ zapped";
          li.append(verb);
          if (e.by) li.append(tag(view, e.target));
          li.title = e.by
            ? "Pushed into a hazard after a hook hit"
            : "Knocked out by a hazard";
        } else {
          const self = e.by === e.target;
          li.append(tag(view, e.by));
          verb.textContent = self ? " ✹ own bomb" : " ✹ ";
          li.append(verb);
          if (!self) li.append(tag(view, e.target));
          li.title = self
            ? "Knocked out by their own bomb"
            : "Knocked out by a bomb";
        }
        list.prepend(li);
        rows.unshift({ el: li, at: time });
      }
      while (
        rows.length > MAX_ROWS ||
        (rows.length && time - rows.at(-1)!.at > SHOW_MS)
      )
        rows.pop()!.el.remove();
      if (seen.size > 64)
        for (const key of [...seen].slice(0, seen.size - 32)) seen.delete(key);
      list.hidden = !rows.length;
    },
    reset() {
      round = -1;
      seen.clear();
      rows.splice(0).forEach((r) => r.el.remove());
      list.hidden = true;
    },
  };
}
