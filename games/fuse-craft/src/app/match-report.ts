import {
  dominanceCells,
  RULES,
  type MatchEvent,
  type PlayerSample,
  type World,
} from "../engine/index.js";
import { isResearchKind } from "../engine/catalog.js";
import { POWERUP_PRESENTATION, isPowerupKind } from "../engine/powerups.js";
import { TEAM_PALETTES } from "../render/creep.js";
import { RESEARCH_PRESENTATION } from "./command-card.js";

/**
 * The end-of-match report: how the territory, economy and army of every
 * player moved over the match, the moments that decided it, and a short
 * plain-language account of why the winner won. Pure: markup from a world.
 */
export interface ReportPlayer {
  id: string;
  name: string;
  color: string;
  winner: boolean;
  local: boolean;
}
export interface Finding {
  tone: "good" | "bad" | "neutral";
  text: string;
}
export type ReportMetric = "territory" | "economy" | "army" | "damage";

export const REPORT_METRICS: readonly {
  id: ReportMetric;
  label: string;
  description: string;
}[] = [
  {
    id: "territory",
    label: "Territory",
    description: "Cells each network claims. The dashed line is dominance.",
  },
  {
    id: "economy",
    label: "Economy",
    description: "Biomass earned, from mining and territory.",
  },
  {
    id: "army",
    label: "Army",
    description: "Connected structures that can fire.",
  },
  {
    id: "damage",
    label: "Damage",
    description: "Damage dealt to rival structures.",
  },
];

export const TEAM_NAMES = [
  "Blue",
  "Red",
  "Green",
  "Gold",
  "Violet",
  "Amber",
  "Teal",
  "Magenta",
] as const;

