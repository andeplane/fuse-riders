/** How long a spore cloud hangs over its target, in milliseconds. */
export const SPORE_CLOUD_MS = 900;

/**
 * A Spore pod bursting on impact: a green cloud that billows out low and
 * lifts, with spores drifting up out of it. Animated only from the time since
 * the cosmetic arrival, like the artillery plume.
 */
export function sporeBurst(
  document: Document,
  at: Readonly<{ x: number; y: number }>,
  seed: number,
) {
  const ns = "http://www.w3.org/2000/svg";
  const element = document.createElementNS(ns, "g");
  const ground = document.createElementNS(ns, "g");
  element.setAttribute("class", "spore-burst");
  ground.setAttribute("class", "spore-burst-stain");
  element.setAttribute("pointer-events", "none");
  ground.setAttribute("pointer-events", "none");
  const stain = document.createElementNS(ns, "ellipse");
  stain.setAttribute("class", "spore-stain");
  ground.append(stain);
  const clouds = Array.from({ length: 5 }, (_, i) => {
    const puff = document.createElementNS(ns, "circle");
    puff.setAttribute("class", "spore-cloud");
    element.append(puff);
    return { puff, angle: (i * Math.PI * 2) / 5 + seed * 0.29 };
  });
  const spores = Array.from({ length: 9 }, (_, i) => {
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("class", "spore-mote");
    element.append(dot);
    const phase = ((Math.imul(seed + i * 131, 16807) >>> 0) % 997) / 997;
    return { dot, angle: i * 2.39996 + seed * 0.11, phase };
  });
  return {
    element,
    ground,
    animate(ageMs: number) {
      const t = Math.max(0, Math.min(1, ageMs / SPORE_CLOUD_MS));
      const visible = ageMs >= 0 && ageMs < SPORE_CLOUD_MS ? 1 : 0;
      element.setAttribute("opacity", String(visible));
      ground.setAttribute("opacity", String(visible));
      const billow = 1 - (1 - t) ** 3;
      stain.setAttribute("cx", String(at.x));
      stain.setAttribute("cy", String(at.y + 12));
      stain.setAttribute("rx", String(10 + billow * 24));
      stain.setAttribute("ry", String(4 + billow * 10));
      stain.setAttribute("opacity", String(0.45 * (1 - t)));
      for (const { puff, angle } of clouds) {
        puff.setAttribute("cx", String(at.x + Math.cos(angle) * billow * 20));
        puff.setAttribute(
          "cy",
          String(at.y - 4 + Math.sin(angle) * billow * 9 - t * 14),
        );
        puff.setAttribute("r", String(5 + billow * 11));
        puff.setAttribute("opacity", String(Math.sin(Math.PI * t) * 0.55));
      }
      for (const { dot, angle, phase } of spores) {
        const drift = t * (18 + phase * 20);
        dot.setAttribute(
          "cx",
          String(
            at.x +
              Math.cos(angle) * (6 + drift) +
              Math.sin(t * 9 + phase * 6) * 2,
          ),
        );
        dot.setAttribute("cy", String(at.y - 6 - drift * 1.4));
        dot.setAttribute("r", String(1.1 + phase * 1.1));
        dot.setAttribute("opacity", String((1 - t) * 0.9));
      }
    },
  };
}
