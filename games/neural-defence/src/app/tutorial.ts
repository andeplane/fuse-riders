import { neighbors } from "../engine/map.js";
import type { World } from "../engine/types.js";

/**
 * The guided first game: a sandbox on Slate Basin with a coach that watches
 * the world and moves on once the player has done each thing. Steps read the
 * shared world and the local selection only, so the coach never acts for the
 * player; a step without a condition waits for Next.
 */
export const TUTORIAL_MAP = "sandbox-12";

export interface TutorialContext {
  world: Readonly<World>;
  playerId: string;
  selectedCell: number | null;
}
export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  /** What to press, shown as keys. */
  keys?: string[];
  /** A control to pulse while the step is open. */
  target?: string;
  done?: (context: TutorialContext) => boolean;
}

const own = ({ world, playerId }: TutorialContext) =>
  world.structures.filter((s) => s.ownerId === playerId);
const me = ({ world, playerId }: TutorialContext) =>
  world.players.find((p) => p.id === playerId);

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "welcome",
    title: "This is your brain",
    text: "Everything grows from the glowing brain. If it dies, you lose. Your network will spread out from here like creep, claiming the cortex hex by hex.",
  },
  {
    id: "select-brain",
    title: "Select your brain",
    text: "Click your brain, or move the selection with Shift and the arrow keys. The panel shows what you have selected and what it can do. Arrow keys, the board's edges and the minimap move the camera.",
    done: (c) =>
      c.selectedCell !== null &&
      own(c).some((s) => s.kind === "brain" && s.cell === c.selectedCell),
  },
  {
    id: "neuron",
    title: "Grow a neuron",
    text: "Open Build and choose Neuron, then click a hex beside your network. It sprouts by itself, like creep. Neurons must touch your connected network.",
    keys: ["W", "Q"],
    target: '[data-action="panel-build"], [data-action="build-neuron"]',
    done: (c) =>
      own(c).some((s) => s.kind === "neuron") ||
      !!me(c)?.queue.some((j) => j.kind === "neuron"),
  },
  {
    id: "deposit",
    title: "Reach a deposit",
    text: "Crystals are deposits. A connected structure beside one mines it: blue for biomass (building), violet for insight (research). Grow a chain of neurons until one touches a deposit.",
    done: (c) =>
      own(c).some(
        (s) =>
          s.connected &&
          neighbors(c.world.map, s.cell).some(
            (n) => c.world.map.cells[n]?.terrain === "deposit",
          ),
      ),
  },
  {
    id: "auto-expand",
    title: "Let it spread",
    text: "Select your brain and switch on Auto expand. Your network then sprouts into open ground by itself whenever you have biomass; your own orders still come first. The more territory you hold, the more neurons sprout at once.",
    keys: ["S"],
    target: '[data-action="auto-expand"]',
    done: (c) => !!me(c)?.autoExpand,
  },
  {
    id: "research",
    title: "Research Growth",
    text: "Open Research and start Growth. It builds neurons faster and unlocks Harvesters, Bastions and the Spore tower. Research costs insight.",
    keys: ["E"],
    target: '[data-action="panel-research"], [data-action="research-growth"]',
    done: (c) => {
      const p = me(c);
      return !!p && (p.research.length > 0 || p.researchJob !== null);
    },
  },
  {
    id: "territory",
    title: "Claim territory",
    text: "Each connected structure claims its hex and the six around it; the counter at the top shows your territory. Territory pays a trickle of biomass, and holding a dominant share of the map for a minute wins outright. Reach 30 cells.",
    done: (c) => (me(c)?.territory ?? 0) >= 30,
  },
  {
    id: "tower",
    title: "Arm your network",
    text: "Towers are neurons you upgrade, and your builder walks out to raise them. Select a neuron at the edge of your network, open Build and choose Pulse tower. Siege, Relay, Bastion and Spore towers unlock with research.",
    keys: ["W", "W"],
    target: '[data-action="build-tower"]',
    done: (c) =>
      own(c).some((s) => s.kind === "tower") ||
      !!me(c)?.queue.some((j) => j.kind === "tower"),
  },
  {
    id: "supply",
    title: "Supply the front",
    text: "Weapons fire the particles stationed on them. Select a tower and Charge it (or raise its attack priority) so particles travel out from the brain to arm it.",
    keys: ["D"],
    target: '[data-action="charge"], #priority-slider',
    done: (c) =>
      Object.values(me(c)?.priorities ?? {}).some((weight) => weight > 0),
  },
  {
    id: "done",
    title: "You are ready",
    text: "Win by destroying every rival brain, or by holding the dominant share of the map for a minute. Keep exploring here, or play your first match against the AI.",
  },
];

/** The first step not yet done at or after `from`, so finished steps skip ahead. */
export function nextStep(from: number, context: TutorialContext): number {
  let step = from;
  while (step < TUTORIAL_STEPS.length - 1) {
    const done = TUTORIAL_STEPS[step]!.done;
    if (!done || !done(context)) break;
    step++;
  }
  return step;
}
