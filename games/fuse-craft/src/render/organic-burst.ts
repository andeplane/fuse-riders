import { GROUND } from "./projection.js";
import { palette } from "./creep.js";
import { seededRandom } from "./neuron-form.js";

const ns = "http://www.w3.org/2000/svg";
/** Total presentation time of a burst after its impact delay, ms. */
export const BURST_MS = 1700;

/**
 * A neuron torn open: droplets of cytoplasm arc away from the soma and land,
 * a ring flashes out, and a wet splat stays on the creep while it fades.
 * Seeded and seekable by age; it never reads or changes world state.
 */
export function organicBurst(
  document: Document,
  at: Readonly<{ x: number; y: number }>,
  slot: number,
  seed: number,
  delayMs: number,
) {
  const p = palette(slot);
  const random = seededRandom(seed);
  const element = document.createElementNS(ns, "g");
  element.setAttribute("class", "organic-burst");
  element.setAttribute("pointer-events", "none");
  const ground = document.createElementNS(ns, "g");
  ground.setAttribute("class", "organic-splat");
  ground.setAttribute("pointer-events", "none");
  // Irregular splat outline, squashed onto the ground plane.
  const lobes = 11;
  const splatPoints = Array.from({ length: lobes }, (_, i) => {
    const angle = (i / lobes) * Math.PI * 2;
    const r = 0.7 + random() * 0.6;
    return [Math.cos(angle) * r, Math.sin(angle) * r * GROUND.depth] as const;
  });
  const splatPath = (scale: number) =>
    `M${splatPoints
      .map(
        ([x, y]) =>
          `${(at.x + x * scale).toFixed(1)} ${(at.y + y * scale).toFixed(1)}`,
      )
      .join("L")}Z`;
  ground.innerHTML = `<path class="organic-splat-body" fill="${p.fleshDark}" stroke="${p.mid}" stroke-width="1.2" stroke-linejoin="round"/><ellipse class="organic-ring" cx="${at.x}" cy="${at.y}" fill="none" stroke="${p.light}"/>`;
  const splat = ground.querySelector<SVGPathElement>(".organic-splat-body")!;
  const ring = ground.querySelector<SVGEllipseElement>(".organic-ring")!;
  const droplets = Array.from({ length: 12 + Math.floor(random() * 5) }, () => {
    const angle = random() * Math.PI * 2;
    return {
      dx: Math.cos(angle),
      dy: Math.sin(angle) * GROUND.depth,
      distance: 14 + random() * 26,
      lift: 10 + random() * 22,
      radius: 1.3 + random() * 2.1,
      flight: 0.45 + random() * 0.3,
      node: document.createElementNS(ns, "ellipse"),
    };
  });
  for (const d of droplets) {
    d.node.setAttribute("class", "organic-droplet");
    d.node.setAttribute("fill", random() < 0.3 ? p.light : p.mid);
    element.append(d.node);
  }
  const total = delayMs + BURST_MS;
  return {
    element,
    ground,
    duration: total,
    /** `t` is the fraction of `duration` elapsed. */
    animate(t: number) {
      const ms = t * total - delayMs;
      if (ms < 0) {
        element.setAttribute("opacity", "0");
        ground.setAttribute("opacity", "0");
        return;
      }
      const u = Math.min(1, ms / BURST_MS);
      element.setAttribute("opacity", "1");
      for (const d of droplets) {
        // Each droplet arcs out and lands, then lies on the ground and fades.
        const f = Math.min(1, u / d.flight);
        const x = at.x + d.dx * d.distance * f;
        const y =
          at.y - 6 + d.dy * d.distance * f - d.lift * 4 * f * (1 - f) + 6 * f;
        d.node.setAttribute("cx", x.toFixed(1));
        d.node.setAttribute("cy", y.toFixed(1));
        const flat = f >= 1 ? 0.55 : 1;
        d.node.setAttribute("rx", (d.radius * (f >= 1 ? 1.4 : 1)).toFixed(2));
        d.node.setAttribute("ry", (d.radius * flat).toFixed(2));
        d.node.setAttribute(
          "opacity",
          Math.max(0, 1 - Math.max(0, (u - d.flight) / (1 - d.flight))).toFixed(
            2,
          ),
        );
      }
      const spread = Math.min(1, u / 0.18);
      splat.setAttribute("d", splatPath(6 + spread * 16));
      ground.setAttribute(
        "opacity",
        Math.max(0, 1 - Math.max(0, (u - 0.45) / 0.55) * 1).toFixed(2),
      );
      const ringT = Math.min(1, u / 0.35);
      ring.setAttribute("rx", (8 + ringT * 30).toFixed(1));
      ring.setAttribute("ry", ((8 + ringT * 30) * GROUND.depth).toFixed(1));
      ring.setAttribute("stroke-width", (2.5 * (1 - ringT)).toFixed(2));
      ring.setAttribute("opacity", (0.85 * (1 - ringT)).toFixed(2));
    },
  };
}