export function clock(ticks: number): string {
  const seconds = Math.floor(ticks / RULES.ticksPerSecond);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function reportPlayers(
  world: Readonly<World>,
  localId: string | null,
  nameOf: (id: string) => string | undefined = () => undefined,
): ReportPlayer[] {
  return world.players.map((p) => ({
    id: p.id,
    name:
      nameOf(p.id) ??
      (p.id === localId ? "You" : (TEAM_NAMES[p.slot] ?? `Player ${p.slot}`)),
    color: TEAM_PALETTES[p.slot]?.glow ?? "#63cfff",
    winner: p.id === world.winnerId,
    local: p.id === localId,
  }));
}

function value(sample: PlayerSample, metric: ReportMetric): number {
  switch (metric) {
    case "territory":
      return sample.territory;
    case "economy":
      return Math.round(sample.biomassEarned / 1000);
    case "army":
      return sample.weapons;
    case "damage":
      return sample.damage;
  }
}

/** The series of one metric for every player, from the world's timeline. */
export function series(
  world: Readonly<World>,
  metric: ReportMetric,
): Map<string, [number, number][]> {
  const lines = new Map<string, [number, number][]>(
    world.players.map((p) => [p.id, [[0, 0]]]),
  );
  if (metric === "territory")
    for (const line of lines.values()) line[0]![1] = 7;
  for (const sample of world.timeline)
    for (const entry of sample.players)
      lines.get(entry.id)?.push([sample.tick, value(entry, metric)]);
  return lines;
}

/** A line chart in SVG, one line per player, with moments marked on the time axis. */
export function chartMarkup(
  world: Readonly<World>,
  metric: ReportMetric,
  players: readonly ReportPlayer[],
): string {
  const W = 560,
    H = 220,
    left = 40,
    right = 16,
    top = 14,
    bottom = 28;
  const lines = series(world, metric);
  const end = Math.max(world.tick, 1);
  const threshold = metric === "territory" ? dominanceCells(world) : null;
  const highest = Math.max(
    1,
    ...[...lines.values()].flatMap((line) => line.map(([, v]) => v)),
  );
  // The dominance line joins the scale only once someone came near it;
  // otherwise it would flatten every line against the floor.
  const showThreshold = threshold !== null && highest >= threshold * 0.5;
  const peak = showThreshold ? Math.max(highest, threshold) : highest;
  const step = niceStep(peak);
  const ceiling = Math.ceil(peak / step) * step;
  const x = (tick: number) => left + ((W - left - right) * tick) / end;
  const y = (v: number) => top + (H - top - bottom) * (1 - v / ceiling);
  const grid: string[] = [];
  for (let v = 0; v <= ceiling; v += step)
    grid.push(
      `<line x1="${left}" x2="${W - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="report-grid"/><text x="${left - 6}" y="${(y(v) + 4).toFixed(1)}" class="report-axis" text-anchor="end">${v}</text>`,
    );
  const minute = 60 * RULES.ticksPerSecond;
  const every =
    end > 12 * minute ? 5 * minute : end > 5 * minute ? 2 * minute : minute;
  for (let t = every; t < end; t += every)
    grid.push(
      `<text x="${x(t).toFixed(1)}" y="${H - 8}" class="report-axis" text-anchor="middle">${clock(t)}</text>`,
    );
  const markers = keyMoments(world)
    .filter((e) => e.type !== "researched" && e.type !== "claimed")
    .map((e) => {
      const color =
        players.find((p) => p.id === e.playerId)?.color ?? "#ffffff";
      return `<line x1="${x(e.tick).toFixed(1)}" x2="${x(e.tick).toFixed(1)}" y1="${top}" y2="${H - bottom}" class="report-moment" stroke="${color}"><title>${clock(e.tick)} ${escapeText(eventText(e, players))}</title></line>`;
    });
  const paths = players.map((p) => {
    const line = lines.get(p.id) ?? [];
    const d = line
      .map(
        ([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`,
      )
      .join("");
    const [lt, lv] = line.at(-1) ?? [0, 0];
    return `<path d="${d}" class="report-line${p.winner ? " winner" : ""}" stroke="${p.color}"/><circle cx="${x(lt).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="3.5" fill="${p.color}"><title>${escapeText(p.name)}: ${lv}</title></circle>`;
  });
  const dominance =
    threshold === null || !showThreshold
      ? ""
      : `<line x1="${left}" x2="${W - right}" y1="${y(threshold).toFixed(1)}" y2="${y(threshold).toFixed(1)}" class="report-threshold"/><text x="${W - right}" y="${(y(threshold) - 4).toFixed(1)}" class="report-axis" text-anchor="end">dominance ${threshold}</text>`;
  const label = REPORT_METRICS.find((m) => m.id === metric)!;
  const summary = players
    .map((p) => `${p.name} ${lines.get(p.id)?.at(-1)?.[1] ?? 0}`)
    .join(", ");
  return `<svg class="report-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeText(`${label.label} over time. Final: ${summary}`)}">${grid.join("")}${dominance}${markers.join("")}${paths.join("")}</svg>`;
}

function niceStep(peak: number): number {
  const raw = peak / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / magnitude;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * magnitude;
}

/** Moments worth listing, in order. */
export function keyMoments(world: Readonly<World>): MatchEvent[] {
  return [...world.events].sort((a, b) => a.tick - b.tick);
}

export function eventText(
  e: MatchEvent,
  players: readonly ReportPlayer[],
): string {
  const who = players.find((p) => p.id === e.playerId)?.name ?? e.playerId;
  const whom = players.find((p) => p.id === e.detail)?.name ?? e.detail;
  switch (e.type) {
    case "researched":
      return `${who} researched ${isResearchKind(e.detail) ? RESEARCH_PRESENTATION[e.detail].label : e.detail}`;
    case "claimed":
      return `${who} claimed ${isPowerupKind(e.detail) ? POWERUP_PRESENTATION[e.detail].label : "a powerup"}`;
    case "eliminated":
      return `${who} was eliminated`;
    case "dominating":
      return `${who} reached a dominant share`;
    case "dominanceBroken":
      return `${who} lost the dominant share`;
    case "firstBlood":
      return `${who} drew first blood`;
    case "brainHit":
      return `${who} struck ${whom}'s brain`;
  }
}

/**
 * Why the match went the way it did, from the point of view of `subject`
 * (the local player, or the loser when watching), compared with the winner.
 */
export function findings(
  world: Readonly<World>,
  players: readonly ReportPlayer[],
  subjectId: string | null,
): Finding[] {
  const out: Finding[] = [];
  const winner = players.find((p) => p.winner);
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  const last = world.timeline.at(-1);
  if (!winner || !last) {
    if (!winner && world.finished)
      out.push({
        tone: "neutral",
        text: "Every brain fell on the same tick: a draw.",
      });
    return out;
  }
  const subject =
    players.find((p) => p.id === subjectId && !p.winner) ??
    // Watching or winning: explain the strongest loser's defeat.
    [...players]
      .filter((p) => !p.winner)
      .sort(
        (a, b) =>
          (sampleOf(last, b.id)?.territory ?? 0) -
          (sampleOf(last, a.id)?.territory ?? 0),
      )[0];
  const won = players.find((p) => p.id === subjectId)?.winner ?? false;
  const w = name(winner.id);
  if (world.victory === "dominance")
    out.push({
      tone: won ? "good" : "bad",
      text: `${w} held ${sampleOf(last, winner.id)?.territory ?? 0} of ${dominanceCells(world)} cells needed for dominance for a full minute.`,
    });
  else {
    const hit = world.events.find(
      (e) => e.type === "brainHit" && e.playerId === winner.id,
    );
    out.push({
      tone: won ? "good" : "bad",
      text: hit
        ? `${w} first reached a rival brain at ${clock(hit.tick)} and destroyed the last one at ${clock(world.tick)}.`
        : `${w} destroyed the last rival brain at ${clock(world.tick)}.`,
    });
  }
  if (!subject) return out;
  const s = subject.id;
  const you = name(s);
  const lead = world.timeline.find((sample) => {
    const a = sampleOf(sample, winner.id)?.territory ?? 0,
      b = sampleOf(sample, s)?.territory ?? 0;
    return a >= b * 1.25 + 3;
  });
  if (lead)
    out.push({
      tone: won ? "good" : "bad",
      text: `${w} out-expanded ${you} from ${clock(lead.tick)}: ${sampleOf(lead, winner.id)?.territory} cells to ${sampleOf(lead, s)?.territory}.`,
    });
  const winnerEconomy = sampleOf(last, winner.id)?.biomassEarned ?? 0,
    subjectEconomy = sampleOf(last, s)?.biomassEarned ?? 0;
  if (winnerEconomy > 0 && subjectEconomy > 0) {
    const ratio = winnerEconomy / subjectEconomy;
    if (ratio >= 1.15 || ratio <= 1 / 1.15)
      out.push({
        tone: ratio >= 1.15 ? (won ? "good" : "bad") : "neutral",
        text:
          ratio >= 1.15
            ? `${w} earned ${Math.round((ratio - 1) * 100)}% more biomass than ${you}.`
            : `${you} earned more biomass, but ${w} spent it better.`,
      });
  }
  const firstWeapon = (id: string) =>
    world.timeline.find((sample) => (sampleOf(sample, id)?.weapons ?? 0) > 0)
      ?.tick ?? null;
  const ww = firstWeapon(winner.id),
    sw = firstWeapon(s);
  if (sw === null && ww !== null)
    out.push({
      tone: won ? "good" : "bad",
      text: `${you} never fielded a weapon; ${w} had one by ${clock(ww)}.`,
    });
  else if (ww !== null && sw !== null && sw - ww >= 60 * RULES.ticksPerSecond)
    out.push({
      tone: won ? "good" : "bad",
      text: `${w} armed ${clock(sw - ww)} earlier than ${you}.`,
    });
  const winnerStats = world.players.find((p) => p.id === winner.id)!.statistics,
    subjectStats = world.players.find((p) => p.id === s)!.statistics;
  if (winnerStats.damage + subjectStats.damage > 0)
    out.push({
      tone:
        winnerStats.damage > subjectStats.damage
          ? won
            ? "good"
            : "bad"
          : "neutral",
      text: `Damage dealt: ${w} ${winnerStats.damage}, ${you} ${subjectStats.damage}. Structures lost: ${w} ${winnerStats.lost}, ${you} ${subjectStats.lost}.`,
    });
  const researched = (id: string) =>
    world.events.filter((e) => e.type === "researched" && e.playerId === id)
      .length;
  if (researched(winner.id) - researched(s) >= 2)
    out.push({
      tone: won ? "good" : "bad",
      text: `${w} finished ${researched(winner.id)} research projects to ${you}'s ${researched(s)}.`,
    });
  const claims = (id: string) =>
    world.events.filter((e) => e.type === "claimed" && e.playerId === id)
      .length;
  if (claims(winner.id) + claims(s) > 0)
    out.push({
      tone: "neutral",
      text: `Powerups claimed: ${w} ${claims(winner.id)}, ${you} ${claims(s)}.`,
    });
  return out;
}

function sampleOf(
  sample: { players: PlayerSample[] },
  id: string,
): PlayerSample | undefined {
  return sample.players.find((p) => p.id === id);
}

export function scoreboardMarkup(
  world: Readonly<World>,
  players: readonly ReportPlayer[],
): string {
  const peak = (id: string) =>
    Math.max(
      0,
      ...world.timeline.map((sample) => sampleOf(sample, id)?.territory ?? 0),
    );
  const rows = players
    .map((p) => {
      const player = world.players.find((q) => q.id === p.id)!;
      const s = player.statistics;
      const claims = world.events.filter(
        (e) => e.type === "claimed" && e.playerId === p.id,
      ).length;
      return `<tr class="${p.winner ? "winner" : ""}${player.alive ? "" : " fallen"}"><th scope="row"><span class="report-swatch" style="--team:${p.color}"></span>${escapeText(p.name)}${p.winner ? " <em>winner</em>" : ""}</th><td>${player.territory}</td><td>${peak(p.id)}</td><td>${s.built}</td><td>${s.lost}</td><td>${s.damage}</td><td>${Math.round(s.biomassEarned / 1000)}</td><td>${Math.round(s.insightEarned / 1000)}</td><td>${player.research.length}</td><td>${claims}</td></tr>`;
    })
    .join("");
  return `<table class="report-table"><thead><tr><th scope="col">Player</th><th scope="col">Territory</th><th scope="col">Peak</th><th scope="col">Built</th><th scope="col">Lost</th><th scope="col">Damage</th><th scope="col">Biomass</th><th scope="col">Insight</th><th scope="col">Research</th><th scope="col">Powerups</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function reportMarkup(
  world: Readonly<World>,
  players: readonly ReportPlayer[],
  subjectId: string | null,
  metric: ReportMetric,
): string {
  const tabs = REPORT_METRICS.map(
    (m) =>
      `<button role="tab" data-action="report-metric" data-metric="${m.id}" aria-selected="${m.id === metric}" class="report-tab${m.id === metric ? " active" : ""}">${m.label}</button>`,
  ).join("");
  const threshold = dominanceCells(world);
  const description =
    metric === "territory"
      ? `Cells each network claims. Dominance needs ${threshold} cells held for a minute.`
      : REPORT_METRICS.find((m) => m.id === metric)!.description;
  const legend = players
    .map(
      (p) =>
        `<li><span class="report-swatch" style="--team:${p.color}"></span>${escapeText(p.name)}</li>`,
    )
    .join("");
  const found = findings(world, players, subjectId)
    .map((f) => `<li class="finding ${f.tone}">${escapeText(f.text)}</li>`)
    .join("");
  const tech = players
    .map((p) => {
      const path = world.events
        .filter((e) => e.type === "researched" && e.playerId === p.id)
        .map(
          (e) =>
            `<span><time>${clock(e.tick)}</time> ${escapeText(isResearchKind(e.detail) ? RESEARCH_PRESENTATION[e.detail].label : (e.detail ?? ""))}</span>`,
        )
        .join('<span aria-hidden="true">→</span>');
      return `<li><span class="report-swatch" style="--team:${p.color}"></span><strong>${escapeText(p.name)}</strong>${path || "<span>No research</span>"}</li>`;
    })
    .join("");
  const moments = keyMoments(world)
    .filter((e) => e.type !== "researched")
    .map((e) => {
      const color = players.find((p) => p.id === e.playerId)?.color ?? "#fff";
      return `<li><time>${clock(e.tick)}</time><span class="report-swatch" style="--team:${color}"></span>${escapeText(eventText(e, players))}</li>`;
    })
    .join("");
  return `<section class="match-report" aria-label="Match report"><h3>What decided it</h3><ul class="report-findings">${found || '<li class="finding neutral">The match ended before anything decisive happened.</li>'}</ul><div class="report-tabs" role="tablist">${tabs}</div><p class="report-caption">${description}</p>${chartMarkup(world, metric, players)}<ul class="report-legend">${legend}</ul><h3>Scoreboard</h3><div class="report-scroll">${scoreboardMarkup(world, players)}</div><h3>Research paths</h3><ul class="report-tech">${tech}</ul><h3>Key moments</h3><ol class="report-moments">${moments || "<li>No key moments recorded.</li>"}</ol></section>`;
}

function escapeText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}
