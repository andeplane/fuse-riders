import {
  dendriteGeometry,
  neuronForm,
  neuronSeed,
  somaPath,
  type DendriteGeometry,
  type Neighbour,
  type NeuronForm,
} from "./neuron-form.js";
import { palette, TEAM_PALETTES, type TeamPalette } from "./creep.js";

type Point = readonly [number, number];
export interface NeuronVisual {
  form: NeuronForm;
  x: number;
  y: number;
  dendrites: readonly DendriteGeometry[];
}

export function neuronVisual(
  x: number,
  y: number,
  cell: number,
  neighbours: readonly Neighbour[] = [],
): NeuronVisual {
  const form = neuronForm(neuronSeed(cell), neighbours);
  return {
    form,
    x,
    y,
    dendrites: form.dendrites.map((d) => dendriteGeometry(form, d, x, y)),
  };
}

function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) =>
    parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(a, i) * (1 - t) + channel(b, i) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
/** Three tones per team keep neighbouring neurons from reading as copies. */
function toned(p: TeamPalette, tone: number): TeamPalette {
  if (tone === 1)
    return {
      ...p,
      light: mix(p.light, "#f4fff2", 0.4),
      mid: mix(p.mid, "#38e4c8", 0.38),
      dark: mix(p.dark, "#06463f", 0.35),
    };
  if (tone === 2)
    return {
      ...p,
      light: mix(p.light, "#f3dcff", 0.4),
      mid: mix(p.mid, "#9a4dff", 0.4),
      dark: mix(p.dark, "#260a4a", 0.4),
    };
  return p;
}

/** Shared per-team, per-tone gradients; defined once in the board's defs. */
export function neuronDefs(only?: number): string {
  return TEAM_PALETTES.map((base, slot) =>
    only !== undefined && only !== slot
      ? ""
      : [0, 1, 2]
          .map((tone) => {
            const p = toned(base, tone),
              id = `${slot}-${tone}`;
            return (
              `<radialGradient id="nd-soma-${id}" fx="0.36" fy="0.3" r="0.6"><stop offset="0" stop-color="${p.light}"/><stop offset="0.22" stop-color="${p.mid}"/><stop offset="0.62" stop-color="${p.mid}" stop-opacity="0.85"/><stop offset="0.9" stop-color="${p.dark}"/><stop offset="1" stop-color="${p.light}" stop-opacity="0.9"/></radialGradient>` +
              `<linearGradient id="nd-dendrite-${id}" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${p.light}"/><stop offset="0.4" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.dark}"/></linearGradient>`
            );
          })
          .join("") +
        `<radialGradient id="nd-nucleus-${slot}"><stop offset="0" stop-color="#ffffff"/><stop offset="0.3" stop-color="${base.glow}" stop-opacity="0.95"/><stop offset="1" stop-color="${base.glow}" stop-opacity="0"/></radialGradient>` +
        `<radialGradient id="nd-neuron-glow-${slot}"><stop offset="0" stop-color="${base.glow}" stop-opacity="0.38"/><stop offset="1" stop-color="${base.glow}" stop-opacity="0"/></radialGradient>` +
        `<radialGradient id="nd-cocoon-${slot}" fx="0.4" fy="0.3"><stop offset="0" stop-color="${base.light}" stop-opacity="0.55"/><stop offset="0.55" stop-color="${base.mid}" stop-opacity="0.35"/><stop offset="1" stop-color="${base.dark}" stop-opacity="0.85"/></radialGradient>`,
  ).join("");
}

const f = (n: number) => n.toFixed(1);

/**
 * A standalone image of a neuron for the inspector portrait and command card,
 * so they show the same anatomy as the battlefield.
 */
export function neuronImageUrl(visual: NeuronVisual, slot: number): string {
  const { x, y } = visual;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x - 40)} ${f(y - 34)} 80 64"><defs>${neuronDefs(slot)}</defs>${neuronMarkup(visual, slot)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
const circles = (points: readonly Point[], r: number) =>
  points
    .map(
      ([x, y]) =>
        `M${f(x - r)} ${f(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`,
    )
    .join("");

/** One dendrite bundle: shadowed underside, lit flesh and glowing boutons, as three paths. */
function bundle(
  geometries: readonly DendriteGeometry[],
  slot: number,
  tone: number,
): string {
  if (!geometries.length) return "";
  const outlines = geometries.flatMap((g) => g.outlines).join("");
  const tips = geometries.flatMap((g) => g.tips);
  const p = palette(slot);
  return `<path class="dendrite-under" d="${outlines}" fill="${p.fleshDark}" transform="translate(0.6 1.9)"/><path class="dendrite-flesh" d="${outlines}" fill="url(#nd-dendrite-${slot}-${tone})"/><path class="bouton" d="${circles(tips, 1.25)}" fill="${p.glow}"/>`;
}

