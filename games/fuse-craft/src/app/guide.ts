import {
  CONSTRUCTIONS,
  MINERS_PER_DEPOSIT,
  RESEARCH,
  SPROUT,
  STRUCTURES,
} from "../engine/catalog.js";
import { POWERUP_KINDS, POWERUP_PRESENTATION } from "../engine/powerups.js";
import {
  DOMINANCE_LEAD,
  dominanceShare,
  TERRITORY,
} from "../engine/territory.js";
import { AI_STRATEGIES, RULES, type AiStrategy } from "../engine/types.js";
import { BUILD_PRESENTATION, RESEARCH_PRESENTATION } from "./command-card.js";

/**
 * How to Play: the rules and the strategy playbook, generated from the live
 * catalog so the numbers never drift from the engine.
 */
export const GUIDE_SECTIONS = [
  { id: "goal", label: "Goal" },
  { id: "network", label: "Network" },
  { id: "economy", label: "Economy" },
  { id: "structures", label: "Structures" },
  { id: "research", label: "Research" },
  { id: "combat", label: "Combat" },
  { id: "powerups", label: "Powerups" },
  { id: "strategies", label: "Strategies" },
  { id: "controls", label: "Controls" },
] as const;
export type GuideSection = (typeof GUIDE_SECTIONS)[number]["id"];
export const isGuideSection = (value: unknown): value is GuideSection =>
  GUIDE_SECTIONS.some((section) => section.id === value);

/**
 * The openings, as an RTS playbook: what each does, what it beats and what
 * beats it. The counters come from the AI-vs-AI benchmark
 * (docs/fuse-craft/STRATEGIES.md).
 */
export const OPENINGS: Readonly<
  Record<
    AiStrategy,
    {
      name: string;
      style: string;
      plan: string;
      beats: AiStrategy[];
      losesTo: AiStrategy[];
    }
  >
> = {
  balanced: {
    name: "Balanced",
    style: "Standard",
    plan: "Expand steadily, take a Harvester, then mix towers and Siege as the front forms. Weak in duels, the strongest opening in a free-for-all.",
    beats: ["economy"],
    losesTo: ["pressure", "siege", "relay", "defensive", "swarm"],
  },
  pressure: {
    name: "Pressure",
    style: "Rush",
    plan: "Excitation first and a straight drive at the rival with Pulse towers, before a greedy economy pays off. Strongest on close maps.",
    beats: ["balanced", "swarm"],
    losesTo: ["economy", "siege", "defensive"],
  },
  siege: {
    name: "Siege",
    style: "Contain",
    plan: "Growth, then Ballistics straight away; artillery outranges Pulse towers and Bastions from behind a wall of neurons.",
    beats: ["balanced", "pressure", "defensive"],
    losesTo: ["economy", "relay", "swarm"],
  },
  relay: {
    name: "Relay",
    style: "Tempo",
    plan: "Growth, then Resonance and cheap Relay towers: frequent small volleys that get inside Siege's blind spot and outpace slow builds. A duel opening; spread thin in a free-for-all.",
    beats: ["balanced", "economy", "siege", "defensive"],
    losesTo: ["swarm"],
  },
  defensive: {
    name: "Defensive",
    style: "Turtle",
    plan: "Towers and Bastions around a compact network; wins the fights it is offered and holds creep and rushes.",
    beats: ["balanced", "pressure", "swarm"],
    losesTo: ["siege", "relay"],
  },
  economy: {
    name: "Economy",
    style: "Greed",
    plan: "Deposits and Harvesters before guns, then out-produce the rival. Strongest on wide, rich maps.",
    beats: ["pressure", "siege"],
    losesTo: ["balanced", "relay"],
  },
  swarm: {
    name: "Swarm",
    style: "Creep",
    plan: "Growth first and neurons everywhere: claim the map and threaten dominance, with just enough guns to hold it. Bastions stop it.",
    beats: ["balanced", "siege", "relay"],
    losesTo: ["pressure", "defensive"],
  },
};

const pct = (value: number) => `${Math.round(value * 100)}%`;
const bio = (milli: number) => `${milli / 1000}`;

