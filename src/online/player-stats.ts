import {
  careerFor,
  emptyCareer,
  GAME_GROUPS,
  gameGroup,
  mergeCareer,
  type CareerStats,
  type GameGroup,
} from "../shared/career-stats.js";
import { KILL_METHODS, type KillMethod } from "../shared/combat-stats.js";
import {
  newRating,
  type Rating,
  type LeaderboardEntry,
  type Rivalries,
} from "../shared/rating.js";
import { WEAPONS } from "../shared/shot-log.js";
import type { HistoryEntry, UserProfile } from "../service/history.js";
export interface StatsPage {
  profile?: UserProfile;
  matches: HistoryEntry[];
  rivals?: Rivalries;
}
export const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
};
const number = (value: number): string => Math.round(value).toLocaleString();
const percent = (value: number, total: number): string =>
  total ? `${Math.round((100 * value) / total)}%` : "—";
const duration = (ticks: number): string => {
  const seconds = Math.round(ticks / 20);
  return seconds >= 3600
    ? `${(seconds / 3600).toFixed(1)}h`
    : seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${seconds}s`;
};
const LABELS: Record<KillMethod, string> = {
  bomb: "Bomb",
  triple: "Triple bomb",
  five: "Five bomb",
  target: "Target bomb",
  gun: "Gun",
  shell: "Shell",
  trail: "Trail",
  rider: "Rider collision",
  wall: "Wall",
  unknown: "Other / unknown",
};
const date = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const signed = (n: number): string => `${n > 0 ? "+" : ""}${number(n)}`;
function metrics(items: [string, string][], className = ""): HTMLDListElement {
  const list = element("dl", "", `stats-metrics ${className}`);
  for (const [label, value] of items) {
    const cell = element("div");
    cell.append(element("dt", label), element("dd", value));
    list.append(cell);
  }
  return list;
}
function section(title: string, subtitle?: string): HTMLElement {
  const s = element("section", "", "stats-section");
  s.append(element("h3", title));
  if (subtitle) s.append(element("p", subtitle, "stats-muted"));
  return s;
}
function details(title: string): HTMLDetailsElement {
  const d = element("details", "", "stats-details");
  d.append(element("summary", title));
  return d;
}
const svgElement = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs))
    e.setAttribute(key, String(value));
  return e;
};
export function ratingCard(rating: Rating, rank?: number): HTMLElement {
  const card = section(
    "RIDER ELO",
    "Every individual round counts · Only signed-in humans affect Elo",
  );
  card.classList.add("stats-rating");
  const last = rating.points.at(-1),
    head = element("div", "", "rating-heading");
  const current = element("strong", number(rating.value), "rating-value");
  current.dataset.testid = "elo-value";
  head.append(
    current,
    element(
      "span",
      rank ? `#${number(rank)} GLOBAL` : "UNRANKED",
      "rating-rank",
    ),
  );
  if (last)
    head.append(
      element(
        "span",
        `${signed(Math.round(last.after) - Math.round(last.before))} ${last.round === undefined ? "earlier full game" : "last round"}`,
        "rating-delta",
      ),
    );
  card.append(
    head,
    element(
      "p",
      `${rating.games < 10 ? "Provisional · " : ""}${number(rating.rounds ?? 0)} rounds recorded${rating.games > (rating.rounds ?? 0) ? ` · ${number(rating.games - (rating.rounds ?? 0))} earlier full-game ratings` : ""} · Peak ${number(rating.peak)}`,
      "stats-muted",
    ),
  );
  if (!last) {
    card.append(
      element(
        "p",
        "Your graph starts after your first signed-in round. With no other signed-in human, the round is recorded with zero Elo change. Guests and bots never affect Elo.",
        "stats-empty",
      ),
    );
  } else {
    const points = rating.points,
      samples = [
        { at: points[0]!.at, value: points[0]!.before },
        ...points.map((p) => ({ at: p.at, value: p.after })),
      ];
    const values = samples.map((p) => p.value),
      min = Math.floor((Math.min(...values) - 12) / 20) * 20,
      max = Math.ceil((Math.max(...values) + 12) / 20) * 20;
    const start = samples[0]!.at,
      end = last.at,
      width = window.innerWidth < 540 ? 340 : 640,
      height = 190,
      left = 52,
      right = 16,
      top = 16,
      bottom = 34;
    const x = (at: number, i: number): number =>
      left +
      (end > start
        ? (at - start) / (end - start)
        : i / Math.max(1, samples.length - 1)) *
        (width - left - right);
    const y = (value: number): number =>
      top + ((max - value) / (max - min)) * (height - top - bottom);
    const chart = svgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `Elo rating over time, ${date(start)} to ${date(end)}. Current ${number(rating.value)}.`,
      class: "rating-chart",
    });
    const title = svgElement("title");
    title.textContent = "Elo rating over time";
    chart.append(title);
    for (const tick of [min, (min + max) / 2, max]) {
      chart.append(
        svgElement("line", {
          x1: left,
          x2: width - right,
          y1: y(tick),
          y2: y(tick),
          class: "rating-grid",
        }),
      );
      const label = svgElement("text", {
        x: left - 8,
        y: y(tick) + 4,
        "text-anchor": "end",
      });
      label.textContent = number(tick);
      chart.append(label);
    }
    chart.append(
      svgElement("polyline", {
        points: samples.map((p, i) => `${x(p.at, i)},${y(p.value)}`).join(" "),
        fill: "none",
        class: "rating-line",
      }),
    );
    samples.forEach((p, i) => {
      const dot = svgElement("circle", {
        cx: x(p.at, i),
        cy: y(p.value),
        r: i === samples.length - 1 ? 4 : 2.5,
        class: "rating-dot",
      });
      const t = svgElement("title");
      t.textContent = `${date(p.at)} · ${number(p.value)} Elo`;
      dot.append(t);
      chart.append(dot);
    });
    for (const [at, pos, anchor] of [
      [start, left, "start"],
      [end, width - right, "end"],
    ] as const) {
      const label = svgElement("text", {
        x: pos,
        y: height - 7,
        "text-anchor": anchor,
      });
      label.textContent =
        end - start < 86_400_000
          ? new Date(at).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : date(at);
      chart.append(label);
    }
    card.append(chart);
    const data = details(
        `Round-by-round Elo · latest ${points.length} entries`,
      ),
      table = element("table");
    const header = element("tr");
    for (const label of ["Result", "Date", "Elo", "Change"])
      header.append(element("th", label));
    table.append(header);
    for (const p of [...points].reverse()) {
      const row = element("tr");
      row.append(
        element(
          "td",
          p.round === undefined
            ? "Earlier full game"
            : `Round ${p.round}${p.opponents === 0 ? " · no signed-in opponent" : ""}`,
        ),
        element("td", new Date(p.at).toLocaleString()),
        element("td", number(p.after)),
        element("td", signed(Math.round(p.after) - Math.round(p.before))),
      );
      table.append(row);
    }
    data.append(table);
    card.append(data);
  }
  const rules = details("How Elo works");
  rules.append(
    element(
      "p",
      "Start at 1,000. Elo updates after each individual round, comparing only signed-in human finishers with each other. Every signed-in finisher records a round; without another signed-in human the Elo change is zero. Guests and bots are excluded; ties split the result. You can join late or leave between rounds and keep the Elo from rounds you completed. Reports must agree before ratings settle, and a missing finisher report can delay settlement. Earlier whole-game ratings remain in your history. This community ladder uses peer-confirmed results.",
    ),
  );
  card.append(rules);
  return card;
}
function bars(
  counts: readonly number[],
  labels: readonly string[],
): HTMLElement {
  const wrap = element("div", "", "stats-bars"),
    max = Math.max(1, ...counts),
    total = counts.reduce((a, b) => a + b, 0);
  counts.forEach((n, i) => {
    const row = element("div", "", "stats-bar");
    const track = element("span", "", "stats-track"),
      fill = element("i");
    fill.style.width = `${(100 * n) / max}%`;
    track.append(fill);
    row.append(
      element("span", labels[i] ?? String(i + 1)),
      track,
      element("span", `${number(n)} · ${percent(n, total)}`),
    );
    wrap.append(row);
  });
  return wrap;
}
function rivalrySection(page: StatsPage): HTMLElement {
  const rivals = section(
      "RIVALRIES",
      "All time · signed-in humans · unaffected by the game filters",
    ),
    columns = element("div", "", "stats-rivals");
  for (const [title, list] of [
    ["Nemeses", page.rivals?.nemeses ?? []],
    ["Prey", page.rivals?.prey ?? []],
  ] as const) {
    const column = element("div");
    column.append(element("h4", title));
    if (!list.length)
      column.append(element("p", "Your rivalries start here.", "stats-muted"));
    const items = element("ol");
    for (const r of list) {
      const item = element("li");
      item.append(
        element("strong", r.name),
        element("span", `${r.kills} kills / ${r.deaths} deaths`, "stats-muted"),
      );
      items.append(item);
    }
    column.append(items);
    columns.append(column);
  }
  rivals.append(columns);
  return rivals;
}
export function playerStats(page: StatsPage): HTMLElement {
  const root = element("div", "", "player-stats");
  root.append(
    ratingCard(page.profile?.rating ?? newRating(), page.profile?.rank),
  );
  const controls = element("div", "", "stats-filters"),
    period = element("select"),
    group = element("select");
  period.setAttribute("aria-label", "Stats period");
  group.setAttribute("aria-label", "Game opponents");
  for (const [value, label] of [
    ["all", "All time"],
    ["recent", "Last 20 full games"],
  ]) {
    const option = element("option", label);
    option.value = value!;
    period.append(option);
  }
  for (const [value, label] of [
    ["all", "All full games"],
    ["human", "Humans only"],
    ["mixed", "Humans + AI"],
    ["practice", "AI / solo practice"],
  ]) {
    const option = element("option", label);
    option.value = value!;
    group.append(option);
  }
  controls.append(
    period,
    group,
    element(
      "span",
      "Full-game career stats below · Separate from the round-by-round Elo above",
      "stats-muted",
    ),
  );
  root.append(controls);
  const content = element("div", "", "stats-content");
  root.append(content);
  const render = (): void => {
    const stats = emptyCareer(),
      filter = group.value as GameGroup | "all";
    const recent = page.matches
      .slice(0, 20)
      .filter(
        (m) => filter === "all" || gameGroup(m.result.players) === filter,
      );
    if (period.value === "all") {
      for (const key of GAME_GROUPS)
        if ((filter === "all" || key === filter) && page.profile?.career?.[key])
          mergeCareer(stats, page.profile.career[key]);
    } else
      for (const match of recent) {
        const me = match.result.players.find((p) => p.playerId === match.you);
        if (me) mergeCareer(stats, careerFor(me, match.result.players));
      }
    content.replaceChildren(
      metrics(
        [
          ["Full games", number(stats.matches)],
          ["Win rate", percent(stats.wins, stats.matches)],
          ["Kills", number(stats.kills)],
          ["Distance · arena units", number(stats.distance)],
        ],
        "stats-primary",
      ),
    );
    if (!stats.matches)
      content.append(
        element(
          "p",
          "No recorded full games in this selection yet.",
          "stats-empty",
        ),
      );
    if (
      period.value === "all" &&
      page.profile?.totals.matches &&
      Object.values(page.profile.career ?? {}).reduce(
        (n, s) => n + s.matches,
        0,
      ) < page.profile.totals.matches
    )
      content.append(
        element(
          "p",
          "Career totals count completed full games, not individual rounds. Older games may lack detailed stats.",
          "stats-muted",
        ),
      );
    const results = section("RESULTS");
    const places = stats.placements.slice(
      0,
      Math.max(
        3,
        stats.placements.reduce((last, n, i) => (n > 0 ? i : last), -1) + 1,
      ),
    );
    results.append(
      bars(
        places,
        places.map((_, i) => `#${i + 1}`),
      ),
      metrics([
        ["Round win rate", percent(stats.roundWins, stats.rounds)],
        [
          "Average finish",
          stats.matches ? (stats.placeSum / stats.matches).toFixed(1) : "—",
        ],
        ["Field beaten", percent(stats.fieldScore, stats.opponents)],
      ]),
    );
    const form = element("div", "", "stats-form");
    form.append(element("span", "Recent finishes", "stats-muted"));
    for (const m of [...recent.slice(0, 10)].reverse()) {
      const p = m.result.players.find((p) => p.playerId === m.you);
      if (!p) continue;
      const chip = element("span", `#${p.matchPlacement}`, "stats-finish");
      chip.dataset.won = String(p.matchPlacement === 1);
      chip.title = `${date(m.endedAt)} · ${p.matchPlacement} of ${m.result.players.length} riders`;
      form.append(chip);
    }
    results.append(form);
    content.append(results, rivalrySection(page));
    const combat = section("COMBAT"),
      against = element("select");
    against.setAttribute("aria-label", "Combat opponent");
    for (const [value, label] of [
      ["all", "All opponents + hazards"],
      ["human", "Against humans"],
      ["ai", "Against AI"],
    ]) {
      const option = element("option", label);
      option.value = value!;
      against.append(option);
    }
    const combatBody = element("div");
    combat.append(against, combatBody);
    const renderCombat = (): void => {
      const mode = against.value as "all" | "human" | "ai",
        counts = mode === "all" ? stats.combat : stats.combat.versus[mode];
      const best = (kind: "kills" | "deaths") => {
        const key = [...KILL_METHODS].sort(
          (a, b) => counts[kind][b] - counts[kind][a],
        )[0]!;
        return counts[kind][key]
          ? `${LABELS[key]} · ${number(counts[kind][key])}`
          : "—";
      };
      const kills = Object.values(counts.kills).reduce((a, b) => a + b, 0),
        deaths = Object.values(counts.deaths).reduce((a, b) => a + b, 0);
      combatBody.replaceChildren(
        metrics([
          ["Signature weapon / method", best("kills")],
          ["Most often killed by", best("deaths")],
          ["Kills / deaths", `${number(kills)} / ${number(deaths)}`],
        ]),
      );
      const breakdown = details("Weapon & death breakdown"),
        table = element("table"),
        header = element("tr");
      for (const label of ["Method", "Kills", "Deaths", "Kills / use"])
        header.append(element("th", label));
      table.append(header);
      for (const method of KILL_METHODS) {
        const uses = WEAPONS.includes(method as (typeof WEAPONS)[number])
          ? stats.combat.uses[method as (typeof WEAPONS)[number]]
          : 0;
        if (!counts.kills[method] && !counts.deaths[method] && !uses) continue;
        const row = element("tr");
        row.append(
          element("td", LABELS[method]),
          element("td", number(counts.kills[method])),
          element("td", number(counts.deaths[method])),
          element(
            "td",
            uses
              ? `${(counts.kills[method] / uses).toFixed(2)} (${number(uses)} uses)`
              : "—",
          ),
        );
        table.append(row);
      }
      breakdown.append(
        table,
        element(
          "p",
          "Kills per use is efficiency, not accuracy. Uses include all shots in the selected games; targets cannot be assigned to missed shots.",
          "stats-muted",
        ),
      );
      combatBody.append(breakdown);
    };
    against.onchange = renderCombat;
    renderCombat();
    combat.append(
      element(
        "p",
        `Detailed attribution: ${number(stats.detailMatches)} of ${number(stats.matches)} full games. Self-inflicted and uncredited deaths appear only under all opponents + hazards.`,
        "stats-muted",
      ),
    );
    content.append(combat);
    const records = section("PERSONAL BESTS");
    records.append(
      metrics([
        ["Kills in a match", number(stats.bestKills)],
        ["Longest life", duration(stats.longestLife)],
        ["Distance in a match", number(stats.furthestMatch)],
      ]),
    );
    content.append(records);
    const more = details("More riding stats");
    more.append(
      metrics([
        ["Time alive", duration(stats.survival)],
        [
          "Average life",
          stats.rounds ? duration(stats.survival / stats.rounds) : "—",
        ],
        ["Bombs placed", number(stats.bombs)],
        ["Pickups collected", number(stats.pickups)],
        ["Portal transits", number(stats.portals)],
        ["Wall bounces", number(stats.bounces)],
        ["Invulnerable time", duration(stats.invulnerable)],
        ["Self-inflicted deaths", number(stats.combat.selfDeaths)],
      ]),
    );
    more.append(
      element("p", "Round finishes", "stats-muted"),
      bars(stats.combat.roundPlaces, ["#1", "#2", "#3", "#4", "#5"]),
    );
    content.append(more);
  };
  period.onchange = render;
  group.onchange = render;
  render();
  return root;
}
export function leaderboardTable(
  players: readonly LeaderboardEntry[],
): HTMLElement {
  const root = section(
    "GLOBAL LEADERBOARD",
    "Top 50 · Rounds includes zero-change rounds · Older full-game Elo is retained",
  );
  if (!players.length) {
    root.append(
      element(
        "p",
        "The grid is waiting for its first ranked riders.",
        "stats-empty",
      ),
    );
    return root;
  }
  const table = element("table", "", "stats-leaderboard"),
    header = element("tr");
  for (const label of ["Rank", "Rider", "Elo", "Rounds"])
    header.append(element("th", label));
  table.append(header);
  for (const p of players) {
    const row = element("tr");
    row.dataset.you = String(!!p.you);
    row.append(
      element("td", `#${p.rank}`),
      element("td", `${p.name}${p.you ? " (you)" : ""}`),
      element("td", number(p.elo)),
      element("td", number(p.rounds ?? 0)),
    );
    table.append(row);
  }
  root.append(table);
  return root;
}
