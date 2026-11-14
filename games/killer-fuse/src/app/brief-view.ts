import { elementsFor } from "fuse-ui";
import type { VictoryKind } from "../engine/index.js";
import { paint, type Icon } from "./art.js";
import { cardKey, type CountdownCard } from "./briefing.js";

/**
 * The countdown card's DOM. It is built once and then only written to, and the body — the win pictures, the role
 * line and the controls — is rebuilt only when `cardKey` changes, which the title's 3, 2, 1 deliberately does not.
 * Everything the card will show is there on the first write: nothing arrives late, nothing is removed and put back,
 * and the card holds no timer of its own, so what a player starts reading stays where they are reading it.
 */
export interface BriefCardView {
  readonly element: HTMLElement;
  /** Shows `card`, painting its pictures from `icons`; `artKey` changes when the art sheets arrive. */
  show(
    card: CountdownCard,
    icons: Partial<Record<VictoryKind, Icon>>,
    artKey: string,
  ): void;
  hide(): void;
}

export function createBriefCardView(doc: Document = document): BriefCardView {
  const el = elementsFor(doc),
    element = el("aside", "", "kf-brief"),
    title = el("strong", "", "kf-brief-title"),
    sub = el("p", "", "kf-brief-sub"),
    wins = el("ul", "", "kf-brief-wins"),
    role = el("p", "", "kf-brief-role"),
    controls = el("div", "", "kf-brief-controls");
  element.append(title, sub, wins, role, controls);
  element.setAttribute("role", "status");
  element.hidden = true;
  /** One action's caps: a row of key tops of one kind. */
  const caps = (labels: readonly string[], kind: string): HTMLElement => {
    const cell = el("span", "", `kf-caps kf-caps-${kind}`);
    cell.append(...labels.map((label) => el("kbd", label)));
    return cell;
  };
  return {
    element,
    hide() {
      element.hidden = true;
    },
    show(card, icons, artKey) {
      element.hidden = false;
      // The title alone changes every second; writing it costs nothing and touches nothing else on the card.
      title.textContent = card.title;
      title.hidden = card.title === "";
      const key = cardKey(card) + artKey;
      if (element.dataset.key === key) return;
      element.dataset.key = key;
      element.dataset.team = card.team === undefined ? "" : String(card.team);
      element.dataset.first = String(card.first);
      sub.textContent = card.subtitle;
      wins.replaceChildren(
        ...card.wins.map((win) => {
          const item = el("li", "", "kf-brief-win"),
            picture = el("i", "", "kf-brief-icon");
          picture.setAttribute("aria-hidden", "true");
          paint(picture, icons[win.kind]);
          item.dataset.kind = win.kind;
          item.append(picture, el("span", win.caption));
          return item;
        }),
      );
      wins.hidden = card.wins.length === 0;
      role.textContent = card.role;
      role.hidden = card.role === "";
      // One row per action: its name, the caps (keyboard and gamepad, or the touch buttons) and, on its own line
      // under them, a short note. A note on its own line never squeezes into a column a word wide.
      controls.dataset.device = card.device;
      controls.replaceChildren(
        ...card.controls.map((row) => {
          const line = el("div", "", "kf-control");
          line.dataset.mine = String(row.mine);
          line.append(
            el("strong", row.action, "kf-control-name"),
            // The gamepad's caps alone once a pad is what this device plays with; otherwise both, keyboard first.
            ...(card.device === "touch"
              ? [caps(row.touch, "touch")]
              : card.device === "pad"
                ? [caps(row.pad, "pad")]
                : [caps(row.keys, "keys"), caps(row.pad, "pad")]),
            ...(row.note ? [el("span", row.note, "kf-control-note")] : []),
          );
          return line;
        }),
      );
      controls.hidden = card.controls.length === 0;
    },
  };
}
