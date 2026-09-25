import {
  CONSTRUCTIONS,
  RESEARCH,
  constructionQueueAvailability,
  constructionDispatchAvailability,
  researchAvailability,
  type BuildKind,
  type Requirement,
} from "../engine/catalog.js";
import type { Player, Research, World } from "../engine/types.js";

export type CommandPanel = "inspect" | "build" | "research" | "activity";
const buildKinds = Object.keys(CONSTRUCTIONS) as BuildKind[];
const researchKinds = Object.keys(RESEARCH) as Research[];
const keys = ["Q", "W", "E"];
export const commandPageCount = (panel: CommandPanel) =>
  Math.max(
    1,
    Math.ceil(
      (panel === "build"
        ? buildKinds.length
        : panel === "research"
          ? researchKinds.length
          : 0) / keys.length,
    ),
  );

export const BUILD_PRESENTATION: Readonly<
  Record<
    BuildKind,
    { label: string; description: string; sprite: (team: string) => string }
  >
> = {
  neuron: {
    label: "Neuron",
    description: "Expand your connected network.",
    sprite: (team) => `neuron-${team}`,
  },
  tower: {
    label: "Tower",
    description: "Build an experimental attack tower.",
    sprite: () => "tower-experimental",
  },
};
export const RESEARCH_PRESENTATION: Readonly<
  Record<Research, { label: string; description: string }>
> = {
  growth: {
    label: "Growth",
    description: "Faster future neuron construction.",
  },
  excitation: {
    label: "Excitation",
    description: "Stronger newly dispatched attack particles.",
  },
  conduction: {
    label: "Conduction",
    description: "Faster newly dispatched attack particles.",
  },
};
export function requirementText(requirement: Requirement): string {
  switch (requirement.kind) {
    case "alive":
      return "Your brain has been destroyed.";
    case "open-cell":
      return "Select open ground.";
    case "unoccupied-cell":
      return "This hex is already occupied.";
    case "not-queued":
      return "Construction is already queued on this hex.";
    case "queue-space":
      return `Construction queue is full (${requirement.limit}).`;
    case "research":
      return `Research ${RESEARCH_PRESENTATION[requirement.research].label} first.`;
    case "resource":
      return `Need ${((requirement.required - requirement.available) / 1000).toFixed(1)} more ${requirement.resource} (${(requirement.required / 1000).toFixed(1)} total).`;
    case "neighbors":
      return `Needs ${requirement.required} connected friendly neighbor${requirement.required === 1 ? "" : "s"} (${requirement.connected} connected).`;
    case "idle-builder":
      return "Waiting for your builder to become available.";
    case "idle-research":
      return "Finish or cancel the current research first.";
    case "not-researched":
      return `${RESEARCH_PRESENTATION[requirement.research].label} is already researched.`;
  }
}
function escape(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}

const commandSymbols: Record<string, string> = {
  next: '<path d="m19 7 9 9-9 9M28 16H4"/>',
  back: '<path d="m13 7-9 9 9 9M4 16h24"/>',
  growth:
    '<path d="M16 29V14M16 20C3 21 3 10 3 7c10 0 14 5 13 13ZM16 15C16 4 23 3 29 3c0 8-4 14-13 12Z"/>',
  excitation: '<path d="m19 2-13 17h10l-3 11 14-18H17z"/>',
  conduction: '<path d="M2 16h23m-8-7 9 7-9 7M3 8h8M3 24h8"/>',
  research:
    '<path d="M10 3v7L5 20q-1 3 3 3h16q4 0 3-3l-5-10V3M8 3h16M8 17h16"/><path d="M12 13h2m4 7h2"/>',
  log: '<path d="M7 3h18v26H7zM11 9h10M11 15h10M11 21h7"/>',
  build: '<path d="m4 26 14-14m-3-7 4-3 10 10-4 4-4-4-3 3-6-6zM3 23l6 6"/>',
  cancel: '<path d="m7 7 18 18M25 7 7 25"/>',
};

export function commandButton(options: {
  action: string;
  label: string;
  shortcut: string;
  description: string;
  art?: string;
  symbol?: string;
  cost?: string;
  disabled?: boolean;
  progress?: number;
  hints?: readonly string[];
}): string {
  const progress =
    options.progress === undefined
      ? null
      : Math.max(0, Math.min(1, options.progress));
  const percent = progress === null ? null : Math.floor(progress * 100);
  const art = options.art
    ? `<img src="${escape(options.art)}" alt="" draggable="false">`
    : `<svg viewBox="0 0 32 32" aria-hidden="true">${commandSymbols[options.symbol ?? "research"] ?? commandSymbols.research}</svg>`;
  const helpId = `help-${options.action}`;
  return `<div class="command-slot"><button class="command-button${progress === null ? "" : " is-building"}" data-action="${options.action}" aria-label="${escape(options.label)}${options.cost ? ` · ${escape(options.cost)}` : ""}${percent === null ? "" : ` · ${percent}% complete`}" aria-keyshortcuts="${options.shortcut}" aria-describedby="${helpId}" aria-disabled="${!!options.disabled}"><kbd>${options.shortcut}</kbd>${options.cost ? `<span class="command-cost">${options.cost}</span>` : ""}${art}${progress === null ? "" : `<span class="command-progress" role="progressbar" aria-label="${escape(options.label)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" style="--progress-angle:${progress * 360}deg"><span>${percent}%</span></span>`}<span class="command-label">${options.label}</span></button><div id="${helpId}" role="tooltip" class="command-tooltip"><strong>${escape(options.label)}${options.cost ? ` · ${escape(options.cost)}` : ""}</strong><p>${escape(options.description)}</p>${options.hints?.length ? `<ul>${options.hints.map((hint) => `<li>${escape(hint)}</li>`).join("")}</ul>` : ""}</div></div>`;
}