/** A neuron standing on the ground at (x, y): dendrites, raised soma and nucleus. */
export function neuronMarkup(visual: NeuronVisual, slot: number): string {
  const { form, x, y } = visual;
  const p = palette(slot);
  const tone = form.tone;
  const lift = 4;
  const anchored = visual.dendrites
    .filter((d) => d.anchored)
    .map(
      (d) =>
        `<g class="dendrite" data-key="${d.key}">${bundle([d], slot, tone)}</g>`,
    )
    .join("");
  const sides = [0, 1]
    .map(
      (side) =>
        `<g class="dendrite-side" data-side="${side}">${bundle(
          visual.dendrites.filter((d) => !d.anchored && d.side === side),
          slot,
          tone,
        )}</g>`,
    )
    .join("");
  const n = form.nucleus;
  const sx = x - form.radius * 0.36,
    sy = y - lift - form.radius * 0.44;
  return `<g class="neuron-body neuron-${form.kind}" data-phase="${f(form.phase)}"><ellipse class="neuron-glow" cx="${f(x)}" cy="${f(y + 2)}" rx="${f(form.radius * 2.9)}" ry="${f(form.radius * 1.9)}" fill="url(#nd-neuron-glow-${slot})"/>${anchored}${sides}<g class="soma"><path class="soma-under" d="${somaPath(form, x + 0.8, y + 1.6, 0.9)}" fill="${p.fleshDark}"/><path class="soma-flesh" d="${somaPath(form, x, y - lift)}" fill="url(#nd-soma-${slot}-${tone})" stroke="${p.light}" stroke-opacity="0.4" stroke-width="0.7"/><ellipse class="soma-nucleus" cx="${f(x + n.dx)}" cy="${f(y - lift + n.dy)}" rx="${f(n.radius * 1.35)}" ry="${f(n.radius * 1.15)}" fill="url(#nd-nucleus-${slot})"/><ellipse class="soma-specular" cx="${f(sx)}" cy="${f(sy)}" rx="${f(form.radius * 0.26)}" ry="${f(form.radius * 0.14)}" fill="#ffffff" opacity="0.45" transform="rotate(-24 ${f(sx)} ${f(sy)})"/></g><circle class="neuron-spark" r="1.9" cx="${f(x)}" cy="${f(y)}" fill="#ffffff" opacity="0"/></g>`;
}

/**
 * A neuron still under construction grows inside a translucent cocoon on the
 * creep. The embryo inside scales with authoritative build progress.
 */
export function cocoonMarkup(
  visual: NeuronVisual,
  slot: number,
  progress: number,
  active: boolean,
): string {
  const { x, y } = visual;
  const t = Math.max(0, Math.min(1, progress));
  const r = 13 + t * 5;
  const embryo = 0.25 + t * 0.6;
  const p = palette(slot);
  return `<g class="cocoon${active ? " cocoon-active" : ""}" data-progress="${t.toFixed(3)}" pointer-events="none"><ellipse class="cocoon-shadow" cx="${f(x + 2)}" cy="${f(y + 4)}" rx="${f(r * 1.05)}" ry="${f(r * 0.5)}" fill="#000" opacity="0.35"/><g class="cocoon-embryo" transform="translate(${f(x)} ${f(y)}) scale(${embryo.toFixed(3)}) translate(${f(-x)} ${f(-y)})" opacity="${(0.55 + t * 0.4).toFixed(2)}">${neuronMarkup(visual, slot)}</g><ellipse class="cocoon-sac" cx="${f(x)}" cy="${f(y - r * 0.55)}" rx="${f(r)}" ry="${f(r * 0.95)}" fill="url(#nd-cocoon-${slot})" stroke="${p.light}" stroke-opacity="0.45" stroke-width="0.8"/><path class="cocoon-vein" d="M${f(x - r * 0.6)} ${f(y - r * 0.2)}Q${f(x - r * 0.2)} ${f(y - r * 1.2)} ${f(x + r * 0.15)} ${f(y - r * 1.4)}M${f(x + r * 0.7)} ${f(y - r * 0.3)}Q${f(x + r * 0.4)} ${f(y - r)} ${f(x - r * 0.05)} ${f(y - r * 1.1)}" fill="none" stroke="${p.glow}" stroke-width="0.8" opacity="0.6"/><ellipse class="cocoon-specular" cx="${f(x - r * 0.35)}" cy="${f(y - r * 1.05)}" rx="${f(r * 0.28)}" ry="${f(r * 0.16)}" fill="#fff" opacity="0.5"/></g>`;
}

const clamp = (t: number) => Math.max(0, Math.min(1, t));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
function easeOutBack(t: number) {
  const c = 1.9,
    u = clamp(t) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}
/** Milliseconds a new neuron takes to sprout, and a new dendrite to reach out. */
export const SPROUT_MS = 1500;
export const REACH_MS = 1100;

export interface NeuronTiming {
  /** Presentation time the neuron first appeared, or -Infinity if already grown. */
  born: number;
  /** First appearance of each anchored dendrite, by key. */
  dendrites: ReadonlyMap<string, number>;
  dormant: boolean;
}

