import {
  el,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
  type ResultsRow,
} from "fuse-ui";
import type { Model, Row } from "./presenter.js";

type Result = NonNullable<Model["result"]>;

/** What the page lends the report: colours, friend buttons and the nodes it keeps drawing into. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another player whose account is known. */
  friend?(id: string): HTMLElement | undefined;
  /** This device's own run: the judgments and the timing graph. Empty for a watcher and for the TV. */
  run: readonly Node[];
  document?: Document;
}

const JUDGMENTS = ["MARVELOUS", "PERFECT", "GREAT", "GOOD", "BOO", "MISS"];
const plural = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? "" : "s"}`;

/** The cards beside the standings: this device's own feats first, then the match's. */
function highlightCards(result: Result, parts: ReportParts) {
  const cards: ResultsHighlight[] = [];
  const own = result.rows.find((row) => row.you),
    me = own ? [{ name: own.name, color: parts.color(own.slot) }] : [];
  if (result.own?.badge)
    cards.push({
      icon: "★",
      title: result.own.badge,
      winners: me,
      detail: "Not one combo break from the first arrow to the last.",
    });
  for (const line of result.lines)
    cards.push({
      icon: /^(NEW BEST|FIRST)/.test(line) ? "▲" : "◆",
      title: /^NEW BEST/.test(line)
        ? "New best"
        : /^FIRST/.test(line)
          ? "First score"
          : "Your best",
      winners: me,
      detail: line,
    });
  if (result.rows.length > 1) {
    const top = (pick: (row: Row) => number) => {
      const best = Math.max(...result.rows.map(pick));
      return {
        best,
        rows: result.rows.filter((row) => pick(row) === best),
      };
    };
    const combo = top((row) => Number(row.maxCombo));
    if (combo.best > 0)
      cards.push({
        icon: "∞",
        title: "Combo king",
        winners: combo.rows.map((row) => ({
          name: row.name,
          color: parts.color(row.slot),
        })),
        detail: `Longest combo of the song: ${combo.best}.`,
      });
    const sharp = top((row) => Number(row.judgments[0]));
    if (sharp.best > 0)
      cards.push({
        icon: "◎",
        title: "Sharpshooter",
        winners: sharp.rows.map((row) => ({
          name: row.name,
          color: parts.color(row.slot),
        })),
        detail: `Most Marvelous steps: ${sharp.best}.`,
      });
  }
  return cards.slice(0, 3);
}

/** Every player's judgments side by side: the full stats. */
function judgmentTable(result: Result, parts: ReportParts): HTMLElement {
  const doc = parts.document ?? document;
  const table = el("table", "", "fm-judgments", doc);
  table.setAttribute("aria-label", "Judgments by player");
  const head = el("tr", "", "", doc);
  for (const label of ["PLAYER", "CHART", ...JUDGMENTS]) {
    const cell = el("th", label, "", doc);
    cell.scope = "col";
    head.append(cell);
  }
  const body = el("tbody", "", "", doc);
  for (const row of result.rows) {
    const line = el("tr", "", row.you ? "is-you" : "", doc);
    line.style.setProperty("--player-color", parts.color(row.slot));
    const name = el("th", row.name, "", doc);
    name.scope = "row";
    line.append(
      name,
      el("td", row.chart, "", doc),
      ...JUDGMENTS.map((label, index) =>
        el(
          "td",
          row.judgments[index] ?? "",
          `fm-count-${label.toLowerCase()}`,
          doc,
        ),
      ),
    );
    body.append(line);
  }
  const top = el("thead", "", "", doc);
  top.append(head);
  table.append(top, body);
  return table;
}

/** A session's standings as a small list, for under the song's result. */
function sessionList(result: Result, parts: ReportParts): HTMLElement {
  const doc = parts.document ?? document;
  const block = el("section", "", "fm-session", doc),
    list = el("ol", "", "", doc);
  block.append(list);
  for (const row of result.session?.rows ?? []) {
    const item = el("li", "", row.you ? "you" : "", doc);
    if (row.slot >= 0) item.style.setProperty("--c", parts.color(row.slot));
    item.append(
      el("span", String(row.place), "", doc),
      el("b", row.name, "", doc),
      el("small", row.wins, "", doc),
      el("em", row.points, "", doc),
    );
    list.append(item);
  }
  return block;
}

/** A finished song, or a finished session, as the shared results screen shows it. */
export function resultReport(
  result: Result,
  parts: ReportParts,
): ResultsReport {
  const songRows: ResultsRow[] = result.rows.map((row) => ({
    id: row.id,
    placement: row.place,
    name: row.name,
    color: parts.color(row.slot),
    you: row.you,
    ...(row.bot ? { tag: "AI" } : {}),
    friend: row.you || row.bot ? undefined : parts.friend?.(row.id),
    values: [row.grade, row.score, row.accuracy, row.maxCombo],
  }));
  const songStandings = {
    nameLabel: "PLAYER",
    columns: ["GRADE", "SCORE", "ACCURACY", "MAX COMBO"],
    rows: songRows,
  };
  const alone = result.rows.length === 1,
    first = result.rows[0],
    sections: { title: string; content: readonly Node[] }[] = [];
  const context = `${result.song} · ${plural(result.rows.length, "player")}`;
  const highlights = {
    title: alone ? "RUN HIGHLIGHTS" : "MATCH HIGHLIGHTS",
    cards: highlightCards(result, parts),
    empty: "The scores tell the story this time.",
  };
  if (parts.run.length)
    sections.push({ title: "YOUR RUN", content: parts.run });
  const details =
    result.rows.length > 1
      ? {
          title: "FULL SONG STATS",
          content: [judgmentTable(result, parts)],
        }
      : undefined;

  // A session that is over leads with its own standings; the last song's are under it.
  if (result.final && result.session) {
    const leader = result.session.rows[0];
    return {
      game: "FUSEMANIA",
      kicker: "SESSION COMPLETE",
      context,
      headline: result.title,
      ...(leader
        ? {
            summary: `${leader.points} points${leader.wins ? ` · ${leader.wins.toLowerCase()}` : ""}`,
            ...(leader.slot >= 0 ? { accent: parts.color(leader.slot) } : {}),
          }
        : {}),
      standings: {
        title: "FINAL STANDINGS",
        nameLabel: "PLAYER",
        columns: ["POINTS", "WINS"],
        rows: result.session.rows.map((row, index) => ({
          id: `${index}`,
          placement: row.place,
          name: row.name,
          color: row.slot >= 0 ? parts.color(row.slot) : "#7c93b8",
          you: row.you,
          values: [row.points, row.wins.replace(/\D/g, "") || "0"],
        })),
      },
      highlights,
      sections: [
        {
          title: `LAST SONG · ${result.song}`,
          content: [songTable(songStandings, parts)],
        },
        ...sections,
      ],
      ...(details ? { details } : {}),
    };
  }
  if (result.session)
    sections.push({
      title: result.session.title,
      content: [sessionList(result, parts)],
    });
  return {
    game: "FUSEMANIA",
    kicker: "SONG COMPLETE",
    context,
    // Alone the grade is the banner; with others it is who won.
    headline: alone ? result.song : result.title,
    ...(alone && first ? { emblem: first.grade } : {}),
    ...(first
      ? {
          summary: `${first.score} · ${first.accuracy} · ${first.chart}`,
          accent: parts.color(first.slot),
        }
      : {}),
    standings: songStandings,
    highlights,
    sections,
    ...(details ? { details } : {}),
  };
}

/** The song's standings as a plain table, for a session's last song. */
function songTable(
  view: { columns: readonly string[]; rows: readonly ResultsRow[] },
  parts: ReportParts,
): HTMLElement {
  const doc = parts.document ?? document;
  const table = el("table", "", "fm-judgments", doc);
  table.setAttribute("aria-label", "The last song");
  const head = el("tr", "", "", doc);
  for (const label of ["PLAYER", ...view.columns]) {
    const cell = el("th", label, "", doc);
    cell.scope = "col";
    head.append(cell);
  }
  const top = el("thead", "", "", doc),
    body = el("tbody", "", "", doc);
  top.append(head);
  for (const row of view.rows) {
    const line = el("tr", "", row.you ? "is-you" : "", doc);
    line.style.setProperty("--player-color", row.color);
    const name = el("th", row.name, "", doc);
    name.scope = "row";
    line.append(name, ...row.values.map((value) => el("td", value, "", doc)));
    body.append(line);
  }
  table.append(top, body);
  return table;
}

/** The bar under the report: what the host does next, and what everybody else waits for. */
export function resultBar(result: Result): ResultsBar {
  return {
    ...(result.waiting ? { status: result.waiting } : {}),
    actions: result.host
      ? [
          ...(result.solo ? [{ id: "menu", label: "Menu" }] : []),
          ...(result.secondary
            ? [{ id: "secondary", label: titleCase(result.secondary.text) }]
            : []),
          { id: "primary", label: result.primary.text, primary: true },
        ]
      : [],
  };
}

const titleCase = (text: string) =>
  text.charAt(0) + text.slice(1).toLowerCase();
