import type { PowerKind, WorldView } from "../engine/view.js";
import { keeperColor } from "../render/identity.js";
import { POWER_STYLE } from "../render/power-ups.js";

/** Card icons: fixed markup, never built from room data. */
const ICONS: Record<PowerKind, string> = {
  triple: '<path d="M6 10l6-5 6 5M6 15l6-5 6 5M6 20l6-5 6 5"/>',
  shield: '<path d="M5 4h14l-1.5 9L12 20l-5.5-7z"/>',
  cluster:
    '<circle cx="12" cy="14" r="5" fill="currentColor"/><circle cx="5" cy="7" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="19" cy="7" r="2"/>',
  harpoon: '<path d="M3 12h18M3 12l5-5M3 12l5 5M21 12l-3-3M21 12l-3 3"/>',
  dash: '<path d="M13 5l7 7-7 7M3 8h7M2 12h9M3 16h7"/>',
};
/** Rebuild only when displayed facts change, not on every simulation frame. Names are text, never HTML. */
export function createRoster(host: HTMLElement) {
  let previous = "";
  /** Bomb cooldown rings and power chips update in place every frame without a rebuild. */
  const rings = new Map<string, HTMLElement>(),
    chips = new Map<string, HTMLElement>();
  const paintChip = (chip: HTMLElement, k: WorldView["keepers"][number]) => {
    const p = k.power,
      kind = p.kind && k.playing && k.connected ? p.kind : "";
    if (chip.dataset.power !== kind) {
      chip.dataset.power = kind;
      chip.hidden = !kind;
      chip.innerHTML = kind
        ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind]}</svg><i></i>`
        : "";
      chip.style.setProperty(
        "--power-color",
        kind ? POWER_STYLE[kind].css : "",
      );
    }
    if (!kind) return;
    const left = String(Math.ceil(p.left * 48) / 48),
      title = `${POWER_STYLE[kind].name} · ${kind === "cluster" ? `${p.charges} throws left` : `${p.seconds} s left`}`;
    if (chip.dataset.left !== left) {
      chip.dataset.left = left;
      chip.style.setProperty("--power-left", left);
    }
    if (chip.title !== title) {
      chip.title = title;
      chip.setAttribute("aria-label", title);
    }
  };
  const paintRings = (view: WorldView) => {
    for (const k of view.keepers) {
      const chip = chips.get(k.id);
      if (chip) paintChip(chip, k);
      const ring = rings.get(k.id);
      if (!ring) continue;
      const cooldown = String(Math.ceil(k.cooldown * 24) / 24),
        state =
          view.bombMode === "off"
            ? "off"
            : k.body.charge > 0
              ? "charging"
              : k.cooldown > 0
                ? "cooling"
                : "ready";
      if (ring.dataset.cooldown !== cooldown) {
        ring.dataset.cooldown = cooldown;
        ring.style.setProperty("--cooldown", cooldown);
      }
      if (ring.dataset.state !== state) {
        ring.dataset.state = state;
        ring.hidden = state === "off";
        ring.title =
          state === "cooling"
            ? "Bomb recharging"
            : "Bomb ready: hold to charge";
      }
    }
  };
  return (view: WorldView, selfId: string) => {
    const c = view.contest;
    const entries =
      c.rules !== "free" && c.entries.length ? c.entries : view.keepers;
    const bombs = view.bombMode !== "off";
    const rows = entries.map((entry) => {
      const k = view.keepers.find((k) => k.id === entry.id);
      const entrant = c.entries.find((e) => e.id === entry.id);
      const winner = c.phase === "over" && c.winners.includes(entry.id);
      return {
        id: entry.id,
        slot: entry.slot,
        name: k?.name ?? "Keeper",
        you: entry.id === selfId,
        winner,
        status: entrant?.out
          ? "OUT"
          : !k?.connected
            ? "AWAY"
            : winner
              ? "WINNER"
              : c.rules === "elimination" && entrant
                ? "IN"
                : "",
        detail:
          (c.rules === "score" && entrant
            ? `${entrant.score} pts`
            : `${k?.hits ?? 0} hits · ${k?.body.deaths ?? 0} returns`) +
          (bombs && k?.tally.knockouts ? ` · ${k.tally.knockouts} KO` : ""),
      };
    });
    // Late joiners remain visible as watchers rather than disappearing from the room UI.
    for (const k of view.keepers)
      if (!rows.some((r) => r.id === k.id))
        rows.push({
          id: k.id,
          slot: k.slot,
          name: k.name,
          you: k.id === selfId,
          winner: false,
          status: k.connected ? "WATCHING" : "AWAY",
          detail: "Next round",
        });
    const signature = JSON.stringify(rows);
    if (signature === previous) {
      paintRings(view);
      return;
    }
    previous = signature;
    rings.clear();
    chips.clear();
    host.replaceChildren(
      ...rows.map((row) => {
        const card = document.createElement("div");
        card.className = "keeper-card";
        card.setAttribute("role", "listitem");
        card.dataset.slot = String(row.slot);
        card.dataset.state = row.status;
        card.style.setProperty("--keeper-color", keeperColor(row.slot));
        const badge = document.createElement("strong");
        badge.className = "keeper-badge";
        badge.textContent = `P${row.slot + 1}`;
        const portrait = document.createElement("span");
        portrait.className = "keeper-portrait";
        portrait.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.className = "keeper-name";
        name.textContent = `${row.name}${row.you ? " · YOU" : ""}`;
        name.title = name.textContent;
        const detail = document.createElement("small");
        detail.textContent = [row.detail, row.status]
          .filter(Boolean)
          .join(" · ");
        const ring = document.createElement("span");
        ring.className = "bomb-ring";
        ring.setAttribute("aria-hidden", "true");
        rings.set(row.id, ring);
        const chip = document.createElement("span");
        chip.className = "power-chip";
        chip.setAttribute("role", "img");
        chip.hidden = true;
        chips.set(row.id, chip);
        card.append(portrait, badge, name, detail, ring, chip);
        return card;
      }),
    );
    paintRings(view);
  };
}
