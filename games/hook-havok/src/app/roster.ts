import type { WorldView } from "../engine/view.js";
import { keeperColor } from "../render/identity.js";

/** Rebuild only when displayed facts change, not on every simulation frame. Names are text, never HTML. */
export function createRoster(host: HTMLElement) {
  let previous = "";
  /** Bomb cooldown rings update in place every frame without a rebuild. */
  const rings = new Map<string, HTMLElement>();
  const paintRings = (view: WorldView) => {
    for (const k of view.keepers) {
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
          (bombs && k?.tally.knockouts ? ` · ${k.tally.knockouts} KO` : "") +
          (k?.ward ? ` · Ward ${k.ward}s` : ""),
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
        card.append(portrait, badge, name, detail, ring);
        return card;
      }),
    );
    paintRings(view);
  };
}
