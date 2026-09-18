import type { MatchPlayerStats } from "../shared/match-stats.js";
import type { Moment } from "../shared/moments.js";
import {
  COMPARISON_COLUMNS,
  COMPARISON_KEY,
  HIGHLIGHTS_TITLE,
  RECAP_EMPTY_MESSAGE,
  buildMatchRecap,
} from "../shared/match-recap.js";

/** Presentation only: placements, points, awards and moments come from the recorded match. */
export function renderMatchRecap(
  stats: ReadonlyArray<MatchPlayerStats>,
  moments: ReadonlyArray<Moment>,
  options: {
    playerId: string;
    canWatch(key: string): boolean;
    watch(key: string): void;
    /** Replaces "MATCH COMPLETE", e.g. when and where a past match was played. */
    kicker?: string;
    /** Open with the full stats showing, for a view that has no toggle of its own. */
    expanded?: boolean;
  },
  document: Document = window.document,
): HTMLElement {
  function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
    className = "",
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }

  const recap = buildMatchRecap(stats, moments);
  const root = node("section", "", "match-recap-report");
  const heading = node("header", "", "recap-masthead");
  const context = node("div", "", "recap-context");
  const rounds = Math.max(0, ...stats.map((entry) => entry.roundsPlayed));
  context.append(
    node("span", options.kicker ?? "MATCH COMPLETE"),
    node(
      "small",
      `${rounds} ${rounds === 1 ? "round" : "rounds"} / ${stats.length} ${stats.length === 1 ? "rider" : "riders"}`,
    ),
  );
  heading.append(node("strong", "FUSE RIDERS", "recap-brand"), context);
  root.append(heading);
  if (!recap.comparison.length) {
    root.append(node("p", RECAP_EMPTY_MESSAGE, "recap-empty"));
    return root;
  }
  const champions = recap.comparison.filter((entry) => entry.placement === 1);
  const champion = champions[0];
  const hero = node("section", "", "recap-victory");
  hero.style.setProperty(
    "--winner-color",
    champions.length === 1 ? champion!.color : "#ba8cff",
  );
  const crown = node("span", "", "recap-crown");
  crown.setAttribute("aria-hidden", "true");
  hero.append(
    crown,
    node(
      "h2",
      champions.length === 1 ? `${champion!.name} WINS` : "SHARED VICTORY",
    ),
  );
  hero.append(
    node(
      "p",
      champions.length === 1
        ? `${champion!.points} points · ${champion!.wins} round ${champion!.wins === "1" ? "win" : "wins"}`
        : champions.map((entry) => entry.name).join(" + "),
    ),
  );
  root.append(hero);
  const overview = node("div", "", "recap-overview");
  const standings = node("section", "", "recap-standings");
  standings.append(node("h3", "FINAL STANDINGS"));
  const table = node("table");
  table.setAttribute("aria-label", "Final standings");
  const head = node("thead"),
    labels = node("tr");
  for (const label of ["#", "RIDER", "POINTS", "WINS"]) {
    const cell = node("th", label);
    cell.scope = "col";
    labels.append(cell);
  }
  head.append(labels);
  const rows = node("tbody");
  for (const entry of recap.comparison) {
    const row = node(
      "tr",
      "",
      `${entry.placement === 1 ? "is-champion" : ""}${entry.playerId === options.playerId ? " is-you" : ""}`,
    );
    row.style.setProperty("--player-color", entry.color);
    const rider = node("th");
    rider.scope = "row";
    const name = node("span", "", "recap-rider-name");
    const diamond = node("i");
    diamond.setAttribute("aria-hidden", "true");
    name.append(diamond, node("span", entry.name));
    if (
      entry.playerId === options.playerId &&
      entry.name.toUpperCase() !== "YOU"
    )
      name.append(node("small", "YOU"));
    rider.append(name);
    row.append(
      node("td", String(entry.placement).padStart(2, "0")),
      rider,
      node("td", entry.points),
      node("td", entry.wins),
    );
    rows.append(row);
  }
  table.append(head, rows);
  standings.append(table);
  const tiedPoints = recap.comparison.some((entry, index, entries) =>
    entries
      .slice(index + 1)
      .some(
        (other) => other.points === entry.points && other.wins !== entry.wins,
      ),
  );
  if (champions.length > 1 || tiedPoints)
    standings.append(
      node(
        "p",
        champions.length > 1
          ? "Equal points and round wins · shared victory"
          : "Tied on points · decided by round wins",
        "recap-tie-note",
      ),
    );
  const featured = node("aside", "", "recap-featured");
  featured.append(node("h3", "MATCH HIGHLIGHTS"));
  const feature = (
    icon: string,
    title: string,
    winners: ReadonlyArray<{ name: string; color: string }>,
    detail: string,
  ) => {
    const card = node("article", "", "recap-feature");
    const symbol = node("span", icon, "recap-feature-icon");
    symbol.setAttribute("aria-hidden", "true");
    symbol.style.color = winners[0]?.color ?? "#c6a1ff";
    const text = node("div");
    text.append(node("h4", title));
    const names = node("p", "", "recap-feature-names");
    winners.forEach((winner, index) => {
      if (index) names.append(" + ");
      const name = node("span", winner.name);
      name.style.color = winner.color;
      names.append(name);
    });
    text.append(names, node("small", detail));
    card.append(symbol, text);
    featured.append(card);
  };
  const moment = recap.highlights[0];
  if (moment) feature(moment.icon, moment.title, [moment], moment.copy);
  const travel = recap.awards.find((award) => award.id === "trailblazer");
  const award = travel ?? recap.awards[0];
  if (award) feature(award.icon, award.title, award.winners, award.detail);
  if (!moment && !award)
    featured.append(
      node("p", "The standings tell the story this time.", "recap-tie-note"),
    );
  overview.append(standings, featured);
  root.append(overview);
  const details = node("section", "", "recap-details");
  details.id = "match-full-stats";
  details.hidden = !options.expanded;
  details.append(node("h3", "FULL MATCH STATS"));
  const totals = node("div", "", "recap-totals");
  for (const total of recap.totals) {
    const cell = node("div", "", "recap-total");
    cell.append(node("strong", total.value), node("small", total.label));
    totals.append(cell);
  }
  const reel = node("div", "", "recap-highlights");
  reel.append(node("p", HIGHLIGHTS_TITLE, "reel-title"));
  for (const entry of recap.highlights) {
    const card = node("article", "", "award-card highlight-card");
    card.style.setProperty("--player-color", entry.color);
    card.append(
      node("span", entry.icon, "award-icon"),
      node("small", entry.when),
      node("strong", entry.title),
      node("em", entry.copy),
    );
    if (options.canWatch(entry.key)) {
      const watch = node("button", "▶ WATCH", "watch-again");
      watch.type = "button";
      watch.title = "Replay this moment";
      watch.onclick = () => options.watch(entry.key);
      card.append(watch);
    }
    reel.append(card);
  }
  const awards = node("div", "", "recap-awards");
  for (const award of recap.awards) {
    const card = node("article", "", "award-card");
    card.append(
      node("span", award.icon, "award-icon"),
      node("small", award.title),
      node("strong", award.winnerText),
      node("em", award.detail),
    );
    awards.append(card);
  }
  const comparison = node("div", "", "recap-comparison");
  comparison.append(node("p", COMPARISON_KEY, "comparison-key"));
  const columns = node("div", "", "comparison-row comparison-header");
  for (const label of [
    "RIDER",
    ...COMPARISON_COLUMNS.map((column) => column.label),
  ])
    columns.append(node("span", label));
  comparison.append(columns);
  for (const entry of recap.comparison) {
    const row = node(
      "div",
      "",
      `comparison-row${entry.playerId === options.playerId ? " is-you" : ""}`,
    );
    row.style.setProperty("--player-color", entry.color);
    const rider = node("span", "", "comparison-rider"),
      riderCopy = node("span");
    riderCopy.append(
      node("b", entry.riderLabel),
      node("small", entry.riderNote),
    );
    rider.append(node("i"), riderCopy);
    row.append(rider);
    for (const column of COMPARISON_COLUMNS)
      row.append(
        node(
          column.key === "wins" ? "strong" : "span",
          entry[column.key],
          column.key === "pickups"
            ? "pickup-counts"
            : column.key === "deaths"
              ? "death-counts"
              : "",
        ),
      );
    comparison.append(row);
  }
  details.append(totals);
  if (recap.highlights.length) details.append(reel);
  if (recap.awards.length) details.append(awards);
  details.append(comparison);
  root.append(details);
  return root;
}
