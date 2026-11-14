import type {
  MetricsResponse,
  MetricsRow,
  MetricsPeriod,
} from "fuse-telemetry/contracts";
import type { Dom } from "./dom.js";
import {
  chartPoints,
  comparisonRows,
  measures,
  type SortKey,
} from "./model.js";

export interface MetricsFilters {
  period: MetricsPeriod;
  from: string;
  to: string;
  gameId: string;
}
export function metricsQuery(filters: MetricsFilters): string {
  const query = new URLSearchParams({
    period: filters.period,
    from: filters.from,
    to: filters.to,
  });
  if (filters.gameId) query.set("gameId", filters.gameId);
  return `/api/dev/metrics?${query}`;
}

export function renderMetrics(
  dom: Dom,
  data: MetricsResponse,
  onGame: (gameId: string) => void,
): HTMLElement {
  const { node, button, field, select } = dom;
  const section = node("section", "metrics-result");
  const description = node(
    "p",
    "muted",
    `Aligned ${data.period} periods · ${data.from} to ${data.toExclusive} (end exclusive) · UTC`,
  );
  section.append(description);
  if (!data.series.some((row) => row.events > 0)) {
    section.append(
      node(
        "p",
        "empty-state",
        "No activity in this range. Try another date range or game.",
      ),
    );
  }
  const compare = node("section", "comparison");
  const compareHeading = node("div", "section-heading");
  compareHeading.append(node("h2", "", "Games compared"));
  const periods = [...new Set(data.games.map((row) => row.periodStart))].sort();
  const periodControl = select(
    periods.map((value) => [value, value] as const),
    periods.at(-1) ?? "",
  );
  compareHeading.append(field("Comparison period · UTC", periodControl));
  compare.append(
    compareHeading,
    node(
      "p",
      "muted",
      "Each row covers one aligned period; the current period is still accumulating. Unique browser users are browser installations, not verified people. Sessions use a 30-minute inactivity boundary.",
    ),
  );
  const tableWrap = node("div", "table-wrap");
  compare.append(tableWrap);
  let sort: SortKey = "roundStarts";
  let descending = true;
  function drawComparison() {
    const table = node("table");
    const caption = node(
      "caption",
      "sr-only",
      `Game activity for ${periodControl.value}, ${data.period}, UTC`,
    );
    const head = node("thead");
    const headingRow = node("tr");
    const columns = [["gameId", "Game"], ...measures] as const;
    for (const [key, label] of columns) {
      const th = node("th");
      th.scope = "col";
      th.setAttribute(
        "aria-sort",
        sort === key ? (descending ? "descending" : "ascending") : "none",
      );
      th.append(
        button(
          `${label}${sort === key ? (descending ? " ↓" : " ↑") : ""}`,
          () => {
            descending = sort === key ? !descending : key !== "gameId";
            sort = key;
            drawComparison();
            const buttons = tableWrap.querySelectorAll("th button");
            (
              buttons[columns.findIndex(([column]) => column === key)] as
                HTMLButtonElement | undefined
            )?.focus();
          },
          "sort-button",
        ),
      );
      headingRow.append(th);
    }
    head.append(headingRow);
    const body = node("tbody");
    const rows = comparisonRows(
      data.games,
      periodControl.value,
      sort,
      descending,
    );
    for (const row of rows) {
      const tr = node("tr");
      const name = node("th");
      name.scope = "row";
      name.append(
        button(
          row.gameId ?? "All games",
          () => onGame(row.gameId ?? ""),
          "text-button",
        ),
      );
      tr.append(name);
      for (const [key] of measures)
        tr.append(node("td", "number", row[key].toLocaleString()));
      body.append(tr);
    }
    if (!rows.length) {
      const td = node("td", "empty-state", "No game activity for this period.");
      td.colSpan = 6;
      const row = node("tr");
      row.append(td);
      body.append(row);
    }
    table.append(caption, head, body);
    tableWrap.replaceChildren(table);
  }
  periodControl.addEventListener("change", drawComparison);
  drawComparison();
  section.append(compare);
  const heading = node(
    "h2",
    "",
    data.series[0]?.gameId
      ? `${data.series[0].gameId} activity`
      : "Platform activity",
  );
  section.append(
    heading,
    node(
      "p",
      "muted",
      "Platform users and sessions are deduplicated across games. Round plays count participating browsers; completions count finished round participation.",
    ),
  );
  const charts = node("div", "charts");
  for (const [measure, title] of measures) {
    const figure = node("figure", `chart chart-${measure}`);
    figure.append(node("figcaption", "", title));
    // SVG draws measured geometry only; the equivalent table below carries every value.
    const svg = documentSvg(dom, data.series, measure, title);
    figure.append(svg);
    const ends = node("div", "chart-axis");
    ends.append(
      node("span", "", data.series[0]?.periodStart ?? data.from),
      node(
        "span",
        "",
        `${Math.max(0, ...data.series.map((row) => row[measure])).toLocaleString()} max`,
      ),
      node("span", "", data.series.at(-1)?.periodStart ?? data.from),
    );
    figure.append(ends);
    charts.append(figure);
  }
  section.append(charts);
  const details = node("details", "data-details");
  details.append(node("summary", "", "View chart data as a table"));
  const wrap = node("div", "table-wrap");
  const table = node("table");
  table.append(
    node("caption", "sr-only", `${data.period} activity counts · UTC`),
  );
  const header = node("thead");
  const headerRow = node("tr");
  for (const label of [
    "Period start · UTC",
    ...measures.map(([, title]) => title),
  ]) {
    const th = node("th", "", label);
    th.scope = "col";
    headerRow.append(th);
  }
  header.append(headerRow);
  const body = node("tbody");
  for (const row of data.series) {
    const tr = node("tr");
    const date = node("th", "", row.periodStart);
    date.scope = "row";
    tr.append(date);
    for (const [measure] of measures)
      tr.append(node("td", "number", row[measure].toLocaleString()));
    body.append(tr);
  }
  table.append(header, body);
  wrap.append(table);
  details.append(wrap);
  section.append(details);
  return section;
}

function documentSvg(
  dom: Dom,
  rows: readonly MetricsRow[],
  measure: (typeof measures)[number][0],
  title: string,
): SVGSVGElement {
  const document = dom.node("div").ownerDocument;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 600 130");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${title} by period. Exact values are in the chart data table below.`,
  );
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", chartPoints(rows, measure));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-width", "3");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(line);
  if (rows.length === 1) {
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", "300");
    dot.setAttribute("cy", chartPoints(rows, measure).split(",")[1] ?? "120");
    dot.setAttribute("r", "4");
    dot.setAttribute("fill", "currentColor");
    svg.append(dot);
  }
  return svg;
}
