/** A bounded artillery plume, animated only from time since cosmetic arrival. */
export function siegeImpact(
  document: Document,
  at: Readonly<{ x: number; y: number }>,
  seed: number,
) {
  const ns = "http://www.w3.org/2000/svg";
  const element = document.createElementNS(ns, "g");
  const ground = document.createElementNS(ns, "g");
  element.setAttribute("class", "siege-impact-plume");
  ground.setAttribute("class", "siege-impact-dust");
  element.setAttribute("pointer-events", "none");
  ground.setAttribute("pointer-events", "none");
  const dust = Array.from({ length: 5 }, (_, i) => {
    const puff = document.createElementNS(ns, "ellipse");
    puff.setAttribute("fill", "url(#combat-dust)");
    ground.append(puff);
    return { puff, angle: (i * Math.PI * 2) / 5 + seed * 0.37 };
  });
  const smoke = Array.from({ length: 3 }, (_, i) => {
    const puff = document.createElementNS(ns, "circle");
    puff.setAttribute("class", "siege-impact-smoke");
    puff.setAttribute("fill", "url(#combat-blast-smoke)");
    element.append(puff);
    return { puff, i };
  });
  const embers = Array.from({ length: 4 }, (_, i) => {
    const ember = document.createElementNS(ns, "ellipse");
    ember.setAttribute("class", "siege-impact-ember");
    ember.setAttribute("fill", "#ffe1a3");
    ember.setAttribute("rx", "1.2");
    ember.setAttribute("ry", "2.5");
    element.append(ember);
    return { ember, angle: i * 2.4 + seed * 0.17 };
  });
  return {
    element,
    ground,
    animate(ageMs: number) {
      const t = Math.max(0, Math.min(1, ageMs / 680));
      const visible = ageMs >= 0 && ageMs < 680 ? 1 : 0;
      element.setAttribute("opacity", String(visible));
      ground.setAttribute("opacity", String(visible));
      const spread = Math.sqrt(t);
      for (const { puff, angle } of dust) {
        puff.setAttribute("cx", String(at.x + Math.cos(angle) * spread * 36));
        puff.setAttribute(
          "cy",
          String(at.y + 12 + Math.sin(angle) * spread * 18),
        );
        puff.setAttribute("rx", String(5 + spread * 16));
        puff.setAttribute("ry", String(2.5 + spread * 8));
        puff.setAttribute("opacity", String(Math.sin(Math.PI * t) * 0.7));
      }
      for (const { puff, i } of smoke) {
        const rise = Math.max(
          0,
          Math.min(1, (ageMs - i * 35) / (680 - i * 35)),
        );
        puff.setAttribute("cx", String(at.x + (i - 1) * (4 + rise * 12)));
        puff.setAttribute(
          "cy",
          String(at.y - 8 - Math.sqrt(rise) * (52 + i * 10)),
        );
        puff.setAttribute("r", String(8 + Math.sqrt(rise) * 19));
        puff.setAttribute("opacity", String(Math.sin(Math.PI * rise) * 0.75));
      }
      for (const { ember, angle } of embers) {
        const height = Math.max(
          0,
          9 + (48 + Math.sin(angle) * 14) * t - 55 * t * t,
        );
        ember.setAttribute("cx", String(at.x + Math.cos(angle) * t * 28));
        ember.setAttribute(
          "cy",
          String(at.y + Math.sin(angle) * t * 10 - height),
        );
        ember.setAttribute("opacity", String((1 - t) ** 2));
      }
    },
  };
}