export function renderCommands(
  world: Readonly<World>,
  player: Readonly<Player>,
  selectedCell: number | null,
  panel: CommandPanel,
  page: number,
  sprites: Readonly<Record<string, string>> = {},
): string {
  const empty = '<span class="command-empty" aria-hidden="true"></span>';
  const back = commandButton({
    action: "close-panel",
    label: "Back",
    shortcut: "A",
    symbol: "back",
    description: "Back to main commands",
  });
  const activeBuild = player.queue.find((job) => job.paid);
  const queued = player.queue.find((job) => job.cell === selectedCell);
  const buildProgress = activeBuild
    ? activeBuild.progress / Math.max(1, activeBuild.duration)
    : undefined;
  const researchProgress = player.researchJob
    ? 1 -
      (player.researchJob.completesAt - world.tick) /
        RESEARCH[player.researchJob.kind].duration
    : undefined;
  const cancelBuild = (shortcut: string) =>
    commandButton({
      action: "cancel-build",
      label: "Cancel",
      shortcut,
      symbol: "cancel",
      description: "Cancel construction on the selected hex.",
      disabled: !queued,
      hints: queued ? [] : ["Select one of your queued construction sites."],
    });
  const more =
    commandPageCount(panel) > 1
      ? commandButton({
          action: "next-command-page",
          label: "More",
          shortcut: "D",
          symbol: "next",
          description: "Next page of commands",
        })
      : empty;

  if (panel === "build") {
    const team = ["blue", "coral", "green", "gold"][player.slot] ?? "blue";
    const kinds = buildKinds.slice(
      page * keys.length,
      (page + 1) * keys.length,
    );
    const commands = kinds.map((kind, index) => {
      const definition = CONSTRUCTIONS[kind],
        presentation = BUILD_PRESENTATION[kind];
      const availability = constructionQueueAvailability(
        world,
        player,
        kind,
        selectedCell,
      );
      const waiting =
        availability.allowed && selectedCell !== null
          ? constructionDispatchAvailability(world, player, {
              cell: selectedCell,
              kind,
            }).missing
          : [];
      const asset = presentation.sprite(team);
      return commandButton({
        action: `build-${kind}`,
        label: presentation.label,
        shortcut: keys[index]!,
        description: presentation.description,
        art: sprites[`${asset}-v2`] ?? sprites[asset],
        cost: `${definition.cost / 1000} ◈`,
        disabled: !availability.allowed,
        hints: availability.allowed
          ? waiting.length
            ? [
                "Can queue now. Work starts when:",
                ...waiting.map(requirementText),
              ]
            : ["Ready to build."]
          : availability.missing.map(requirementText),
        progress: activeBuild?.kind === kind ? buildProgress : undefined,
      });
    });
    return (
      commands.join("") +
      empty.repeat(keys.length - commands.length) +
      back +
      cancelBuild("S") +
      more
    );
  }
  if (panel === "research") {
    const kinds = researchKinds.slice(
      page * keys.length,
      (page + 1) * keys.length,
    );
    const commands = kinds.map((kind, index) => {
      const definition = RESEARCH[kind],
        presentation = RESEARCH_PRESENTATION[kind];
      const availability = researchAvailability(player, kind);
      return commandButton({
        action: `research-${kind}`,
        label: presentation.label,
        shortcut: keys[index]!,
        symbol: kind,
        description: presentation.description,
        cost: player.research.includes(kind)
          ? "✓"
          : `${definition.cost / 1000} ◇`,
        disabled: !availability.allowed,
        hints: availability.missing.map(requirementText),
        progress:
          player.researchJob?.kind === kind ? researchProgress : undefined,
      });
    });
    return (
      commands.join("") +
      empty.repeat(keys.length - commands.length) +
      back +
      commandButton({
        action: "cancel-research",
        label: "Cancel",
        shortcut: "S",
        symbol: "cancel",
        description: "Cancel the current research.",
        disabled: !player.researchJob,
        hints: player.researchJob ? [] : ["No research is running."],
      }) +
      more
    );
  }
  if (panel === "activity") return empty.repeat(3) + back + empty.repeat(2);
  return (
    commandButton({
      action: "panel-build",
      label: "Build",
      shortcut: "Q",
      symbol: "build",
      description: "Choose a structure to build.",
      disabled: !player.alive,
      hints: player.alive ? [] : [requirementText({ kind: "alive" })],
      progress: buildProgress,
    }) +
    commandButton({
      action: "panel-research",
      label: "Research",
      shortcut: "W",
      symbol: "research",
      description: "Research network upgrades.",
      disabled: !player.alive,
      hints: player.alive ? [] : [requirementText({ kind: "alive" })],
      progress: researchProgress,
    }) +
    commandButton({
      action: "panel-activity",
      label: "Log",
      shortcut: "E",
      symbol: "log",
      description: "Recent network activity.",
    }) +
    cancelBuild("A") +
    empty.repeat(2)
  );
}
