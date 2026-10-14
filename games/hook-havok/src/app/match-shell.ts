import type { WorldView } from "../engine/view.js";
import { keeperColor } from "../render/identity.js";
import "./match-shell.css";

/** Presentation of replicated facts. All actions reuse the room's existing controls. */
export function createMatchShell() {
  const get = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const lounge = document.createElement("details");
  lounge.id = "room-lounge";
  lounge.open = true;
  lounge.innerHTML = `<summary>Room & match <span id="lounge-summary"></span></summary><p id="room-authority" role="status"></p><div class="lounge-content"></div>`;
  document.querySelector("header")!.after(lounge);
  const content = lounge.querySelector(".lounge-content")!;
  content.append(
    get("invitation"),
    get("experiment").closest("section")!,
    get("rules").closest("section")!,
  );
  const workshop = get("tuning").closest("details")!;
  workshop.id = "development-workshop";
  workshop.querySelector("summary")!.textContent =
    "Development workshop · movement & control experiments";
  const controls = get("reset").closest("section")!;
  get("experiment").closest("section")!.append(get("reset"));
  workshop.append(
    get("jump-mode").closest("section")!,
    controls,
    document.querySelector(".room-entry")!,
  );
  const preferences = document.createElement("section");
  preferences.className = "controls personal-controls";
  preferences.setAttribute("aria-label", "Your controls and atmosphere");
  content.append(preferences);
  for (const id of ["keyboard-mode", "touch-toggle", "aim-mode", "atmosphere"])
    preferences.append(get(id).closest("label")!);
  preferences.append(get("control-help"));
  content.append(document.querySelector("[data-radio]")!);
  const hud = document.createElement("section");
  hud.id = "match-hud";
  hud.setAttribute("aria-label", "Match scoreboard");
  hud.innerHTML = `<div class="match-heading"><div><span id="match-map"></span><strong id="match-mode"></strong></div><p id="spectator-state" role="status"></p><button id="show-results" hidden>Results</button><div class="match-clock"><small id="clock-label">FREE PLAY</small><strong id="match-clock">∞</strong></div></div>`;
  hud.append(get("round-status"), get("roster"));
  document.querySelector(".play-surface")!.before(hud);
  const overlay = document.createElement("section");
  overlay.id = "match-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div id="countdown-card" role="status" hidden><span>GET READY</span><strong id="countdown-number"></strong></div><section id="result-card" aria-labelledby="result-title" hidden><p class="result-kicker">THE BELFRY REMEMBERS</p><h2 id="result-title"></h2><div id="winner-portraits" aria-hidden="true"></div><p id="result-detail" role="status"></p><div class="result-actions"><button id="rematch">Play again</button><button id="result-free">Free play</button><button id="dismiss-results">View arena</button></div><p id="rematch-help"></p></section>`;
  document.querySelector(".stage")!.append(overlay);
  get("rematch").onclick = () => {
    get<HTMLButtonElement>("restart-room").click();
    get("scene").focus({ preventScroll: true });
  };
  get("result-free").onclick = () => {
    get<HTMLSelectElement>("rules").value = "free";
    get<HTMLFormElement>("tuning").requestSubmit();
  };
  let dismissed = false;
  get("dismiss-results").onclick = () => {
    dismissed = true;
    overlay.hidden = true;
    get("show-results").hidden = false;
    get("show-results").focus();
  };
  get("show-results").onclick = () => {
    dismissed = false;
    overlay.hidden = false;
    get("dismiss-results").focus();
  };
  let previous = "",
    lastRound = -1;
  return {
    reset() {
      overlay.hidden = true;
      get("show-results").hidden = true;
      previous = "";
      lastRound = -1;
      dismissed = false;
    },
    update(
      view: WorldView,
      selfId: string,
      manager: boolean,
      display: boolean,
      round: number,
      code: string,
    ) {
      const c = view.contest;
      if (round !== lastRound || c.phase !== "over") dismissed = false;
      lastRound = round;
      const facts = JSON.stringify([
        c.phase,
        c.rules,
        c.seconds,
        c.entries,
        c.winners,
        view.map,
        view.keepers.map((k) => [k.id, k.name, k.slot, k.connected, k.playing]),
        selfId,
        manager,
        display,
        round,
        code,
      ]);
      if (facts === previous) return;
      previous = facts;
      const local = view.keepers.find((k) => k.id === selfId);
      const name = (id: string) => {
        const entry = c.entries.find((e) => e.id === id);
        return `P${(entry?.slot ?? 0) + 1} ${view.keepers.find((k) => k.id === id)?.name ?? "Keeper"}`;
      };
      get("lounge-summary").textContent =
        `${code} · ${view.keepers.filter((k) => k.connected).length}/5 keepers`;
      get("room-authority").textContent = display
        ? "Shared display · invite friends from a player device."
        : manager
          ? "You manage this room. Explore now; choose a round mode to compete. Match choices restart the shared trial."
          : "The room manager chooses the arena and starts the next round. You can explore during free play.";
      get("match-map").textContent =
        view.map === "crossroads" ? "THE CROSSROADS" : "LANTERN BELFRY";
      get("match-mode").textContent =
        c.rules === "free"
          ? "Free play"
          : c.rules === "score"
            ? "Hook score"
            : "Last keeper standing";
      get("clock-label").textContent =
        c.rules === "free"
          ? "EXPLORE"
          : c.phase === "over"
            ? "FINISHED"
            : c.phase === "waiting"
              ? "WAITING"
              : c.phase === "countdown"
                ? "STARTS IN"
                : "TIME LEFT";
      get("match-clock").textContent =
        c.rules === "free"
          ? "∞"
          : c.phase === "waiting"
            ? "—"
            : `${Math.floor(c.seconds / 60)}:${String(c.seconds % 60).padStart(2, "0")}`;
      get("spectator-state").textContent = display
        ? "SHARED DISPLAY"
        : !local?.connected
          ? "Joining keepers…"
          : c.phase === "waiting"
            ? "Invite a second keeper to begin"
            : c.rules !== "free" && c.phase === "active" && !local.playing
              ? "WATCHING · back next round"
              : `P${local.slot + 1} · ${local.name}`;
      const countdown = c.rules !== "free" && c.phase === "countdown";
      const over = c.rules !== "free" && c.phase === "over";
      overlay.hidden = !countdown && (!over || dismissed);
      overlay.dataset.phase = c.phase;
      get("countdown-card").hidden = !countdown;
      get("countdown-number").textContent = String(c.seconds);
      get("result-card").hidden = !over;
      get("show-results").hidden = !over;
      get<HTMLButtonElement>("rematch").disabled = !manager;
      get<HTMLButtonElement>("result-free").disabled = !manager;
      get("rematch-help").textContent = manager
        ? "Same keepers. Another chance."
        : "Waiting for the room manager to start the next round.";
      if (over) {
        get("result-title").textContent =
          c.winners.length === 0
            ? "No keeper left standing"
            : c.winners.length > 1
              ? "A shared victory"
              : "A keeper stands tall";
        get("result-detail").textContent = c.winners.length
          ? c.winners.map(name).join(" & ")
          : "The round ends in a draw.";
        get("winner-portraits").replaceChildren(
          ...c.winners.map((id) => {
            const p = document.createElement("span");
            p.className = "keeper-portrait";
            p.style.setProperty(
              "--keeper-color",
              keeperColor(c.entries.find((e) => e.id === id)?.slot ?? 0),
            );
            return p;
          }),
        );
      }
    },
  };
}
