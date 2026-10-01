import "../src/app/neural-defence.css";
import { createMatch, loadMap, step } from "../src/engine/index.js";
import { aiCommands } from "../src/engine/ai.js";
import {
  reportMarkup,
  reportPlayers,
  clock,
  type ReportMetric,
} from "../src/app/match-report.js";
import crossing from "../maps/cortex-crossing.json";
import close from "../maps/close-quarters.json";

const params = new URLSearchParams(location.search);
const map = loadMap(params.get("map") === "close" ? close : crossing);
const strategies = (params.get("s") ?? "swarm,pressure,economy").split(
  ",",
) as never[];
const roster = strategies.map((_, i) => ({ id: `p${i}`, slot: i }));
let w = createMatch(map, { matchId: "lab", powerups: true }, roster);
while (!w.finished && w.tick < 20 * 900)
  w = step(
    w,
    roster.flatMap((p, i) => aiCommands(w, p.id, strategies[i])),
  );
let metric: ReportMetric = "territory";
const el = document.querySelector<HTMLElement>("#match-result")!;
const players = reportPlayers(w, "p0");
function render() {
  el.innerHTML = `<strong>${w.winnerId === "p0" ? "Victory" : "Defeat"}</strong><p>${w.victory}</p><small>${clock(w.tick)} elapsed</small>${reportMarkup(w, players, "p0", metric)}`;
}
el.addEventListener("click", (e) => {
  const m = (e.target as HTMLElement).closest<HTMLElement>("[data-metric]")
    ?.dataset.metric;
  if (m) {
    metric = m as ReportMetric;
    render();
  }
});
render();