/**
 * Bind a rendered neuron to its geometry. Growth scales dendrites out from the
 * soma; idle motion sways the two free dendrite groups against each other and
 * sends a signal spark out along one dendrite at a time. Absolute time only.
 */
export function neuronAnimation(
  element: SVGGElement,
  visual: NeuronVisual,
  timing: NeuronTiming,
) {
  const { x, y, form } = visual;
  const sides = [...element.querySelectorAll<SVGGElement>(".dendrite-side")];
  const anchored = [...element.querySelectorAll<SVGGElement>(".dendrite")].map(
    (g) => ({
      g,
      geometry: visual.dendrites.find(
        (d) => d.key === g.getAttribute("data-key"),
      ),
      born:
        timing.dendrites.get(g.getAttribute("data-key") ?? "") ?? timing.born,
    }),
  );
  const soma = element.querySelector<SVGGElement>(".soma");
  const spark = element.querySelector<SVGCircleElement>(".neuron-spark");
  const phase = form.phase;
  let settled = false;
  return (now: number, reducedMotion: boolean) => {
    const age = now - timing.born;
    const growing = !reducedMotion && age < SPROUT_MS + 400;
    const reaching =
      !reducedMotion && anchored.some((a) => now - a.born < REACH_MS);
    const idle = !reducedMotion && !timing.dormant;
    if (!growing && !reaching && !idle) {
      if (settled) return;
      settled = true;
      for (const side of sides) side.removeAttribute("transform");
      for (const a of anchored) a.g.removeAttribute("transform");
      soma?.removeAttribute("transform");
      spark?.setAttribute("opacity", "0");
      return;
    }
    settled = false;
    const sprout = growing ? easeOutCubic((age - 150) / SPROUT_MS) : 1;
    const body = growing ? Math.max(0, easeOutBack((age - 80) / 700)) : 1;
    sides.forEach((side, i) => {
      const sway = idle
        ? Math.sin(now / (i ? 1150 : 930) + phase + i * 1.7) * (i ? -3.2 : 3.6)
        : 0;
      side.setAttribute(
        "transform",
        `rotate(${f(sway)} ${f(x)} ${f(y)})${sprout < 1 ? ` translate(${f(x)} ${f(y)}) scale(${sprout.toFixed(3)}) translate(${f(-x)} ${f(-y)})` : ""}`,
      );
    });
    for (const a of anchored) {
      const reach = reducedMotion
        ? 1
        : Math.min(sprout, easeOutCubic((now - a.born) / REACH_MS));
      if (reach >= 1 || !a.geometry) a.g.removeAttribute("transform");
      else {
        const [rx, ry] = a.geometry.root;
        a.g.setAttribute(
          "transform",
          `translate(${f(rx)} ${f(ry)}) scale(${Math.max(0.02, reach).toFixed(3)}) translate(${f(-rx)} ${f(-ry)})`,
        );
      }
    }
    const pulse = idle ? Math.sin(now / 620 + phase) * 0.045 : 0;
    soma?.setAttribute(
      "transform",
      `translate(${f(x)} ${f(y)}) scale(${(body * (1 + pulse)).toFixed(3)}, ${(body * (1 - pulse * 0.6)).toFixed(3)}) translate(${f(-x)} ${f(-y)})`,
    );
    if (!spark) return;
    if (!idle || growing || !visual.dendrites.length) {
      spark.setAttribute("opacity", "0");
      return;
    }
    // One outbound signal every 2.4 s, on a different dendrite each cycle.
    const cycle = now / 2400 + phase / (Math.PI * 2);
    const which = Math.floor(cycle) % visual.dendrites.length;
    const t = (cycle % 1) / 0.32;
    if (t >= 1) {
      spark.setAttribute("opacity", "0");
      return;
    }
    const at = pointAlong(visual.dendrites[which]!.spine, t);
    spark.setAttribute("cx", f(at[0]));
    spark.setAttribute("cy", f(at[1]));
    spark.setAttribute("opacity", (Math.sin(t * Math.PI) * 0.95).toFixed(2));
  };
}

export function pointAlong(spine: readonly Point[], t: number): Point {
  const position = clamp(t) * (spine.length - 1);
  const i = Math.min(spine.length - 2, Math.floor(position));
  const u = position - i;
  const a = spine[i]!,
    b = spine[i + 1]!;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

const icons = new Map<number, string>();
/** Build-button icon: the team's first stellate neuron, drawn standalone. */
export function neuronIconUrl(slot: number): string {
  let url = icons.get(slot);
  if (!url) {
    let cell = 0;
    while (cell < 64 && neuronForm(neuronSeed(cell)).kind !== "stellate")
      cell++;
    url = neuronImageUrl(neuronVisual(0, 0, cell), slot);
    icons.set(slot, url);
  }
  return url;
}