export function guideMarkup(section: GuideSection): string {
  const nav = GUIDE_SECTIONS.map(
    (s) =>
      `<button role="tab" data-action="guide-section" data-section="${s.id}" aria-selected="${s.id === section}" class="guide-tab${s.id === section ? " active" : ""}">${s.label}</button>`,
  ).join("");
  return `<div class="guide"><nav class="guide-tabs" role="tablist" aria-label="How to play">${nav}</nav><article class="guide-body" role="tabpanel">${sectionMarkup(section)}</article></div>`;
}

function sectionMarkup(section: GuideSection): string {
  switch (section) {
    case "goal":
      return `<h2>Take over the cortex</h2><p>You are a brain. Grow a network of neurons across the map, feed it from deposits, arm it with towers and push back every rival network.</p><h3>Two ways to win</h3><ul><li><strong>Elimination.</strong> Destroy every rival brain. A brain is a structure like any other; guard it.</li><li><strong>Dominance.</strong> Hold ${pct(dominanceShare(2))} of the map in a duel (less in larger rooms: ${pct(dominanceShare(4))} with four players, ${pct(dominanceShare(6))} with six) for ${TERRITORY.dominanceTicks / RULES.ticksPerSecond} seconds, while holding at least ${DOMINANCE_LEAD} times as much as any rival. The top bar counts your territory and shows a countdown while someone dominates.</li></ul><p>Contested cells, touched by two networks, count for nobody: to dominate you must push rivals back, not only outgrow them.</p>`;
    case "network":
      return `<h2>Your network</h2><p>Everything grows from the brain. A structure is <em>connected</em> while a chain of your structures links it to the brain; disconnected structures stop mining, claiming and firing until you reconnect them.</p><h3>Neurons sprout</h3><p>Neurons carry no weapon: they claim ground, mine deposits and carry supply, and every tower is built on one. Queue a Neuron beside your network and it grows by itself, like creep. You grow one sprout at a time at first and one more for every ${SPROUT.cellsPerSlot} territory cells, up to ${SPROUT.maxSlots}. Expansion snowballs: the more map you hold, the faster you take more.</p><h3>The builder</h3><p>Your builder walks out along the network to raise towers and other upgrades on existing neurons. Cut a route it is travelling and it retreats to the brain.</p><h3>Auto expand</h3><p>Select your brain and switch on Auto expand to fill free sprout slots automatically. Your own orders always come first.</p>`;
    case "economy":
      return `<h2>Economy</h2><p>Two resources: <strong>biomass</strong> ◈ builds, <strong>insight</strong> ◇ researches. The brain trickles both.</p><ul><li><strong>Deposits.</strong> A connected structure beside a crystal mines it: biomass or insight. Up to ${MINERS_PER_DEPOSIT} of your structures mine the same deposit, so take more deposits rather than crowding one.</li><li><strong>Harvesters</strong> add one more share to every deposit beside them, on top of the two miners.</li><li><strong>Territory</strong> pays ${bio(TERRITORY.incomePerCell)} biomass per claimed cell every second.</li></ul><p>A Neuron costs ${bio(CONSTRUCTIONS.neuron.cost)} biomass; a Pulse tower ${bio(CONSTRUCTIONS.tower.cost)}.</p>`;
    case "structures": {
      const rows = (
        Object.keys(CONSTRUCTIONS) as (keyof typeof CONSTRUCTIONS)[]
      )
        .map((kind) => {
          const c = CONSTRUCTIONS[kind],
            s = STRUCTURES[kind];
          const needs = c.requires
            .map((r) => RESEARCH_PRESENTATION[r].label)
            .join(", ");
          return `<tr><th scope="row">${BUILD_PRESENTATION[kind].label}</th><td>${bio(c.cost)}</td><td>${s.hp}</td><td>${s.volley ? `${s.minRange ? `${s.minRange}–` : ""}${s.range}` : "—"}</td><td>${needs || "—"}</td><td>${BUILD_PRESENTATION[kind].description}</td></tr>`;
        })
        .join("");
      return `<h2>Structures</h2><p>Every tower is an upgrade of a Neuron: select a neuron and choose what it becomes.</p><div class="guide-scroll"><table class="guide-table"><thead><tr><th scope="col">Structure</th><th scope="col">Biomass</th><th scope="col">HP</th><th scope="col">Range</th><th scope="col">Needs</th><th scope="col">Role</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    case "research": {
      const rows = (Object.keys(RESEARCH) as (keyof typeof RESEARCH)[])
        .map((kind) => {
          const r = RESEARCH[kind];
          return `<tr><th scope="row">${RESEARCH_PRESENTATION[kind].label}</th><td>${bio(r.cost)}</td><td>${r.duration / RULES.ticksPerSecond}s</td><td>${r.requires.map((q) => RESEARCH_PRESENTATION[q].label).join(", ") || "—"}</td><td>${RESEARCH_PRESENTATION[kind].description}</td></tr>`;
        })
        .join("");
      return `<h2>Research</h2><p>One project at a time, paid in insight. Research is permanent.</p><div class="guide-scroll"><table class="guide-table"><thead><tr><th scope="col">Project</th><th scope="col">Insight</th><th scope="col">Time</th><th scope="col">Needs</th><th scope="col">Effect</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    case "combat":
      return `<h2>Combat</h2><p>Weapons fire the <strong>particles</strong> stationed on them. Particles live at the brain and travel the network to whatever you prioritise: select a weapon and Charge it, or set its attack priority. A tower with no supply cannot fire.</p><ul><li><strong>Pulse</strong> particles are balanced; <strong>Heavy</strong> hit harder but travel slowly (Ballistics); <strong>Swift</strong> reinforce fast (Resonance).</li><li><strong>Siege</strong> cannot hit inside two steps: protect it with close weapons.</li><li><strong>Spore</strong> pods burst on impact and splash every enemy structure beside the target: the answer to dense neuron spreads.</li><li><strong>Bastions</strong> spend their particles shielding nearby structures instead of firing.</li><li>Cut a rival's network and everything past the cut disconnects.</li></ul>`;
    case "powerups":
      return `<h2>Powerups</h2><p>From the first minute, pickups spawn on open ground fairly placed between the brains. The first network to touch one claims it; two touching networks keep it contested.</p><ul>${POWERUP_KINDS.map((k) => `<li><strong>${POWERUP_PRESENTATION[k].label}.</strong> ${POWERUP_PRESENTATION[k].description}</li>`).join("")}</ul>`;
    case "strategies": {
      const name = (s: AiStrategy) => OPENINGS[s].name;
      const cards = AI_STRATEGIES.map((s) => {
        const o = OPENINGS[s];
        return `<li class="guide-opening"><strong>${o.name}</strong><em>${o.style}</em><p>${o.plan}</p><small>Beats ${o.beats.map(name).join(", ")} · Loses to ${o.losesTo.map(name).join(", ")}</small></li>`;
      }).join("");
      return `<h2>Strategies</h2><p>Every opening has a counter. Scout what your rival builds and adapt: Pressure's early Pulse towers break Balanced; Siege's artillery outranges Balanced, Pressure and Defensive; Relay's quick volleys get inside Siege's blind spot and out-pace slow builds; Swarm's creep out-grows Balanced, Siege and Relay; Defensive's Bastions hold Swarm and Pressure; and Economy out-produces Pressure and Siege. Maps change the answer: rushes win close maps, economies win wide ones. In a free-for-all, steady openings outlast specialists.</p><ul class="guide-openings">${cards}</ul><p class="muted">Counters are measured by AI-vs-AI benchmarks on every map; human play will differ.</p>`;
    }
    case "controls":
      return `<h2>Controls</h2><table class="guide-table"><tbody><tr><th scope="row">Select</th><td>Click a hex, or Shift + arrow keys</td></tr><tr><th scope="row">Move the camera</th><td>Arrow keys, drag the board, rest the mouse at the board's edge, or press and drag on the minimap</td></tr><tr><th scope="row">Zoom</th><td>Scroll or pinch</td></tr><tr><th scope="row">Full screen</th><td>F, or the ⛶ button</td></tr><tr><th scope="row">Commands</th><td>Q W E / A S D follow the command card; Esc goes back</td></tr><tr><th scope="row">Particles · Build · Research</th><td>Q · W · E from the root card</td></tr><tr><th scope="row">Auto expand</th><td>S with your brain selected</td></tr><tr><th scope="row">Charge a weapon</th><td>D with the weapon selected</td></tr></tbody></table>`;
  }
}
